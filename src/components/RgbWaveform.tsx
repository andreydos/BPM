import { useCallback, useEffect, useRef } from "react";
import { RgbWaveformBar, rgbBarColor } from "../utils/waveformRgb";

interface RgbWaveformProps {
  bars: RgbWaveformBar[];
  currentTime: number;
  duration: number;
  onSeek: (progress: number) => void;
}

export function RgbWaveform({ bars, currentTime, duration, onSeek }: RgbWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || bars.length === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width <= 0 || height <= 0) return;

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#020617";
    ctx.fillRect(0, 0, width, height);

    const centerY = height / 2;
    const gap = 1;
    const barWidth = Math.max(1, width / bars.length - gap);

    for (let i = 0; i < bars.length; i += 1) {
      const bar = bars[i];
      const barHeight = Math.max(2, bar.height * (height * 0.92));
      const x = (i / bars.length) * width;
      ctx.fillStyle = rgbBarColor(bar);
      ctx.fillRect(x, centerY - barHeight / 2, barWidth, barHeight);
    }

    if (duration > 0) {
      const progress = Math.min(1, Math.max(0, currentTime / duration));
      const x = progress * width;
      ctx.strokeStyle = "#f8fafc";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
  }, [bars, currentTime, duration]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => draw());
    observer.observe(container);
    return () => observer.disconnect();
  }, [draw]);

  function seekFromClientX(clientX: number) {
    const container = containerRef.current;
    if (!container || duration <= 0) return;
    const rect = container.getBoundingClientRect();
    const progress = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onSeek(progress);
  }

  return (
    <div
      ref={containerRef}
      className="rgb-waveform"
      onClick={(event) => seekFromClientX(event.clientX)}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") onSeek(Math.min(1, currentTime / Math.max(duration, 1) + 0.02));
        if (event.key === "ArrowLeft") onSeek(Math.max(0, currentTime / Math.max(duration, 1) - 0.02));
      }}
      role="slider"
      tabIndex={0}
      aria-label="Waveform seek"
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={currentTime}
    >
      <canvas ref={canvasRef} />
    </div>
  );
}
