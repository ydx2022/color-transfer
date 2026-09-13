import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize, Download } from "lucide-react";
import { encodeFile, type CellFrame } from "../core/encoder.ts";
import { paintCellFrame } from "../viz/screenRender.ts";
import { DEMO_PAYLOAD } from "../shared/testPayload.ts";
import { TEST_PATTERNS, schemeOfPattern } from "../shared/testPatterns.ts";

const COLS = 24;
const ROWS = 14;
const DEMO = DEMO_PAYLOAD;
const PATTERNS = TEST_PATTERNS;

// 将整帧居中铺满画布（黑底、无文字、无 UI），纯图案。
function renderFrameCentered(ctx: CanvasRenderingContext2D, frame: CellFrame, W: number, H: number, scale: number): void {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  const ox = Math.floor((W - COLS * scale) / 2);
  const oy = Math.floor((H - ROWS * scale) / 2);
  ctx.save();
  ctx.translate(ox, oy);
  paintCellFrame(ctx, frame, scale);
  ctx.restore();
}

export function SendPage() {
  const [idx, setIdx] = useState(0);
  const [trueSize, setTrueSize] = useState(true); // 真机实测必须开：按图案真实 cellPx 渲染
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  // 8 张图案的真值帧（复用已有 encoder，仅取第 0 帧作测试图案）
  const frames = useMemo<CellFrame[]>(() => PATTERNS.map((p) => encodeFile(DEMO, schemeOfPattern(p), { cols: COLS, rows: ROWS, fileId: 1 }).frames[0]), []);
  const pattern = PATTERNS[idx];
  const frame = frames[idx];

  // 容器尺寸自适应（含 devicePixelRatio）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      setSize({ w: Math.max(1, Math.floor(el.clientWidth * dpr)), h: Math.max(1, Math.floor(el.clientHeight * dpr)) });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 渲染当前帧：trueSize 按图案真实 cellPx 渲染（真机实测），否则拉伸铺满（仅肉眼看图）
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !frame) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const fitScale = Math.max(1, Math.floor(Math.min(size.w / COLS, size.h / ROWS)));
    const scale = trueSize ? Math.max(1, pattern.cellPx) : fitScale;
    const W = trueSize ? COLS * scale : size.w;
    const H = trueSize ? ROWS * scale : size.h;
    cv.width = W;
    cv.height = H;
    cv.style.width = `${Math.round(W / dpr)}px`;
    cv.style.height = `${Math.round(H / dpr)}px`;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    renderFrameCentered(ctx, frame, W, H, scale);
  }, [frame, size, trueSize, pattern.cellPx]);

  // 空格切下一张
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        const t = e.target as HTMLElement;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
        e.preventDefault();
        setIdx((i) => (i + 1) % PATTERNS.length);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const next = () => setIdx((i) => (i + 1) % PATTERNS.length);
  const prev = () => setIdx((i) => (i - 1 + PATTERNS.length) % PATTERNS.length);
  const fullscreen = () => containerRef.current?.requestFullscreen?.();

  // 一键导出 8 张 PNG（纯净、全屏分辨率 1600×900，居中铺满）
  const exportAllPngs = async () => {
    const W = 1600;
    const H = 900;
    for (let k = 0; k < PATTERNS.length; k++) {
      const p = PATTERNS[k];
      const cv = document.createElement("canvas");
      cv.width = W;
      cv.height = H;
      const ctx = cv.getContext("2d");
      if (!ctx) continue;
      // 导出固定用 fit-scale（64px/格）便于肉眼看图；真机实测请用页面上的「真实尺寸」模式
      renderFrameCentered(ctx, frames[k], W, H, Math.max(1, Math.floor(Math.min(W / COLS, H / ROWS))));
      const blob = await new Promise<Blob | null>((res) => cv.toBlob(res, "image/png"));
      if (!blob) continue;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `T${p.id}_${p.profile}_${p.cellPx}px_${p.colors}色.png`;
      a.click();
      URL.revokeObjectURL(a.href);
      await new Promise((r) => setTimeout(r, 120));
    }
  };

  return (
    <div className="flex h-full flex-col gap-3">
      {/* 状态栏（DOM，绝不进入 Canvas） */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="rounded-lg bg-brand-600 px-3 py-1 font-medium text-white">第 {idx + 1} / {PATTERNS.length} 张</span>
        <span className="text-gray-300">档位 <b className="text-gray-100">{pattern.profile}</b></span>
        <span className="text-gray-300">cellPx <b className="text-gray-100">{pattern.cellPx}</b> 屏幕像素</span>
        <span className="text-gray-300">颜色 <b className="text-gray-100">{pattern.colorBits} bit（{pattern.colors}色）</b></span>
        <span className="text-gray-300">校准 <b className="text-gray-100">{pattern.calibLabel}</b></span>
        <span className="text-gray-500">4 bit 符号（16 种图案）</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setTrueSize(true)}
          className={`rounded-lg px-3 py-1 text-xs transition ${
            trueSize ? "bg-brand-600 text-white" : "bg-ink-700 text-gray-300 hover:bg-ink-600"
          }`}
        >
          真实尺寸（cellPx={pattern.cellPx}）
        </button>
        <button
          type="button"
          onClick={() => setTrueSize(false)}
          className={`rounded-lg px-3 py-1 text-xs transition ${
            !trueSize ? "bg-brand-600 text-white" : "bg-ink-700 text-gray-300 hover:bg-ink-600"
          }`}
        >
          拉伸铺满（看图用）
        </button>
        <span className="text-xs text-gray-400">
          图案实际尺寸{" "}
          <b className="text-gray-100">{trueSize ? `${COLS * pattern.cellPx}×${ROWS * pattern.cellPx}` : "铺满"}</b> 屏幕像素 ｜
          符号像素 <b className="text-gray-100">{(pattern.cellPx / 8).toFixed(2)}</b> px
        </span>
        {pattern.cellPx < 8 && (
          <span className="rounded-md bg-amber-500/15 px-2 py-1 text-xs text-amber-300">
            cellPx&lt;8：8×8 符号不足 1px/点，形状维度物理上不可渲染
          </span>
        )}
      </div>

      {/* 画布：仅纯图案，无任何叠加 */}
      <div
        ref={containerRef}
        className="relative flex flex-1 items-center justify-center overflow-hidden rounded-xl border border-ink-700 bg-black"
      >
        <canvas ref={canvasRef} className="block" />
      </div>

      {/* 操作栏 */}
      <div className="flex items-center gap-2">
        <button onClick={prev} className="flex items-center gap-1 rounded-lg bg-ink-700 px-4 py-2 text-sm text-gray-200 hover:bg-ink-700/70">
          <ChevronLeft size={16} /> 上一张
        </button>
        <button onClick={next} className="flex items-center gap-1 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600/80">
          下一张 → <ChevronRight size={16} />
        </button>
        <span className="ml-2 text-xs text-gray-500">空格键 = 下一张</span>
        <div className="ml-auto flex gap-2">
          <button onClick={fullscreen} className="flex items-center gap-1 rounded-lg bg-ink-700 px-3 py-2 text-sm text-gray-200 hover:bg-ink-700/70">
            <Maximize size={16} /> 全屏
          </button>
          <button onClick={exportAllPngs} className="flex items-center gap-1 rounded-lg bg-ink-700 px-3 py-2 text-sm text-gray-200 hover:bg-ink-700/70">
            <Download size={16} /> 一键导出 PNG（8 张）
          </button>
        </div>
      </div>
    </div>
  );
}
