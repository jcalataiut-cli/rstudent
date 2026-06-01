// RStudent combined server — serves frontend + API
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const os = require("os");

const PORT = 80;
const R_PATH = process.env.RSTUDENT_R_PATH || "R";
const R_ARGS = (process.env.RSTUDENT_R_ARGS || "--no-save --no-restore --quiet").split(" ");
const PLOTS_DIR = process.env.RSTUDENT_PLOTS_DIR || "/app/data/plots";
const DIST_DIR = path.join(__dirname, "dist");

fs.mkdirSync(PLOTS_DIR, { recursive: true });

// ─── MIME types ───
const MIME = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

// ─── Serve static files ───
function serveStatic(url, res) {
  let filePath = path.join(DIST_DIR, url === "/" ? "index.html" : url);
  
  // SPA fallback
  if (!fs.existsSync(filePath)) {
    filePath = path.join(DIST_DIR, "index.html");
  }

  const ext = path.extname(filePath);
  const contentType = MIME[ext] || "application/octet-stream";

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
    } else {
      res.writeHead(200, { "Content-Type": contentType });
      res.end(data);
    }
  });
}

// ─── R execution ───
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      try { resolve(JSON.parse(body)); } catch (e) { reject(new Error("Invalid JSON")); }
    });
  });
}

function runRCode(code) {
  const userFile = path.join(os.tmpdir(), `rstudent_user_${Date.now()}.R`);
  const wrapperFile = path.join(os.tmpdir(), `rstudent_wrap_${Date.now()}.R`);

  fs.writeFileSync(userFile, code, "utf-8");

  const plots = PLOTS_DIR.replace(/\\/g, "/");
  const wrapper = `
options(width = 120)
.rstudent_plots_dir <- "${plots}"
dir.create(.rstudent_plots_dir, showWarnings = FALSE, recursive = TRUE)
options(device = function(...) {
  png(filename = tempfile("rstudent_plot_", fileext = ".png"), width = 800, height = 600, res = 90)
})
.rstudent_output <- capture.output({
  .rstudent_msgs <- capture.output({
    tryCatch({
      source("${userFile.replace(/\\/g, "/")}", local = FALSE, keep.source = TRUE)
    }, error = function(e) {
      cat("Error: ", conditionMessage(e), "\\n")
    }, warning = function(w) {
      cat("Warning: ", conditionMessage(w), "\\n")
    })
  }, type = "message")
}, type = "output")
while (dev.cur() > 1) dev.off()
.rstudent_plots <- list.files(tempdir(), pattern = "^rstudent_plot_.*\\.png$", full.names = TRUE)
for (.f in .rstudent_plots) {
  file.copy(.f, file.path(.rstudent_plots_dir, basename(.f)), overwrite = TRUE)
}
if (length(.rstudent_output) > 0) cat(paste(.rstudent_output, collapse = "\\n"), "\\n", sep = "")
else if (length(.rstudent_msgs) > 0) cat(paste(.rstudent_msgs, collapse = "\\n"), "\\n", sep = "")
`;

  fs.writeFileSync(wrapperFile, wrapper, "utf-8");

  return new Promise((resolve, reject) => {
    execFile(R_PATH, [...R_ARGS, "--file", wrapperFile], { maxBuffer: 100 * 1024 * 1024 }, (error, stdout, stderr) => {
      try { fs.unlinkSync(userFile); } catch(e) {}
      try { fs.unlinkSync(wrapperFile); } catch(e) {}
      if (error) reject(new Error(stderr || stdout || error.message));
      else resolve(stdout.trim());
    });
  });
}

function runRScript(code) {
  const tmpFile = path.join(os.tmpdir(), `rstudent_run_${Date.now()}.R`);
  fs.writeFileSync(tmpFile, code, "utf-8");
  return new Promise((resolve, reject) => {
    execFile(R_PATH, [...R_ARGS, "--file", tmpFile], { maxBuffer: 100 * 1024 * 1024 }, (error, stdout, stderr) => {
      try { fs.unlinkSync(tmpFile); } catch(e) {}
      if (error) reject(new Error(stderr || stdout || error.message));
      else resolve(stdout);
    });
  });
}

// ─── JSON helper ───
function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(data));
}

// ─── HTTP Server ───
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  try {
    // ── API routes ──
    if (pathname === "/api/r-execute" && req.method === "POST") {
      const { code } = await readBody(req);
      const output = await runRCode(code);
      return json(res, 200, { content: output });
    }

    if (pathname === "/api/r-knit" && req.method === "POST") {
      const { rmdContent } = await readBody(req);
      const rmdFile = path.join(os.tmpdir(), `rstudent_rmd_${Date.now()}.Rmd`);
      fs.writeFileSync(rmdFile, rmdContent, "utf-8");
      const rScript = `
library(rmarkdown)
.result <- tryCatch({
  render("${rmdFile.replace(/\\/g, "/")}", output_format = "pdf_document", quiet = TRUE)
}, error = function(e) { cat("KNIT_ERROR:", conditionMessage(e), "\\n"); NULL })
if (!is.null(.result) && file.exists(.result)) cat("PDF_PATH:", .result, "\\n")
unlink("${rmdFile.replace(/\\/g, "/")}")
`;
      const output = await runRScript(rScript);
      try { fs.unlinkSync(rmdFile); } catch(e) {}
      return json(res, 200, { log: output });
    }

    if (pathname === "/api/environment" && req.method === "GET") {
      const output = await runRScript(`
.vars <- ls(.GlobalEnv)
if (length(.vars) > 0) {
  for (.v in .vars) {
    .obj <- get(.v, envir = .GlobalEnv); .cls <- class(.obj)[1]; .desc <- ""
    if (is.data.frame(.obj)) .desc <- sprintf("(%d obs, %d vars)", nrow(.obj), ncol(.obj))
    else if (is.matrix(.obj)) .desc <- sprintf("(%d x %d)", nrow(.obj), ncol(.obj))
    else if (is.list(.obj)) .desc <- sprintf("(list, %d)", length(.obj))
    else if (is.function(.obj)) .desc <- "(function)"
    else { .val <- tryCatch(format(.obj)[1], error=function(e)"?"); .desc <- .val }
    cat(sprintf("ENV|%s|%s|%s\\n", .v, .cls, .desc))
  }
}
`);
      const vars = [];
      for (const line of output.split("\n")) {
        const m = line.match(/^ENV\|(.+?)\|(.+?)\|(.+)$/);
        if (m) vars.push({ name: m[1], type: m[2], value: m[3] });
      }
      return json(res, 200, vars);
    }

    if (pathname === "/api/packages" && req.method === "GET") {
      const output = await runRScript(`
.pkgs <- installed.packages(priority = "NA")
if (nrow(.pkgs) > 0) for (.i in 1:nrow(.pkgs)) cat(sprintf("PKG|%s|%s\\n", .pkgs[.i, "Package"], .pkgs[.i, "Version"]))
`);
      const pkgs = [];
      for (const line of output.split("\n")) {
        const m = line.match(/^PKG\|(.+?)\|(.+)$/);
        if (m) pkgs.push({ name: m[1], version: m[2] });
      }
      pkgs.sort((a, b) => a.name.localeCompare(b.name));
      return json(res, 200, pkgs);
    }

    if (pathname === "/api/plots" && req.method === "GET") {
      if (!fs.existsSync(PLOTS_DIR)) return json(res, 200, []);
      const files = fs.readdirSync(PLOTS_DIR).filter(f => f.endsWith(".png")).sort().reverse().slice(0, 20);
      const plots = files.map(f => {
        const p = path.join(PLOTS_DIR, f);
        const b64 = fs.readFileSync(p).toString("base64");
        return { name: f, path: p, data_url: `data:image/png;base64,${b64}` };
      });
      return json(res, 200, plots);
    }

    if (pathname === "/api/llm" && req.method === "POST") {
      const { messages, api_key, api_url, model } = await readBody(req);
      const resp = await fetch(api_url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${api_key}` },
        body: JSON.stringify({ model, messages, stream: false }),
      });
      const data = await resp.json();
      const content = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || data?.response || JSON.stringify(data);
      return json(res, 200, { content });
    }

    // ── Static files ──
    if (pathname.startsWith("/api/")) {
      return json(res, 404, { error: "Not found" });
    }

    serveStatic(pathname, res);

  } catch (e) {
    console.error("Error:", e.message);
    json(res, 500, { error: e.message || "Internal error" });
  }
});

server.listen(PORT, () => {
  console.log(`RStudent server running on http://localhost:${PORT}`);
});
