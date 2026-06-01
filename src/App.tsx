import { useState, useRef, useEffect, useCallback } from "react";

// ─── Types ───
type ConsoleTab = "console" | "terminal" | "jobs";
type RightTab = "environment" | "files" | "plots" | "packages" | "llm" | "settings";
type RStatus = "idle" | "busy" | "error";
type ConsoleMsg = { type: "output" | "error" | "system" | "prompt"; text: string };

interface SourceFile {
  name: string;
  content: string;
  language: "r" | "rmd";
  dirty: boolean;
}

interface EnvVar {
  name: string;
  value: string;
  type: string;
}

interface PlotInfo {
  path: string;
  dataUrl: string;
  name: string;
}

// ─── Default Files ───
var R_CODE = '# RStudent - Welcome\n' +
'# Write R code, run it, and see results below\n' +
'\n' +
'library(ggplot2)\n' +
'data(mtcars)\n' +
'\n' +
'# Example: scatter plot\n' +
'ggplot(mtcars, aes(x = wt, y = mpg)) +\n' +
'  geom_point(color = "' + String.fromCharCode(35) + '00ff41", size = 3) +\n' +
'  theme_minimal() +\n' +
'  labs(title = "MPG vs Weight")\n';

const DEFAULT_R = R_CODE;

const DEFAULT_RMD = 
'---\n' +
'title: "RStudent Report"\n' +
'author: "RStudent User"\n' +
'date: "`r Sys.Date()`"\n' +
'output: pdf_document\n' +
'---\n' +
'\n' +
'## Introduction\n' +
'\n' +
'This is an R Markdown document. You can knit it to PDF.\n' +
'\n' +
'## Code Chunk\n' +
'\n' +
'```{r}\n' +
'summary(mtcars)\n' +
'```\n' +
'\n' +
'## Plot\n' +
'\n' +
'```{r}\n' +
'library(ggplot2)\n' +
'ggplot(mtcars, aes(x=wt, y=mpg)) + geom_point()\n' +
'```\n' +
'';

// ─── R backend interface ───
// Works with Tauri (native) or REST API (Docker)
const BACKEND = {
  isTauri: () => typeof (window as any).__TAURI__ !== "undefined",

  rExecute: async (code: string): Promise<string> => {
    if (BACKEND.isTauri()) {
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        return await invoke("run_r_code", { code });
      } catch (e: any) {
        throw new Error(String(e));
      }
    } else {
      const resp = await fetch("/api/r-execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.text();
    }
  },

  rSourcing: async (fileContent: string): Promise<string> => {
    return BACKEND.rExecute(fileContent);
  },

  rKnitRmd: async (rmdContent: string): Promise<{ pdf?: string; html?: string; log: string }> => {
    if (BACKEND.isTauri()) {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke("knit_rmd", { rmdContent });
    } else {
      const resp = await fetch("/api/r-knit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rmdContent }),
      });
      return await resp.json();
    }
  },

  getPlots: async (): Promise<PlotInfo[]> => {
    if (BACKEND.isTauri()) {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke("get_plots");
    } else {
      const resp = await fetch("/api/plots");
      return await resp.json();
    }
  },

  getEnvironment: async (): Promise<EnvVar[]> => {
    if (BACKEND.isTauri()) {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke("get_environment");
    } else {
      const resp = await fetch("/api/environment");
      return await resp.json();
    }
  },

  getPackages: async (): Promise<{ name: string; version: string }[]> => {
    if (BACKEND.isTauri()) {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke("get_packages");
    } else {
      const resp = await fetch("/api/packages");
      return await resp.json();
    }
  },

  llmAsk: async (messages: { role: string; content: string }[], apiKey: string, apiUrl: string, model: string): Promise<string> => {
    if (BACKEND.isTauri()) {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke("run_llm", {
        request: { messages, api_key: apiKey, api_url: apiUrl, model },
      });
    } else {
      const resp = await fetch("/api/llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, api_key: apiKey, api_url: apiUrl, model }),
      });
      const data = await resp.json();
      return data.content || data.response || JSON.stringify(data);
    }
  },
};

// ─── App ───
export default function App() {
  // Source files
  const [files, setFiles] = useState<SourceFile[]>([
    { name: "untitled.R", content: DEFAULT_R, language: "r", dirty: false },
  ]);
  const [activeFileIdx, setActiveFileIdx] = useState(0);

  // Console
  const [consoleTab, setConsoleTab] = useState<ConsoleTab>("console");
  const [consoleMsgs, setConsoleMsgs] = useState<ConsoleMsg[]>([
    { type: "system", text: 'RStudent v0.2.0 — "Cactus Code"' },
    { type: "system", text: 'R backend: ' + (BACKEND.isTauri() ? 'Tauri native' : 'REST API') },
    { type: "system", text: 'Type "help()" for help.' },
    { type: "prompt", text: "" },
  ]);
  const [consoleInput, setConsoleInput] = useState("");
  const [rStatus, setRStatus] = useState<RStatus>("idle");

  // Right panel
  const [rightTab, setRightTab] = useState<RightTab>("llm");

  // LLM
  const [llmMessages, setLlmMessages] = useState<{ role: string; content: string }[]>([
    { role: "assistant", content: "¡Hola! I'm RStudent's AI assistant. Ask me about R, data science, or help with your code." },
  ]);
  const [llmInput, setLlmInput] = useState("");
  const [llmLoading, setLlmLoading] = useState(false);

  // Settings
  const [apiKey, setApiKey] = useState("");
  const [apiUrl, setApiUrl] = useState("http://localhost:8080/v1/chat/completions");
  const [llmModel, setLlmModel] = useState("opencode");
  const [rPath, setRPath] = useState("R");
  const [rArgs, setRArgs] = useState("--no-save --no-restore");

  // Environment
  const [envVars, setEnvVars] = useState<EnvVar[]>([]);
  const [packages, setPackages] = useState<{ name: string; version: string }[]>([]);

  // Plots
  const [plots, setPlots] = useState<PlotInfo[]>([]);

  // Files browser
  const [fileBrowser, setFileBrowser] = useState<{ name: string; isDir: boolean }[]>([
    { name: "data", isDir: true },
    { name: "plots", isDir: true },
    { name: "analysis.R", isDir: false },
    { name: "utils.R", isDir: false },
  ]);

  // Modals
  const [showNewFile, setShowNewFile] = useState<"r" | "rmd" | null>(null);
  const [showKnitResult, setShowKnitResult] = useState<{ pdf: string; log: string } | null>(null);

  // Refs
  const consoleRef = useRef<HTMLDivElement>(null);
  const llmRef = useRef<HTMLDivElement>(null);

  // Auto-scroll
  useEffect(() => { consoleRef.current?.scrollTo(0, consoleRef.current.scrollHeight); }, [consoleMsgs]);
  useEffect(() => { llmRef.current?.scrollTo(0, llmRef.current.scrollHeight); }, [llmMessages]);

  // ─── Console ───
  const appendConsole = useCallback((msgs: ConsoleMsg[]) => {
    setConsoleMsgs(prev => [...prev.slice(0, -1), ...msgs, { type: "prompt", text: "" }]);
  }, []);

  const handleConsoleCmd = useCallback(async () => {
    const cmd = consoleInput.trim();
    if (!cmd) return;

    appendConsole([{ type: "prompt", text: `> ${cmd}` }]);
    setConsoleInput("");
    setRStatus("busy");

    try {
      const result = await BACKEND.rExecute(cmd);
      appendConsole([{ type: "output", text: result }]);
      setRStatus("idle");
    } catch (e: any) {
      appendConsole([{ type: "error", text: `Error: ${e.message || e}` }]);
      setRStatus("error");
    }
  }, [consoleInput, appendConsole]);

  // ─── Source files ───
  const activeFile = files[activeFileIdx] || files[0];

  const updateFileContent = useCallback((content: string) => {
    setFiles(prev => prev.map((f, i) => i === activeFileIdx ? { ...f, content, dirty: true } : f));
  }, [activeFileIdx]);

  const addNewFile = useCallback((lang: "r" | "rmd") => {
    const idx = files.length;
    const ext = lang === "r" ? ".R" : ".Rmd";
    const name = `untitled${idx > 0 ? idx : ""}${ext}`;
    const content = lang === "r"
      ? "# New R script\n\n"
      : '---\ntitle: "Untitled"\noutput: pdf_document\n---\n\n```{r}\n\n```\n';

    setFiles(prev => [...prev, { name, content, language: lang, dirty: false }]);
    setActiveFileIdx(idx);
    setShowNewFile(null);
  }, [files.length]);

  const closeFile = useCallback((idx: number) => {
    if (files.length <= 1) return;
    setFiles(prev => prev.filter((_, i) => i !== idx));
    if (activeFileIdx >= idx && activeFileIdx > 0) {
      setActiveFileIdx(prev => prev - 1);
    }
  }, [files.length, activeFileIdx]);

  // ─── Run source ───
  const runSource = useCallback(async () => {
    if (!activeFile) return;
    appendConsole([{ type: "system", text: `> Running ${activeFile.name}...` }]);
    setRStatus("busy");

    try {
      const result = await BACKEND.rSourcing(activeFile.content);
      appendConsole([{ type: "output", text: result }]);
      setRStatus("idle");

      // Refresh environment & plots
      BACKEND.getEnvironment().then(setEnvVars).catch(() => {});
      BACKEND.getPlots().then(setPlots).catch(() => {});
    } catch (e: any) {
      appendConsole([{ type: "error", text: `Error: ${e.message || e}` }]);
      setRStatus("error");
    }
  }, [activeFile, appendConsole]);

  // ─── Knit RMarkdown ───
  const knitRmd = useCallback(async () => {
    if (!activeFile || activeFile.language !== "rmd") return;
    appendConsole([{ type: "system", text: `> Knitting ${activeFile.name} to PDF...` }]);
    setRStatus("busy");

    try {
      const result = await BACKEND.rKnitRmd(activeFile.content);
      appendConsole([{ type: "output", text: result.log }]);
      if (result.pdf) {
        setShowKnitResult({ pdf: result.pdf, log: result.log });
      }
      setRStatus("idle");
    } catch (e: any) {
      appendConsole([{ type: "error", text: `Knit error: ${e.message || e}` }]);
      setRStatus("error");
    }
  }, [activeFile, appendConsole]);

  // ─── LLM ───
  const handleLlmSend = useCallback(async () => {
    if (!llmInput.trim() || llmLoading) return;

    const userMsg = { role: "user", content: llmInput };
    setLlmMessages(prev => [...prev, userMsg]);
    setLlmInput("");
    setLlmLoading(true);

    try {
      const messages = [...llmMessages, userMsg].map(m => ({ role: m.role, content: m.content }));
      const url = apiUrl || "http://localhost:8080/v1/chat/completions";
      const model = llmModel || "opencode";
      const response = await BACKEND.llmAsk(messages, apiKey, url, model);
      setLlmMessages(prev => [...prev, { role: "assistant", content: response }]);
    } catch (e: any) {
      setLlmMessages(prev => [...prev, { role: "assistant", content: `⚠ Error: ${e.message || e}` }]);
    }
    setLlmLoading(false);
  }, [llmInput, llmMessages, llmLoading, apiKey, apiUrl, llmModel]);

  // ─── Keyboard shortcuts ───
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl+Enter or Cmd+Enter: run current file
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        runSource();
      }
      // Ctrl+Shift+Enter: run selection
      if (e.ctrlKey && e.shiftKey && e.key === "Enter") {
        e.preventDefault();
        runSource();
      }
      // Ctrl+S: save (mark clean)
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        setFiles(prev => prev.map((f, i) => i === activeFileIdx ? { ...f, dirty: false } : f));
      }
      // Ctrl+N: new R file
      if ((e.ctrlKey || e.metaKey) && e.key === "n" && !e.shiftKey) {
        e.preventDefault();
        addNewFile("r");
      }
      // Ctrl+Shift+N: new Rmd
      if ((e.ctrlKey || e.metaKey) && e.key === "n" && e.shiftKey) {
        e.preventDefault();
        addNewFile("rmd");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [runSource, activeFileIdx, addNewFile]);

  // ─── Toolbar icon ───
  const CactusIcon = () => (
    <svg viewBox="0 0 100 100" fill="none" width="18" height="18">
      <rect width="100" height="100" fill="#2d2d2d" rx="4"/>
      <g fontFamily="'Courier New',monospace" fontWeight="bold" fill="#00ff41">
        <text x="50" y="31" fontSize="7" textAnchor="middle">[ ]</text>
        <text x="36" y="41" fontSize="7" textAnchor="middle">[ ]</text>
        <text x="50" y="41" fontSize="7" textAnchor="middle">{ }</text>
        <text x="64" y="41" fontSize="7" textAnchor="middle">&lt; &gt;</text>
        <text x="36" y="51" fontSize="7" textAnchor="middle">&lt; &gt;</text>
        <text x="50" y="51" fontSize="7" textAnchor="middle">{ }</text>
        <text x="64" y="51" fontSize="7" textAnchor="middle">&lt; &gt;</text>
        <text x="36" y="61" fontSize="7" textAnchor="middle">&lt; &gt;</text>
        <text x="50" y="61" fontSize="7" textAnchor="middle">[ ]</text>
        <text x="64" y="61" fontSize="7" textAnchor="middle">&lt; &gt;</text>
        <text x="50" y="71" fontSize="7" textAnchor="middle">&lt; &gt;</text>
        <text x="50" y="82" fontSize="7" textAnchor="middle">&gt; _</text>
      </g>
    </svg>
  );

  // ─── Render ───
  return (
    <div className="rstudio-layout">
      {/* ── Toolbar ── */}
      <div className="toolbar">
        <div className="toolbar-logo">
          <CactusIcon />
          <span>RStudent</span>
        </div>
        <div className="toolbar-tabs">
          <span className="toolbar-tab active">File</span>
          <span className="toolbar-tab">Edit</span>
          <span className="toolbar-tab">Code</span>
          <span className="toolbar-tab">View</span>
          <span className="toolbar-tab">Plots</span>
          <span className="toolbar-tab">Help</span>
        </div>
        <div className="toolbar-actions">
          <button className="toolbar-btn" onClick={() => setShowNewFile("r")} title="New R script (Ctrl+N)">+ R</button>
          <button className="toolbar-btn" onClick={() => setShowNewFile("rmd")} title="New R Markdown (Ctrl+Shift+N)">+ Rmd</button>
          <button className="toolbar-btn primary" onClick={runSource} title="Run source (Ctrl+Enter)">▶ Run</button>
          {activeFile?.language === "rmd" && (
            <button className="toolbar-btn primary" onClick={knitRmd} title="Knit to PDF">📄 Knit</button>
          )}
        </div>
      </div>

      {/* ── Main Grid ── */}
      <div className="main-grid">
        {/* ── Left Column ── */}
        <div className="left-column">
          {/* Source Editor */}
          <div className="source-panel">
            <div className="source-tabs">
              {files.map((f, i) => (
                <div
                  key={i}
                  className={`source-tab ${i === activeFileIdx ? "active" : ""}`}
                  onClick={() => setActiveFileIdx(i)}
                >
                  <span className="source-tab-icon">{f.language === "rmd" ? "📄" : "📋"}</span>
                  {f.name}{f.dirty ? " ●" : ""}
                  <span className="source-tab-close" onClick={(e) => { e.stopPropagation(); closeFile(i); }}>×</span>
                </div>
              ))}
            </div>
            <div className="source-editor">
              <textarea
                value={activeFile?.content || ""}
                onChange={(e) => updateFileContent(e.target.value)}
                spellCheck={false}
                placeholder="Write your R/RMarkdown code here..."
              />
            </div>
          </div>

          {/* Console */}
          <div className="console-panel">
            <div className="console-tabs">
              <span className={`console-tab ${consoleTab === "console" ? "active" : ""}`} onClick={() => setConsoleTab("console")}>Console</span>
              <span className={`console-tab ${consoleTab === "terminal" ? "active" : ""}`} onClick={() => setConsoleTab("terminal")}>Terminal</span>
              <span className={`console-tab ${consoleTab === "jobs" ? "active" : ""}`} onClick={() => setConsoleTab("jobs")}>Jobs</span>
            </div>

            {consoleTab === "console" && (
              <>
                <div className="console-body" ref={consoleRef}>
                  {consoleMsgs.slice(0, -1).map((msg, i) => (
                    <div key={i} className={`console-line ${msg.type}`}>
                      {msg.type === "prompt" ? `> ${msg.text}` : msg.text}
                      {msg.type === "prompt" && <span className="blinking-cursor">▊</span>}
                    </div>
                  ))}
                </div>
                <div className="console-input-row">
                  <span className="console-prompt-symbol">&gt;</span>
                  <div className="console-input-area">
                    <input
                      className="console-input-true"
                      value={consoleInput}
                      onChange={(e) => setConsoleInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleConsoleCmd()}
                      placeholder="Type R code and press Enter..."
                    />
                  </div>
                </div>
              </>
            )}
            {consoleTab === "terminal" && (
              <div className="console-body" style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}>
                Terminal — coming soon (uses Tauri shell plugin)
              </div>
            )}
            {consoleTab === "jobs" && (
              <div className="console-body" style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}>
                Jobs — background R job management coming soon
              </div>
            )}
          </div>
        </div>

        {/* ── Right Column ── */}
        <div className="right-column">
          <div className="right-tabs">
            <span className={`right-tab ${rightTab === "llm" ? "active" : ""}`} onClick={() => setRightTab("llm")}>🤖 LLM</span>
            <span className={`right-tab ${rightTab === "environment" ? "active" : ""}`} onClick={() => setRightTab("environment")}>Env</span>
            <span className={`right-tab ${rightTab === "files" ? "active" : ""}`} onClick={() => setRightTab("files")}>Files</span>
            <span className={`right-tab ${rightTab === "plots" ? "active" : ""}`} onClick={() => setRightTab("plots")}>Plots</span>
            <span className={`right-tab ${rightTab === "packages" ? "active" : ""}`} onClick={() => setRightTab("packages")}>Pkgs</span>
            <span className={`right-tab ${rightTab === "settings" ? "active" : ""}`} onClick={() => setRightTab("settings")}>⚙</span>
          </div>

          <div className="right-content">
            {rightTab === "environment" && (
              <div>
                <div className="env-header">Global Environment</div>
                {envVars.length === 0 && (
                  <div className="env-entry" style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
                    Empty — run some R code to populate
                  </div>
                )}
                {envVars.map((v, i) => (
                  <div key={i} className="env-entry">
                    <span className="env-name">{v.name}</span>
                    <span className="env-value">&lt;{v.type}&gt; {v.value}</span>
                  </div>
                ))}
              </div>
            )}

            {rightTab === "files" && (
              <div>
                <div className="env-header">~/RStudent/</div>
                {fileBrowser.map((f, i) => (
                  <div key={i} className="file-entry">
                    {f.isDir ? (
                      <span style={{ color: "var(--accent-dim)" }}>📁 {f.name}/</span>
                    ) : f.name.endsWith(".R") ? (
                      <span className="file-r">📋 {f.name}</span>
                    ) : f.name.endsWith(".Rmd") ? (
                      <span className="file-rmd">📄 {f.name}</span>
                    ) : (
                      <span className="file-other">📄 {f.name}</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {rightTab === "plots" && (
              <div className="plots-area">
                {plots.length === 0 ? (
                  <div className="plots-empty">
                    <div style={{ fontSize: 24, marginBottom: 8 }}>📊</div>
                    <div>No plots yet</div>
                    <div style={{ fontSize: 11, marginTop: 4 }}>Run a plot command in R to generate one</div>
                  </div>
                ) : (
                  plots.map((p, i) => (
                    <div key={i}>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{p.name}</div>
                      <img src={p.dataUrl} alt={p.name} />
                    </div>
                  ))
                )}
              </div>
            )}

            {rightTab === "packages" && (
              <div>
                <div className="env-header">Installed Packages</div>
                {packages.length === 0 ? (
                  <div className="env-entry" style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
                    Run R to load package list
                  </div>
                ) : (
                  packages.map((p, i) => (
                    <div key={i} className="pkg-entry">
                      <span className="pkg-name">{p.name}</span>
                      <span className="pkg-version">{p.version}</span>
                    </div>
                  ))
                )}
              </div>
            )}

            {rightTab === "llm" && (
              <div className="llm-panel">
                <div className="llm-messages" ref={llmRef}>
                  {llmMessages.map((msg, i) => (
                    <div key={i} className={`llm-message ${msg.role} ${i === llmMessages.length - 1 && llmLoading ? "thinking" : ""}`}>
                      {msg.content}
                    </div>
                  ))}
                  {llmLoading && (
                    <div className="llm-message thinking">Thinking...</div>
                  )}
                </div>
                <div className="llm-input-area">
                  <textarea
                    className="llm-input"
                    rows={2}
                    placeholder="Ask AI about R, data science..."
                    value={llmInput}
                    onChange={(e) => setLlmInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), handleLlmSend())}
                    disabled={llmLoading}
                  />
                  <button className="llm-send" onClick={handleLlmSend} disabled={llmLoading || !llmInput.trim()}>
                    {llmLoading ? "..." : "→"}
                  </button>
                </div>
              </div>
            )}

            {rightTab === "settings" && (
              <div className="settings-panel">
                <h3>🔌 LLM Connection</h3>
                <div className="settings-group">
                  <label>API URL</label>
                  <input type="text" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} placeholder="http://localhost:8080/v1/chat/completions" />
                </div>
                <div className="settings-group">
                  <label>Model</label>
                  <input type="text" value={llmModel} onChange={(e) => setLlmModel(e.target.value)} placeholder="opencode / gpt-4 / claude..." />
                </div>
                <div className="settings-group">
                  <label>API Key</label>
                  <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." />
                </div>

                <h3 style={{ marginTop: 20 }}>🖥 R Backend</h3>
                <div className="settings-group">
                  <label>R Path</label>
                  <input type="text" value={rPath} onChange={(e) => setRPath(e.target.value)} placeholder="R" />
                </div>
                <div className="settings-group">
                  <label>R Arguments</label>
                  <input type="text" value={rArgs} onChange={(e) => setRArgs(e.target.value)} placeholder="--no-save --no-restore" />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Status Bar ── */}
      <div className="status-bar">
        <div className="status-section">
          <span className={`status-dot ${rStatus}`}></span>
          <span>R {rStatus === "idle" ? "ready" : rStatus}</span>
        </div>
        <div className="status-section">
          <span>R 4.3+</span>
        </div>
        <div className="status-section" style={{ marginLeft: "auto" }}>
          <span>{activeFile?.name || "no file"}</span>
        </div>
        <div className="status-section">
          <span>UTF-8</span>
        </div>
      </div>

      {/* ── New File Dialog ── */}
      {showNewFile && (
        <div className="dialog-overlay" onClick={() => setShowNewFile(null)}>
          <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
            <h3>New {showNewFile === "r" ? "R Script" : "R Markdown"}</h3>
            <button className="dialog-btn primary" onClick={() => addNewFile(showNewFile)}>Create</button>
            <button className="dialog-btn" onClick={() => setShowNewFile(null)}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── Knit Result Dialog ── */}
      {showKnitResult && (
        <div className="dialog-overlay" onClick={() => setShowKnitResult(null)}>
          <div className="dialog-box" onClick={(e) => e.stopPropagation()}>
            <h3>📄 Knit Result</h3>
            {showKnitResult.pdf && (
              <div style={{ marginBottom: 12 }}>
                <a
                  href={showKnitResult.pdf}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--accent)" }}
                >
                  📥 Download PDF
                </a>
              </div>
            )}
            <textarea
              readOnly
              value={showKnitResult.log}
              style={{ minHeight: 150, width: "100%" }}
            />
            <div className="dialog-actions">
              <button className="dialog-btn primary" onClick={() => setShowKnitResult(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
