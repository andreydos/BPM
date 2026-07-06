# BPM

Local offline DJ track browser built with **Tauri + React + Python**.

## Features (MVP progress)

- Choose a music folder and scan tracks recursively
- SQLite persistence with rescan deduplication
- Analyze selected tracks or all tracks via Python CLI
- BPM, raw features, and normalized Energy (1–10) in the table
- Batch analysis queue with progress events
- Two-deck preview with waveform, play/pause, seek, crossfader
- Optional simple BPM sync via `playbackRate`

## Requirements

- Node.js 20+
- Rust (via [rustup](https://rustup.rs))
- Python 3.11+
- macOS build tools for native deps (Xcode CLT)

## Setup

```bash
cd ~/WebstormProjects/BPM
npm install
npm run python:setup
```

## Development

```bash
npm run tauri:dev
```

## Python analyzer

```bash
./python/venv/bin/python python/analyze_track.py "/path/to/track.mp3"
```

Example output:

```json
{
  "duration": 384.2,
  "bpm": 124.0,
  "rms": 0.18,
  "onset_rate": 3.4,
  "spectral_centroid": 2650,
  "energy_raw": 0.72
}
```

## Architecture

- **Frontend**: React + TypeScript (`src/`)
- **Backend**: Rust Tauri commands (`src-tauri/src/`)
- **Database**: SQLite in app data dir (`bpm.db`)
- **Analysis**: `python/analyze_track.py` (librosa)
- **Decks**: `wavesurfer.js` + Web Audio volume / playbackRate
