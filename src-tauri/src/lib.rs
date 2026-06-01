use serde::{Deserialize, Serialize};
use std::path::PathBuf;

// ─── Data types ───

#[derive(Debug, Serialize, Deserialize)]
pub struct LlmRequest {
    pub messages: Vec<Message>,
    pub api_key: String,
    pub api_url: String,
    pub model: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Message {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EnvVar {
    pub name: String,
    pub value: String,
    pub r#type: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PlotInfo {
    pub path: String,
    pub data_url: String,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PackageInfo {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct KnitResult {
    pub pdf: Option<String>,
    pub html: Option<String>,
    pub log: String,
}

// ─── Helpers ───

fn get_r_path() -> String {
    std::env::var("RSTUDENT_R_PATH").unwrap_or_else(|_| "R".to_string())
}

fn get_r_args() -> Vec<String> {
    let args_str = std::env::var("RSTUDENT_R_ARGS")
        .unwrap_or_else(|_| "--no-save --no-restore --quiet".to_string());
    args_str.split_whitespace().map(|s| s.to_string()).collect()
}

fn get_plots_dir(app_handle: &tauri::AppHandle) -> PathBuf {
    let dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("rstudent_plots");
    std::fs::create_dir_all(&dir).ok();
    dir
}

/// Write user code to a temp .R file, then write a wrapper script that sources it.
/// This completely avoids all escaping issues since the user code is written raw to disk.
fn write_and_run_r_with_code(user_code: &str, r_path: &str, base_args: &[String], plots_dir: &PathBuf) -> Result<String, String> {
    let pid = std::process::id();
    let user_file = std::env::temp_dir().join(format!("rstudent_user_{}.R", pid));
    let wrapper_file = std::env::temp_dir().join(format!("rstudent_wrapper_{}.R", pid));
    let plots_str = plots_dir.to_string_lossy().replace("\\", "/");

    // Write user code exactly as-is to a temp file
    std::fs::write(&user_file, user_code)
        .map_err(|e| format!("Failed to write R code file: {}", e))?;

    // Build wrapper that sources the user file
    let wrapper = format!(
        r#"# RStudent execution wrapper
options(width = 120)

.rstudent_plots_dir <- "{plots}"
dir.create(.rstudent_plots_dir, showWarnings = FALSE, recursive = TRUE)

options(device = function(...) {{
    png(filename = tempfile("rstudent_plot_", fileext = ".png"),
        width = 800, height = 600, res = 90)
}})

.rstudent_output <- capture.output({{
    .rstudent_msgs <- capture.output({{
        tryCatch({{
            source("{user}", local = FALSE, keep.source = TRUE)
        }}, error = function(e) {{
            cat("Error: ", conditionMessage(e), "\n", sep = "")
        }}, warning = function(w) {{
            cat("Warning: ", conditionMessage(w), "\n", sep = "")
        }})
    }}, type = "message")
}}, type = "output")

while (dev.cur() > 1) dev.off()

.rstudent_new_plots <- list.files(tempdir(), pattern = "^rstudent_plot_.*\\.png$", full.names = TRUE)
for (.f in .rstudent_new_plots) {{
    file.copy(.f, file.path(.rstudent_plots_dir, basename(.f)), overwrite = TRUE)
}}

if (length(.rstudent_output) > 0) {{
    cat(paste(.rstudent_output, collapse = "\n"), "\n", sep = "")
}} else if (length(.rstudent_msgs) > 0) {{
    cat(paste(.rstudent_msgs, collapse = "\n"), "\n", sep = "")
}}

invisible()
"#,
        plots = plots_str,
        user = user_file.to_string_lossy().replace("\\", "/")
    );

    std::fs::write(&wrapper_file, &wrapper)
        .map_err(|e| format!("Failed to write wrapper: {}", e))?;

    let output = std::process::Command::new(r_path)
        .args(base_args)
        .arg("--file")
        .arg(&wrapper_file)
        .output()
        .map_err(|e| format!("Failed to execute R: {}. Is R installed?", e))?;

    // Cleanup
    std::fs::remove_file(&user_file).ok();
    std::fs::remove_file(&wrapper_file).ok();

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        Err(format!("R error (exit {:?}):\n{}{}", output.status.code(), stdout, stderr))
    } else {
        Ok(if stderr.is_empty() { stdout } else { format!("{}{}", stdout, stderr) })
    }
}

/// Write a standalone R script (no user code) to a temp file and run it.
fn run_standalone_r_script(r_code: &str, r_path: &str, base_args: &[String]) -> Result<String, String> {
    let script_file = std::env::temp_dir().join(format!("rstudent_run_{}.R", std::process::id()));
    std::fs::write(&script_file, r_code)
        .map_err(|e| format!("Failed to write R script: {}", e))?;

    let output = std::process::Command::new(r_path)
        .args(base_args)
        .arg("--file")
        .arg(&script_file)
        .output()
        .map_err(|e| format!("Failed to execute R: {}", e))?;

    std::fs::remove_file(&script_file).ok();

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        Err(format!("R error (exit {:?}):\n{}{}", output.status.code(), stdout, stderr))
    } else {
        Ok(stdout)
    }
}

// ─── LLM ───

#[tauri::command]
async fn run_llm(request: LlmRequest) -> Result<String, String> {
    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "model": request.model,
        "messages": request.messages,
        "stream": false,
    });

    let response = client
        .post(&request.api_url)
        .header("Authorization", format!("Bearer {}", request.api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("LLM request failed: {}", e))?;

    let data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("LLM parse failed: {}", e))?;

    if let Some(content) = data["choices"][0]["message"]["content"].as_str() {
        return Ok(content.to_string());
    }
    if let Some(content) = data["choices"][0]["text"].as_str() {
        return Ok(content.to_string());
    }
    if let Some(content) = data["response"].as_str() {
        return Ok(content.to_string());
    }

    Err(format!("Unexpected LLM response format: {}", data))
}

// ─── R Commands ───

#[tauri::command]
async fn run_r_code(code: String, app_handle: tauri::AppHandle) -> Result<String, String> {
    let r_path = get_r_path();
    let base_args = get_r_args();
    let plots_dir = get_plots_dir(&app_handle);
    write_and_run_r_with_code(&code, &r_path, &base_args, &plots_dir)
}

#[tauri::command]
async fn knit_rmd(rmd_content: String, app_handle: tauri::AppHandle) -> Result<KnitResult, String> {
    let r_path = get_r_path();
    let base_args = get_r_args();

    // Write Rmd to temp file
    let rmd_file = std::env::temp_dir().join(format!("rstudent_knit_{}.Rmd", std::process::id()));
    std::fs::write(&rmd_file, &rmd_content)
        .map_err(|e| format!("Failed to write Rmd: {}", e))?;
    let rmd_str = rmd_file.to_string_lossy().replace("\\", "/");

    // Build R script to knit
    let r_script = format!(
        r#"library(rmarkdown)
.result <- tryCatch({{
    render("{rmd}", output_format = "pdf_document", quiet = TRUE)
}}, error = function(e) {{
    cat("KNIT_ERROR:", conditionMessage(e), "\n")
    NULL
}})
if (!is.null(.result) && file.exists(.result)) {{
    cat("PDF_PATH:", .result, "\n")
}}
"#,
        rmd = rmd_str
    );

    let stdout = run_standalone_r_script(&r_script, &r_path, &base_args)?;
    std::fs::remove_file(&rmd_file).ok();

    let mut result = KnitResult { pdf: None, html: None, log: stdout.clone() };

    for line in stdout.lines() {
        if let Some(path) = line.strip_prefix("PDF_PATH: ") {
            let path = path.trim();
            if std::path::Path::new(path).exists() {
                result.pdf = Some(path.to_string());
            }
        }
    }

    Ok(result)
}

#[tauri::command]
async fn get_plots(app_handle: tauri::AppHandle) -> Result<Vec<PlotInfo>, String> {
    let plots_dir = get_plots_dir(&app_handle);
    let mut plots = Vec::new();

    if !plots_dir.exists() {
        return Ok(plots);
    }

    let mut entries: Vec<_> = std::fs::read_dir(&plots_dir)
        .map_err(|e| format!("Failed to read plots dir: {}", e))?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map(|ext| ext == "png" || ext == "svg").unwrap_or(false))
        .collect();

    entries.sort_by_key(|e| std::cmp::Reverse(e.path().metadata().ok().and_then(|m| m.modified().ok())));

    for entry in entries.into_iter().take(20) {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        if let Ok(data) = std::fs::read(&path) {
            use base64::Engine;
            let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
            plots.push(PlotInfo {
                path: path.to_string_lossy().to_string(),
                data_url: format!("data:image/png;base64,{}", b64),
                name,
            });
        }
    }

    Ok(plots)
}

#[tauri::command]
async fn get_environment(app_handle: tauri::AppHandle) -> Result<Vec<EnvVar>, String> {
    let r_path = get_r_path();
    let base_args = get_r_args();

    let r_script = r#"
.vars <- ls(.GlobalEnv)
if (length(.vars) > 0) {
  for (.v in .vars) {
    .obj <- get(.v, envir = .GlobalEnv)
    .cls <- class(.obj)[1]
    .desc <- ""
    if (is.data.frame(.obj)) {
      .desc <- sprintf(" (%d obs, %d vars)", nrow(.obj), ncol(.obj))
    } else if (is.matrix(.obj)) {
      .desc <- sprintf(" (%d x %d)", nrow(.obj), ncol(.obj))
    } else if (is.list(.obj)) {
      .desc <- sprintf(" (list, %d)", length(.obj))
    } else if (is.function(.obj)) {
      .desc <- " (function)"
    } else {
      .val <- tryCatch(format(.obj)[1], error = function(e) "?")
      .desc <- paste0(": ", .val)
    }
    cat(sprintf("ENV|%s|%s|%s\n", .v, .cls, .desc))
  }
}
"#;

    let stdout = run_standalone_r_script(r_script, &r_path, &base_args)?;
    let mut vars = Vec::new();

    for line in stdout.lines() {
        if let Some(rest) = line.strip_prefix("ENV|") {
            let parts: Vec<&str> = rest.splitn(3, '|').collect();
            if parts.len() >= 2 {
                vars.push(EnvVar {
                    name: parts[0].to_string(),
                    r#type: parts[1].to_string(),
                    value: parts.get(2).unwrap_or(&"").to_string(),
                });
            }
        }
    }

    Ok(vars)
}

#[tauri::command]
async fn get_packages(app_handle: tauri::AppHandle) -> Result<Vec<PackageInfo>, String> {
    let r_path = get_r_path();
    let base_args = get_r_args();

    let r_script = r#"
.pkgs <- installed.packages(priority = "NA")
if (nrow(.pkgs) > 0) {
  for (.i in 1:nrow(.pkgs)) {
    cat(sprintf("PKG|%s|%s\n", .pkgs[.i, "Package"], .pkgs[.i, "Version"]))
  }
}
"#;

    let stdout = run_standalone_r_script(r_script, &r_path, &base_args)?;
    let mut pkgs = Vec::new();

    for line in stdout.lines() {
        if let Some(rest) = line.strip_prefix("PKG|") {
            let parts: Vec<&str> = rest.splitn(2, '|').collect();
            if parts.len() == 2 {
                pkgs.push(PackageInfo {
                    name: parts[0].to_string(),
                    version: parts[1].to_string(),
                });
            }
        }
    }

    pkgs.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(pkgs)
}

// ─── App entry ───

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            run_llm,
            run_r_code,
            knit_rmd,
            get_plots,
            get_environment,
            get_packages,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
