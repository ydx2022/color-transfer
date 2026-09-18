// 实测接收页 /#/test/receive：摄像头预览 + 锁定 + 拍一帧/连拍 + 现场解码日志。
// 与产品接收端 /#/receive 同构：复用同一 receiver 管线（decodeImage = locate → normalize → decoder）。
// 用途：对着实测发送页 /#/test 的图案拍照，现场得到格错误率（非比特错误率），验证定案档位。
import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Lock, Zap, Layers, AlertTriangle } from "lucide-react";
import { encodeFile, CELL_META_DATA, countDataCells, type CellFrame } from "../core/encoder.ts";
import { decodeImage } from "../receiver/pipeline.ts";
import { DEMO_PAYLOAD } from "../shared/testPayload.ts";
import { TEST_PATTERNS, schemeOfPattern, colorFormat } from "../shared/testPatterns.ts";
import type { RGBAImage } from "../receiver/types.ts";

const PATCH_W = 640; // 与 SendPage 的真实密度小块一致
const PATCH_H = 360;

interface ShotLog {
  time: string;
  cells: number;
  errors: number;
  rate: number;
  note: string;
}

export function ReceivePage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<string>("未启动");
  const [lockMsg, setLockMsg] = useState<string>("");
  const [pid, setPid] = useState<number>(TEST_PATTERNS[0].id);
  const [logs, setLogs] = useState<ShotLog[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pattern = TEST_PATTERNS.find((p) => p.id === pid) ?? TEST_PATTERNS[0];

  // 真值帧：与发送页同一图案、同一网格、同一循环填充
  const truth = useMemo<CellFrame>(() => {
    const cols = Math.max(1, Math.floor(PATCH_W / pattern.colCellPx));
    const rows = Math.max(1, Math.floor(PATCH_H / pattern.colCellPx));
    return encodeFile(DEMO_PAYLOAD, schemeOfPattern(pattern), { cols, rows, fileId: 1, fill: "cycle" }).frames[0];
  }, [pattern]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStatus("摄像头已开启 · 后置");
    } catch (e) {
      setStatus("无法开启摄像头（需 HTTPS 安全上下文与授权）");
      console.error(e);
    }
  };

  const lockExposure = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) {
      setLockMsg("未开启摄像头，无法锁定");
      return;
    }
    const caps = (track.getCapabilities?.() ?? {}) as { focusMode?: string[]; exposureMode?: string[] };
    const msgs: string[] = [];
    try {
      if (caps.focusMode?.includes("manual")) {
        await track.applyConstraints({ advanced: [{ focusMode: "manual" } as unknown as MediaTrackConstraintSet] });
        msgs.push("对焦：已锁定(MF)");
      } else msgs.push("对焦：设备不可锁(自动)");
    } catch {
      msgs.push("对焦：锁定失败");
    }
    try {
      if (caps.exposureMode?.includes("manual")) {
        await track.applyConstraints({ advanced: [{ exposureMode: "manual" } as unknown as MediaTrackConstraintSet] });
        msgs.push("曝光：已锁定");
      } else msgs.push("曝光：设备不可锁(自动)");
    } catch {
      msgs.push("曝光：锁定失败");
    }
    setLockMsg(msgs.join(" · "));
  };

  // 抓一帧 → 解码 → 与真值比对
  const decodeOnce = async (): Promise<ShotLog> => {
    const v = videoRef.current;
    const cv = canvasRef.current;
    if (!v || !cv) throw new Error("摄像头未就绪");
    cv.width = v.videoWidth || 1280;
    cv.height = v.videoHeight || 720;
    const ctx = cv.getContext("2d");
    if (!ctx) throw new Error("无法获取 2D 上下文");
    ctx.drawImage(v, 0, 0, cv.width, cv.height);
    const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const img: RGBAImage = { width: cv.width, height: cv.height, data: new Uint8ClampedArray(data) };

    const dec = decodeImage(img, truth);
    let cells = 0;
    let errors = 0;
    for (let i = 0; i < dec.cellMeta.length; i++) {
      if (dec.cellMeta[i] !== CELL_META_DATA) continue;
      cells++;
      if (dec.values[i] !== truth.values[i]) errors++;
    }
    setPreview(cv.toDataURL("image/png"));
    return {
      time: new Date().toLocaleTimeString(),
      cells,
      errors,
      rate: cells ? errors / cells : 0,
      note: `T${pattern.id} colCellPx=${pattern.colCellPx} 屏幕像素 ${colorFormat(pattern.colorBits)}`
    };
  };

  const shoot = async () => {
    setBusy(true);
    try {
      const log = await decodeOnce();
      setLogs((l) => [log, ...l].slice(0, 20));
      setStatus(`已解码：格错误率 ${(log.rate * 100).toFixed(2)}%`);
    } catch (e) {
      setStatus(`解码失败：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const burst = async (n = 5) => {
    setBusy(true);
    const acc: ShotLog[] = [];
    try {
      for (let i = 0; i < n; i++) {
        acc.push(await decodeOnce());
        await new Promise((r) => setTimeout(r, 350));
      }
      setLogs((l) => [...acc, ...l].slice(0, 20));
      const avg = acc.reduce((s, x) => s + x.rate, 0) / acc.length;
      setStatus(`连拍 ${n} 帧：平均格错误率 ${(avg * 100).toFixed(2)}%`);
    } catch (e) {
      setStatus(`连拍中断：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const totalCells = countDataCells(truth.cellMeta);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-lg bg-ink-700 px-3 py-1 text-gray-200">状态：{status}</span>
        <button onClick={start} className="flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-white hover:bg-brand-600/80">
          <Camera size={16} /> 开启摄像头
        </button>
        <button onClick={lockExposure} className="flex items-center gap-1 rounded-lg bg-ink-700 px-3 py-1.5 text-gray-200 hover:bg-ink-700/70">
          <Lock size={16} /> 锁定对焦/曝光
        </button>
        <button disabled={busy} onClick={shoot} className="flex items-center gap-1 rounded-lg bg-ink-700 px-3 py-1.5 text-gray-200 hover:bg-ink-700/70 disabled:opacity-50">
          <Zap size={16} /> 拍一帧并解码
        </button>
        <button disabled={busy} onClick={() => burst(5)} className="flex items-center gap-1 rounded-lg bg-ink-700 px-3 py-1.5 text-gray-200 hover:bg-ink-700/70 disabled:opacity-50">
          <Layers size={16} /> 连拍 5 帧
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-gray-400">被测图案</span>
        {TEST_PATTERNS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPid(p.id)}
            className={`rounded-md px-2 py-1 transition ${
              pid === p.id ? "bg-brand-600 text-white" : "bg-ink-700 text-gray-300 hover:bg-ink-600"
            }`}
          >
            T{p.id} · {p.colCellPx}px · {1 << p.colorBits}色
          </button>
        ))}
        <span className="ml-auto text-gray-400">
          当前：纯颜色型，colCellPx={pattern.colCellPx} 屏幕像素，{colorFormat(pattern.colorBits)}，
          校准 {pattern.calibMode === "none" ? "无" : pattern.calibMode === "four_corner" ? "四角" : `密集 N=${pattern.denseN}`}，
          数据格 {totalCells}
        </span>
      </div>

      {lockMsg && <div className="text-xs text-gray-400">{lockMsg}</div>}

      <div className="relative flex-1 overflow-hidden rounded-xl border border-ink-700 bg-black">
        <video ref={videoRef} className="block h-full w-full object-cover" playsInline muted />
        <canvas ref={canvasRef} className="hidden" />
      </div>

      {preview && (
        <div className="rounded-xl border border-ink-700 bg-ink-800 p-2">
          <div className="mb-1 flex items-center gap-2 text-xs text-gray-400">
            <AlertTriangle size={14} /> 最近一帧（用于核对构图是否对准、有无反光）
          </div>
          <img src={preview} alt="最近抓帧" className="max-h-40 rounded-lg" />
        </div>
      )}

      <div className="max-h-40 overflow-auto rounded-xl border border-ink-700 bg-ink-800 p-2 text-xs">
        {logs.length === 0 ? (
          <p className="text-gray-500">尚无解码记录。开摄像头 → 锁定 → 对准发送页图案 → 拍一帧。</p>
        ) : (
          <table className="w-full text-left">
            <thead className="text-gray-500">
              <tr>
                <th className="py-0.5">时间</th>
                <th>图案</th>
                <th>数据格</th>
                <th>错格</th>
                <th>格错误率</th>
              </tr>
            </thead>
            <tbody className="text-gray-200">
              {logs.map((l, i) => (
                <tr key={i} className="border-t border-ink-700">
                  <td className="py-0.5">{l.time}</td>
                  <td>{l.note}</td>
                  <td>{l.cells}</td>
                  <td>{l.errors}</td>
                  <td className={l.rate < 0.02 ? "text-emerald-400" : "text-amber-300"}>{(l.rate * 100).toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-gray-500">
        注：此处输出的是<b className="text-gray-300">格错误率</b>（判错的数据格占比），不是比特错误率 BER。
        解码管线与产品端 /#/receive 共用 receiver/locate → normalize → decoder。
      </p>
    </div>
  );
}
