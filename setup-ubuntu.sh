#!/bin/bash
# RStudent - Quick setup for Ubuntu 22
# Run: bash setup-ubuntu.sh

set -e

echo "🌵 RStudent Setup for Ubuntu 22"
echo "================================"

# 1. System dependencies
echo ""
echo "📦 Installing system dependencies..."
sudo apt-get update
sudo apt-get install -y \
    curl wget \
    nodejs npm \
    pandoc \
    libwebkit2gtk-4.1-dev \
    libgtk-3-dev \
    libappindicator3-dev \
    librsvg2-dev \
    libjavascriptcoregtk-4.1-dev \
    libsoup-3.0-dev

# 2. Install R
echo ""
echo "📊 Installing R..."
# Add CRAN repo for Ubuntu 22
sudo apt-get install -y --no-install-recommends software-properties-common dirmngr
wget -qO- https://cloud.r-project.org/bin/linux/ubuntu/marutter_pubkey.asc | sudo gpg --dearmor -o /usr/share/keyrings/cran-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/cran-keyring.gpg] https://cloud.r-project.org/bin/linux/ubuntu jammy-cran40/" | sudo tee /etc/apt/sources.list.d/cran.list
sudo apt-get update
sudo apt-get install -y r-base r-base-dev

# 3. Install R packages
echo ""
echo "📦 Installing R packages (this may take a while)..."
sudo R -e "install.packages(c('rmarkdown', 'knitr', 'ggplot2', 'dplyr', 'tidyr', 'jsonlite', 'base64enc'), repos='https://cloud.r-project.org')" || echo "⚠ Some R packages failed, continuing..."

# 4. Install Rust (for Tauri)
echo ""
echo "🦀 Installing Rust..."
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"

# 5. Install npm dependencies
echo ""
echo "📦 Installing npm packages..."
cd "$(dirname "$0")"
npm install

# 6. Build frontend
echo ""
echo "🔨 Building frontend..."
npm run build

echo ""
echo "✅ RStudent is ready!"
echo ""
echo "📋 To run with Tauri (native app):"
echo "   npm run tauri dev"
echo ""
echo "🌐 To run in browser only:"
echo "   npm run dev"
echo "   (Open http://localhost:1420 — R execution won't work in browser mode)"
echo ""
echo "💡 For full functionality, use Tauri: npm run tauri dev"
