#!/usr/bin/env bash
# Idempotent bootstrap for the BPM (Tauri + React + Python) development environment.
set -euo pipefail

cd "$(dirname "$0")/.."

# System libraries required to build and run the Tauri (webkit2gtk) desktop app on Linux,
# plus libsndfile for the Python (librosa/soundfile) analyzer.
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  libwebkit2gtk-4.1-dev \
  libjavascriptcoregtk-4.1-dev \
  libsoup-3.0-dev \
  libgtk-3-dev \
  librsvg2-dev \
  libayatana-appindicator3-dev \
  libxdo-dev \
  libssl-dev \
  build-essential \
  curl wget file \
  python3-venv \
  libsndfile1

# Tauri 2's dependency tree requires Cargo's edition2024 feature (Rust >= 1.85).
rustup default stable
rustup update stable

# Frontend dependencies.
npm install

# Python analyzer virtualenv (python/venv + librosa/numpy/soundfile).
npm run python:setup

# Warm the Rust build cache so `tauri dev` launches quickly.
(cd src-tauri && cargo build)
