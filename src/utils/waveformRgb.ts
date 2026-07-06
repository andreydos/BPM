export interface RgbWaveformBar {
  height: number;
  r: number;
  g: number;
  b: number;
}

const BAR_COUNT = 720;
const FFT_SIZE = 2048;

// Rekordbox RGB: red = low, green = mid, blue = high
const BASS_MAX_HZ = 400;
const MID_MAX_HZ = 5000;
const HIGH_MAX_HZ = 16000;
const SUB_MAX_HZ = 120;

const BASS_BOOST = 1.55;
const HEIGHT_PERCENTILE = 0.88;
const BAND_PERCENTILE = 0.9;

/** Rekordbox-style RGB: lows=red, mids=green, highs=blue. */
export function computeRekordboxRgbWaveform(audioBuffer: AudioBuffer): RgbWaveformBar[] {
  const channel = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const binHz = sampleRate / FFT_SIZE;
  const raw: Array<{ height: number; r: number; g: number; b: number }> = [];

  for (let bar = 0; bar < BAR_COUNT; bar += 1) {
    const center = Math.floor(((bar + 0.5) / BAR_COUNT) * channel.length);
    const start = Math.max(0, center - Math.floor(FFT_SIZE / 2));
    const end = Math.min(channel.length, start + FFT_SIZE);
    const window = new Float32Array(FFT_SIZE);

    for (let i = 0; i < FFT_SIZE; i += 1) {
      const sample = start + i < end ? channel[start + i] : 0;
      const hann = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
      window[i] = sample * hann;
    }

    const magnitudes = fftMagnitudes(window);
    let sub = 0;
    let bass = 0;
    let mid = 0;
    let high = 0;
    let subBins = 0;
    let bassBins = 0;
    let midBins = 0;
    let highBins = 0;

    for (let bin = 1; bin < magnitudes.length; bin += 1) {
      const freq = bin * binHz;
      const mag = magnitudes[bin];

      if (freq < SUB_MAX_HZ) {
        sub += mag;
        subBins += 1;
      } else if (freq < BASS_MAX_HZ) {
        bass += mag;
        bassBins += 1;
      } else if (freq < MID_MAX_HZ) {
        mid += mag;
        midBins += 1;
      } else if (freq < HIGH_MAX_HZ) {
        high += mag;
        highBins += 1;
      }
    }

    // Average per bin — mids no longer dominate just because they span more bins
    const subAvg = subBins > 0 ? sub / subBins : 0;
    const bassAvg = bassBins > 0 ? bass / bassBins : 0;
    const midAvg = midBins > 0 ? mid / midBins : 0;
    const highAvg = highBins > 0 ? high / highBins : 0;

    const lowEnergy = Math.log1p(subAvg * 1.8 + bassAvg);
    const midEnergy = Math.log1p(midAvg);
    const highEnergy = Math.log1p(highAvg);

    raw.push({
      height: lowEnergy + midEnergy + highEnergy,
      r: lowEnergy,
      g: midEnergy,
      b: highEnergy,
    });
  }

  return normalizeWaveformBars(raw);
}

function normalizeWaveformBars(
  raw: Array<{ height: number; r: number; g: number; b: number }>,
): RgbWaveformBar[] {
  const heightCeiling = percentile(
    raw.map((bar) => bar.height),
    HEIGHT_PERCENTILE,
  );
  const bassCeiling = percentile(
    raw.map((bar) => bar.r),
    BAND_PERCENTILE,
  );
  const midCeiling = percentile(
    raw.map((bar) => bar.g),
    BAND_PERCENTILE,
  );
  const highCeiling = percentile(
    raw.map((bar) => bar.b),
    BAND_PERCENTILE,
  );

  return raw.map((bar) => {
    const heightNorm = Math.min(bar.height / heightCeiling, 1);
    const height = Math.pow(heightNorm, 0.55) * 0.92;

    // Global per-band normalization (not per-bar max) — keeps red visible on kicks
    const r = Math.min(1, Math.pow(Math.min(bar.r / bassCeiling, 1), 0.7) * BASS_BOOST);
    const g = Math.pow(Math.min(bar.g / midCeiling, 1), 0.82);
    const b = Math.pow(Math.min(bar.b / highCeiling, 1), 0.82);

    return { height, r, g, b };
  });
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * ratio));
  return Math.max(sorted[idx] ?? 1, 1e-6);
}

function fftMagnitudes(samples: Float32Array): Float32Array {
  const n = samples.length;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  real.set(samples);

  fftInPlace(real, imag);

  const magnitudes = new Float32Array(n / 2);
  for (let i = 0; i < magnitudes.length; i += 1) {
    magnitudes[i] = Math.hypot(real[i], imag[i]);
  }
  return magnitudes;
}

function fftInPlace(real: Float32Array, imag: Float32Array): void {
  const n = real.length;
  if (n <= 1) return;

  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wLenReal = Math.cos(ang);
    const wLenImag = Math.sin(ang);

    for (let i = 0; i < n; i += len) {
      let wReal = 1;
      let wImag = 0;

      for (let j = 0; j < len / 2; j += 1) {
        const uReal = real[i + j];
        const uImag = imag[i + j];
        const vReal = real[i + j + len / 2] * wReal - imag[i + j + len / 2] * wImag;
        const vImag = real[i + j + len / 2] * wImag + imag[i + j + len / 2] * wReal;

        real[i + j] = uReal + vReal;
        imag[i + j] = uImag + vImag;
        real[i + j + len / 2] = uReal - vReal;
        imag[i + j + len / 2] = uImag - vImag;

        const nextWReal = wReal * wLenReal - wImag * wLenImag;
        wImag = wReal * wLenImag + wImag * wLenReal;
        wReal = nextWReal;
      }
    }
  }
}

export function rgbBarColor(bar: RgbWaveformBar): string {
  const r = Math.round(Math.min(255, bar.r * 255));
  const g = Math.round(Math.min(255, bar.g * 255));
  const b = Math.round(Math.min(255, bar.b * 255));
  return `rgb(${r}, ${g}, ${b})`;
}
