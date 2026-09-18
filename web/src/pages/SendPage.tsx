// 实测发送页 /#/test：8 张**纯颜色型**图案（symbolBits=0，无符号）。
// 两种渲染模式：
//   - 真实密度小块（拍照用）：数据格边长 = colCellPx 个屏幕像素，图案为约 640×360 屏幕像素的小块。
//     ⚠️ 此为【真实密度小块，非全屏】——便于手机对准构图；全屏满铺的是产品端 /#/。
//   - 拉伸铺满（人眼观察用）：把同一小块拉伸到视口，**密度已失真，不可用于拍照实测**。
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Maximize, Download } from "lucide-react";
import { encodeFile, countDataCells, type CellFrame } from "../core/encoder.ts";
import { paintCellFrame } from "../viz/screenRender.ts";
import { DEMO_PAYLOAD } from "../shared/testPayload.ts";
import { TEST_PATTERNS, schemeOfPattern, colorFormat } from "../shared/testPatterns.ts";

const DEMO = DEMO_PAYLOAD;
const PATTERNS = TEST_PATTERNS;
// 真实密度小块的目标尺寸（屏幕像素）：三档小块物理尺寸一致，便于同一机位连拍对比
const PATCH_W = 640;
const PATCH_H = 360;

function renderFrameCentered(ctx: CanvasRenderingContext2D, frame: CellFrame, W: number, H: number, scale: number): void {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  const ox = Math.floor((W - frame.cols * scale) / 2);
  const oy = Math.floor((H - frame.rows * scale) / 2);
  ctx.save();
  ctx.translate(ox, oy);
  paintCellFrame(ctx, frame, scale);
  ctx.restore();
}

export function SendPage() {
  const [idx, setIdx] = useState(0);
  const [trueSize, setTrueSize] = useState(true); // 拍照实测必须开真实密度
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });

  // 8 张图案的真值帧：小块网格按 colCellPx 反推，循环填充保证每格都有数据
  const frames = useMemo<CellFrame[]>(
    () =>
      PATTERNS.map((p) => {
        const cols = Math.max(1, Math.floor(PATCH_W / p.colCellPx));
        const rows = Math.max(1, Math.floor(PATCH_H / p.colCellPx));
        return encodeFile(DEMO, schemeOfPattern(p), { cols, rows, fileId: 1, fill: "cycle" }).frames[0];
      }),
    []
  );
  const pattern = PATTERNS[idx];
  const frame = frames[idx];

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

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !frame) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const scale = trueSize
      ? pattern.colCellPx
      : Math.max(1, Math.floor(Math.min(size.w / frame.cols, size.h / frame.rows)));
    const W = trueSize ? frame.cols * scale : size.w;
    const H = trueSize ? frame.rows * scale : size.h;
    cv.width = W;
    cv.height = H;
    cv.style.width = `${Math.round(W / dpr)}px`;
    cv.style.height = `${Math.round(H / dpr)}px`;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    renderFrameCentered(ctx, frame, W, H, scale);
  }, [frame, size, trueSize, pattern.colCellPx]);

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

  const exportAllPngs = async () => {
    for (let k = 0; k < PATTERNS.length; k++) {
      const p = PATTERNS[k];
      const scale = p.colCellPx;
      const W = frames[k].cols * scale;
      const H = frames[k].rows * scale;
      const cv = document.createElement("canvas");
      cv.width = W;
      cv.height = H;
      const ctx = cv.getContext("2d");
      if (!ctx) continue;
      renderFrameCentered(ctx, frames[k], W, H, scale);
      const blob = await new Promise<Blob | null>((res) => cv.toBlob(res, "image/png"));
      if (!blob) continue;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `T${p.id}_color_${p.colCellPx}px_${1 << p.colorBits}色.png`;
      a.click();
      URL.revokeObjectURL(a.href);
      await new Promise((r) => setTimeout(r, 120));
    }
  };

  const dataCells = frame ? countDataCells(frame.cellMeta) : 0;
  const patchPx = frame ? `${frame.cols * pattern.colCellPx}×${frame.rows * pattern.colCellPx}` : "—";

  return (
    <div className="flex h-full flex-col gap-3">
      {/* 状态栏（DOM，绝不进入 Canvas） */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="rounded-lg bg-brand-600 px-3 py-1 font-medium text-white">第 {idx + 1} / {PATTERNS.length} 张</span>
        <span className="text-gray-300">族 <b className="text-gray-100">纯颜色型</b>（无符号）</span>
        <span className="text-gray-300">档位 <b className="text-gray-100">{pattern.profile}</b></span>
        <span className="text-gray-300">colCellPx <b className="text-gray-100">{pattern.colCellPx}</b> 屏幕像素</span>
        <span className="text-gray-300">颜色 <b className="text-gray-100">{colorFormat(pattern.colorBits)}</b></span>
        <span className="text-gray-300">校准 <b className="text-gray-100">
          {pattern.calibMode === "none" ? "无" : pattern.calibMode === "four_corner" ? "四角" : `密集 N=${pattern.denseN}`}
        </b>（校准格与数据格同尺寸）</span>
        <span className="text-gray-300">采样窗口 <b className="text-gray-100">{pattern.winFrac === 1 / 3 ? "1/3" : pattern.winFrac === 0.5 ? "1/2" : pattern.winFrac.toFixed(2)}</b></span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setTrueSize(true)}
          className={`rounded-lg px-3 py-1 text-xs transition ${trueSize ? "bg-brand-600 text-white" : "bg-ink-700 text-gray-300 hover:bg-ink-600"}`}
        >
          真实密度小块（colCellPx={pattern.colCellPx}）
        </button>
        <button
          type="button"
          onClick={() => setTrueSize(false)}
          className={`rounded-lg px-3 py-1 text-xs transition ${!trueSize ? "bg-brand-600 text-white" : "bg-ink-700 text-gray-300 hover:bg-ink-600"}`}
        >
          拉伸铺满（仅看图）
        </button>
        <span className="text-xs text-gray-400">
          网格 <b className="text-gray-100">{frame ? `${frame.cols}×${frame.rows}` : "—"}</b> ｜ 小块尺寸{" "}
          <b className="text-gray-100">{patchPx}</b> 屏幕像素 ｜ 数据格 <b className="text-gray-100">{dataCells}</b>
        </span>
        {!trueSize && (
          <span className="rounded-md bg-amber-500/15 px-2 py-1 text-xs text-amber-300">
            拉伸模式密度已失真，禁止用于拍照实测
          </span>
        )}
      </div>

      <div className="rounded-lg border border-ink-700 bg-ink-800 px-3 py-1.5 text-xs text-gray-400">
        ⚠️ 本页为<b className="text-gray-200">真实密度小块，非全屏</b>（固定约 {PATCH_W}×{PATCH_H} 屏幕像素，便于手机对准构图）。
        全屏满铺、兑现仿真吞吐的是<b className="text-gray-200">产品端 /#/</b>。
      </div>

      <div ref={containerRef} className="relative flex flex-1 items-center justify-center overflow-hidden rounded-xl border border-ink-700 bg-black">
        <canvas ref={canvasRef} className="block" />
      </div>

      <div className="flex items-center gap-2">
        <button onClick={prev} className="flex items-center gap-1 rounded-lg bg-ink-700 px-4 py-2 text-sm text-gray-200 hover:bg-ink-700/70">
          <ChevronLeft size={16} /> 上一张
        </button>
        <button onClick={next} className="flex items-center gap-1 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600/80">
          下一张 → <ChevronRight size={16} />
        </button>
        <span className="ml-2 text-xs text-gray-500">空格键 = 下一张 ｜ 当前图案目的：{pattern.note}</span>
        <div className="ml-auto flex gap-2">
          <button onClick={fullscreen} className="flex items-center gap-1 rounded-lg bg-ink-700 px-3 py-2 text-sm text-gray-200 hover:bg-ink-700/70">
            <Maximize size={16} /> 全屏
          </button>
          <button onClick={exportAllPngs} className="flex items-center gap-1 rounded-lg bg-ink-700 px-3 py-2 text-sm text-gray-200 hover:bg-ink-700/70">
            <Download size={16} /> 导出 PNG（8 张）
          </button>
        </div>
      </div>
    </div>
  );
}
