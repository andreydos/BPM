#!/usr/bin/env python3
"""Analyze an audio track and return JSON features."""

from __future__ import annotations

import json
import sys

import librosa
import numpy as np


def analyze(path: str) -> dict:
    y, sr = librosa.load(path, sr=None, mono=True)
    duration = float(librosa.get_duration(y=y, sr=sr))

    tempo, _ = librosa.beat.beat_track(y=y, sr=sr)
    bpm = float(tempo) if np.isscalar(tempo) else float(tempo[0])

    rms = float(np.sqrt(np.mean(y**2)))
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    onset_rate = float(np.mean(onset_env))
    spectral_centroid = float(np.mean(librosa.feature.spectral_centroid(y=y, sr=sr)))
    energy_raw = float(rms * onset_rate * (spectral_centroid / 3000.0))

    return {
        "duration": round(duration, 2),
        "bpm": round(bpm, 1),
        "rms": round(rms, 4),
        "onset_rate": round(onset_rate, 2),
        "spectral_centroid": round(spectral_centroid, 0),
        "energy_raw": round(energy_raw, 4),
    }


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: analyze_track.py <path>"}))
        return 1

    try:
        print(json.dumps(analyze(sys.argv[1])))
        return 0
    except FileNotFoundError:
        print(json.dumps({"error": "File not found on disk."}))
        return 1
    except OSError as exc:
        print(json.dumps({"error": f"Cannot read audio file: {exc}"}))
        return 1
    except Exception as exc:  # noqa: BLE001 - CLI boundary
        print(json.dumps({"error": str(exc)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
