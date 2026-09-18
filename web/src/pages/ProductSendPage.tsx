// 产品发送端：选择文件 → 按档位编码 → 以【真实 cellPx】铺满屏幕循环播放。
// 与实测脚手架 /#/test 的区别：这里渲染的每一格就是 cellPx 个物理屏幕像素，不拉伸。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, Maximize2, FileUp, Radio, AlertTriangle } from "lucide-react";
import { planTransfer, encodeTransfer, type TransferPlan, type TransferResult } from "../core/transfer.ts";
import { paintCellFrame } from "../viz/screenRender.ts";
import { PROFILES, PROFILE_ORDER } from "../shared/params.ts";
import type { ProfileName } from "../shared/types.ts";

const FPS_OPTIONS = [2, 4, 8] as const;

function screenDevicePx(): { w: number; h: number } {
  const dpr = window.devicePixelRatio || 1;
  return { w: Math.floor(window.screen.width * dpr), h: Math.floor(window.screen.height * dpr) };
}

export function ProductSendPage() {
  const [profile, setProfile] = useState<ProfileName>("safe");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<TransferResult | null>(null);
  const [plan, setPlan] = useState<TransferPlan | null>(null);
  const [error, setError] = useState<string>("");
  const [playing, setPlaying] = useState(false);
  const [frameIdx, setFrameIdx] = useState(0);
  const [fps, setFps] = useState<number>(4);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  // 选择文件即编码（整份文件读入内存；16MB 上限由协议 totalBytes 24bit 约束）
  const onPickFile = useCallback(
    (f: File | null) => {
      setFile(f);
      setResult(null);
      setPlan(null);
      setError("");
      setFrameIdx(0);
      setPlaying(false);
      if (!f) return;
      if (f.size > (1 << 24) - 1) {
        setError(`文件过大（${(f.size / 1048576).toFixed(1)} MB），协议上限 16 MB`);
        return;
      }
      f.arrayBuffer().then((buf) => {
        const { w, h } = screenDevicePx();
        const p = planTransfer(profile, w, h);
        const r = encodeTransfer(new Uint8Array(buf), p);
        setPlan(r.plan);
        setResult(r);
      });
    },
    [profile]
  );

  // 渲染：canvas 像素 = 物理屏幕像素 1:1（CSS 尺寸再除以 dpr）
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !result || !plan) return;
    const frame = result.frames[frameIdx % result.frames.length];
    if (!frame) return;
    const dpr = window.devicePixelRatio || 1;
    const W = plan.cols * plan.cellPx;
    const H = plan.rows * plan.cellPx;
    if (cv.width !== W || cv.height !== H) {
      cv.width = W;
      cv.height = H;
    }
    cv.style.width = `${W / dpr}px`;
    cv.style.height = `${H / dpr}px`;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    paintCellFrame(ctx, frame, plan.cellPx);
  }, [result, plan, frameIdx]);

  // 循环播放
  useEffect(() => {
    if (!playing || !result || result.frames.length <= 1) return;
    const t = window.setInterval(() => {
      setFrameIdx((i) => (i + 1) % result.frames.length);
    }, 1000 / fps);
    return () => window.clearInterval(t);
  }, [playing, result, fps]);

  // 播放时禁止息屏
  useEffect(() => {
    if (!playing) {
      wakeLockRef.current?.release().catch(() => undefined);
      wakeLockRef.current = null;
      return;
    }
    navigator.wakeLock
      ?.request("screen")
      .then((s) => (wakeLockRef.current = s))
      .catch(() => undefined);
    return () => {
      wakeLockRef.current?.release().catch(() => undefined);
      wakeLockRef.current = null;
    };
  }, [playing]);

  const goFullscreen = useCallback(() => {
    stageRef.current?.requestFullscreen?.().catch(() => undefined);
  }, []);

  const metrics = useMemo(() => {
    if (!plan || !result) return null;
    return {
      cellPx: plan.cellPx,
      grid: `${plan.cols}×${plan.rows}`,
      perFrame: plan.sourceBytesPerFrame,
      frameCount: result.frameCount,
      totalBlocks: result.totalBlocks,
      seconds: result.frameCount / fps
    };
  }, [plan, result, fps]);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-ink-700 bg-ink-800 px-3 py-2">
        <span className="flex items-center gap-1.5 text-sm font-medium text-gray-100">
          <Radio size={15} className="text-brand-500" /> 产品发送端
        </span>
        <span className="text-xs text-gray-400">真实 cellPx 密度 · 不拉伸</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {PROFILE_ORDER.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setProfile(p)}
              className={`rounded-lg px-2.5 py-1 text-xs transition ${
                profile === p ? "bg-brand-600 text-white" : "bg-ink-700 text-gray-300 hover:bg-ink-600"
              }`}
            >
              {p} · colCellPx={PROFILES[p].colCellPx}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm text-white transition hover:bg-brand-500"
        >
          <FileUp size={15} /> 选择文件
        </button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          disabled={!result}
          onClick={() => setPlaying((v) => !v)}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition ${
            result ? "bg-ink-700 text-gray-100 hover:bg-ink-600" : "cursor-not-allowed bg-ink-800 text-gray-600"
          }`}
        >
          {playing ? <Pause size={15} /> : <Play size={15} />} {playing ? "暂停" : "播放"}
        </button>
        <button
          type="button"
          disabled={!result}
          onClick={() => setFrameIdx((i) => (i + 1) % Math.max(1, result?.frames.length ?? 1))}
          className="rounded-lg bg-ink-700 px-3 py-1.5 text-sm text-gray-100 transition hover:bg-ink-600 disabled:cursor-not-allowed disabled:text-gray-600"
        >
          下一帧
        </button>
        <button
          type="button"
          onClick={goFullscreen}
          className="flex items-center gap-1.5 rounded-lg bg-ink-700 px-3 py-1.5 text-sm text-gray-100 transition hover:bg-ink-600"
        >
          <Maximize2 size={15} /> 全屏
        </button>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-gray-400">
          帧率
          <select
            value={fps}
            onChange={(e) => setFps(Number(e.target.value))}
            className="rounded-md border border-ink-600 bg-ink-900 px-2 py-1 text-xs text-gray-200 outline-none focus:border-brand-500"
          >
            {FPS_OPTIONS.map((f) => (
              <option key={f} value={f}>
                {f} fps
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          <AlertTriangle size={15} /> {error}
        </div>
      )}

      {plan && !plan.cellPxOk && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
          <AlertTriangle size={15} /> 当前屏幕只能给出 colCellPx={plan.cellPx}，低于 {profile} 档下限{" "}
          {PROFILES[profile].colCellPx} 屏幕像素 —— 解码风险高，建议换更大屏幕或改用 safe 档。
        </div>
      )}

      <div
        ref={stageRef}
        className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-xl bg-black p-2"
      >
        {result ? (
          <canvas ref={canvasRef} className="block" />
        ) : (
          <p className="text-sm text-gray-500">先选择一个文件，编码后在此全屏循环播放</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-xl border border-ink-700 bg-ink-800 px-3 py-2 text-xs text-gray-400 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="文件" value={file ? `${file.name} · ${(file.size / 1024).toFixed(1)} KB` : "—"} />
        <Metric label="网格" value={metrics?.grid ?? "—"} />
        <Metric label="实际 colCellPx" value={metrics ? `${metrics.cellPx} 屏幕像素` : "—"} highlight={!!plan?.cellPxOk} />
        <Metric label="每帧源字节" value={metrics ? `${(metrics.perFrame / 1024).toFixed(2)} KB` : "—"} />
        <Metric label="帧数" value={metrics ? `${frameIdx + 1}/${metrics.frameCount}` : "—"} />
        <Metric label="一轮耗时" value={metrics ? `${metrics.seconds.toFixed(1)} s` : "—"} />
      </div>
    </div>
  );
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wide text-gray-500">{label}</span>
      <span className={`truncate text-xs ${highlight ? "text-emerald-400" : "text-gray-200"}`} title={value}>
        {value}
      </span>
    </div>
  );
}
