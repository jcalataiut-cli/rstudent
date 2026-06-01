# RStudent 🌵

**RStudio/Positron-inspired IDE** for R with AI integration. Built with React + Tauri 2.

Neon green cactus. Code as a desert bloom. 🦎

## Quick Start (Docker) — Recommended

The easiest way to run RStudent with full R + RMarkdown + PDF support:

```bash
# Clone or cd into RStudent/
docker compose up -d
# Open http://localhost:1420
```

This gives you:
- ✅ R 4.4 with ggplot2, dplyr, rmarkdown, knitr
- ✅ Pandoc for .Rmd → PDF conversion
- ✅ Persistent R packages (survive container restarts)
- ✅ Plot storage
- ✅ Mount your R projects at `./projects/`

### First run

Docker will build the image (~5-10 min first time). It installs R packages and TinyTeX for LaTeX/PDF output.

To stop: `docker compose down`

## Development Mode (with hot-reload)

```bash
docker compose --profile dev up -d
```

This starts:
- Vite dev server on port 1420 (hot-reload frontend)
- Node API server on port 3001
- R backend inside the container

## Local Development (without Docker)

You need:
- Node.js 18+
- R 4.0+ (with rmarkdown, knitr, ggplot2, dplyr installed)
- Pandoc (for .Rmd → PDF)
- Rust (for Tauri build)

```bash
# Frontend only (no R execution, no Tauri)
npm install
npm run dev
# Open http://localhost:1420

# With API server (for R execution in browser)
node server.js  # starts on port 3001
# Then open http://localhost:1420

# With Tauri (full native app)
npm install
npm run tauri dev
```

## Features

### RStudio/Positron-like Layout
- Multi-tab source editor (.R and .Rmd)
- Interactive R console with execution
- Environment browser
- Plot viewer (auto-captures R plots)
- Package manager view
- File browser

### AI Integration
- Built-in LLM chat panel
- OpenAI-compatible endpoint (works with Opencode, Ollama, any provider)
- Ask about R code, debug errors, get explanations

### Real R Backend
- Executes R via `Rscript` (Tauri native) or REST API (Docker)
- Captures all output (stdout, messages, errors)
- Auto-saves plots as PNGs → displayed in Plots tab
- Environment variable inspection
- Packages listing

### R Markdown (Rmd)
- Create and edit .Rmd files
- Knit to PDF via `rmarkdown::render()` + pandoc
- Keyboard shortcuts: Ctrl+Enter (run), Ctrl+S (save)

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+Enter | Run current file |
| Ctrl+S | Save file |
| Ctrl+N | New R script |
| Ctrl+Shift+N | New R Markdown |
| Tab | Indent selection |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RSTUDENT_R_PATH` | `R` | Path to R binary |
| `RSTUDENT_R_ARGS` | `--no-save --no-restore --quiet` | R CLI arguments |
| `RSTUDENT_PLOTS_DIR` | `./data/plots` | Where R saves plots |

## Structure

```
RStudent/
├── src/                  # Frontend React
│   ├── App.tsx           # RStudio-like layout + state
│   ├── main.tsx          # Entry point
│   └── styles.css        # Dark theme with neon accents
├── src-tauri/            # Tauri 2 Rust backend
│   ├── src/lib.rs        # R execution, LLM, plots, env
│   └── Cargo.toml
├── server.js             # Node.js API server (Docker mode)
├── run-r.R               # R runner script (Docker mode)
├── Dockerfile            # Full R + frontend + API
├── docker-compose.yml    # One-command setup
└── README.md
```

## License

MIT
