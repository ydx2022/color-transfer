// 产品接收端：手机开摄像头 → 拍照 → 浏览器内解码 → 块重组 → 还原文件。
// 档位自动识别：帧头带 CRC，接收端依次用 safe/balanced/fast 三套网格试探，命中后锁定。
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Lock, Zap, Download, AlertTriangle, CheckCircle2 } from "lucide-react";
import { decodeImage } from "../receiver/pipeline.ts";
import { decodePlanFor, transferLayout, type TransferPlan } from "../core/transfer.ts";
import { decodeTransferFrame, ingestFrame, TransferReassembler } from "../core/transferDecode.ts";
import type { CellFrame } from "../core/encoder.ts";
import type { RGBAImage } from "../receiver/types.ts";
import { PROFILE_ORDER } from "../shared/params.ts";

const BURST_MS = 400;

interface LogLine {
  t: string;
  msg: string;
  tone: "ok" | "warn" | "err";
}

function templateFor(plan: TransferPlan): CellFrame {
  const { cellMeta, pilotParity } = transferLayout(plan.cols, plan.rows, plan.scheme.denseN, plan.headerRows);
  return {
    cols: plan.cols,
    rows: plan.rows,
    scheme: plan.scheme,
    denseN: plan.scheme.denseN,
    fileId: 0,
    frameIndex: 0,
    frameCount: 1,
    values: new Int16Array(plan.cols * plan.rows).fill(-1),
    cellMeta,
    pilotParity
  };
}

function grabImage(video: HTMLVideoElement): RGBAImage | null {
  if (!video.videoWidth || !video.videoHeight) return null;
  const cv = document.createElement("canvas");
  cv.width = video.videoWidth;
  cv.height = video.videoHeight;
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0);
  return { width: cv.width, height: cv.height, data: ctx.getImageData(0, 0, cv.width, cv.height).data };
}

export function ProductReceivePage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rsRef = useRef<TransferReassembler | null>(null);
  const lockedPlanRef = useRef<TransferPlan | null>(null);
  const burstRef = useRef<number | null>(null);

  const [status, setStatus] = useState("未启动摄像头");
  const [lockMsg, setLockMsg] = useState("");
  const [detected, setDetected] = useState<string>("");
  const [received, setReceived] = useState(0);
  const [total, setTotal] = useState(0);
  const [log, setLog] = useState<LogLine[]>([]);
  const [done, setDone] = useState(false);
  const [bursting, setBursting] = useState(false);
  const [shot, setShot] = useState<string | null>(null);

  const push = useCallback((msg: string, tone: LogLine["tone"] = "ok") => {
    setLog((l) => [{ t: new Date().toLocaleTimeString("zh-CN", { hour12: false }), msg, tone }, ...l].slice(0, 60));
  }, []);

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);
  useEffect(() => () => { if (burstRef.current) window.clearInterval(burstRef.current); }, []);

  const start = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setStatus(`摄像头已开启 · ${stream.getVideoTracks()[0]?.getSettings().width ?? "?"}×${stream.getVideoTracks()[0]?.getSettings().height ?? "?"}`);
    } catch (e) {
      setStatus("无法开启摄像头（需 HTTPS 与授权）");
      console.error(e);
    }
  }, []);

  const lockExposure = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) {
      setLockMsg("未开启摄像头");
      return;
    }
    const caps = track.getCapabilities?.() as Record<string, unknown> | undefined;
    const wanted: Record<string, unknown> = {};
    if (caps && "focusMode" in caps) wanted.focusMode = "manual";
    if (caps && "exposureMode" in caps) wanted.exposureMode = "manual";
    if (caps && "whiteBalanceMode" in caps) wanted.whiteBalanceMode = "manual";
    try {
      await track.applyConstraints({ advanced: [wanted] });
      setLockMsg("已尝试锁定对焦/曝光/白平衡");
    } catch (e) {
      setLockMsg("本设备不支持完整锁定（部分生效或全部不可用）");
      console.error(e);
    }
  }, []);

  const processCapture = useCallback(
    (img: RGBAImage) => {
      const plans: TransferPlan[] = lockedPlanRef.current ? [lockedPlanRef.current] : PROFILE_ORDER.map(decodePlanFor);
      for (const plan of plans) {
        const dec = decodeImage(img, templateFor(plan));
        const fr = decodeTransferFrame(dec, plan);
        if (!fr) continue;

        lockedPlanRef.current = plan;
        setDetected(`${plan.profile} · ${plan.cols}×${plan.rows}`);
        if (!rsRef.current || rsRef.current.totalBytes !== fr.header.totalBytes) {
          rsRef.current = new TransferReassembler(fr.header.totalBytes);
          push(`识别到文件：${(fr.header.totalBytes / 1024).toFixed(1)} KB，共 ${rsRef.current.totalBlocks} 块`, "ok");
        }
        const rs = rsRef.current;
        const res = ingestFrame(fr, rs);
        setReceived(rs.received);
        setTotal(rs.totalBlocks);
        push(
          `帧 #${fr.header.frameIndex} 解出：成功 ${res.ok} / 失败 ${res.fail} / 擦除超限 ${res.tooManyErasures}（置信度 ${fr.avgConfidence.toFixed(2)}）`,
          res.fail > 0 ? "warn" : "ok"
        );
        if (rs.isComplete() && !done) {
          setDone(true);
          push("全部块收齐，可以保存文件", "ok");
        }
        return;
      }
      push("本帧未解出（帧头 CRC 未通过）：检查对焦/曝光，或离屏幕更近一些", "warn");
    },
    [done, push]
  );

  const captureOnce = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const img = grabImage(v);
    if (!img) {
      push("取帧失败：摄像头尚未就绪", "err");
      return;
    }
    setShot(`最近一帧 ${img.width}×${img.height}`);
    processCapture(img);
  }, [processCapture, push]);

  const toggleBurst = useCallback(() => {
    if (burstRef.current) {
      window.clearInterval(burstRef.current);
      burstRef.current = null;
      setBursting(false);
      return;
    }
    setBursting(true);
    burstRef.current = window.setInterval(() => {
      if (rsRef.current?.isComplete()) {
        if (burstRef.current) window.clearInterval(burstRef.current);
        burstRef.current = null;
        setBursting(false);
        return;
      }
      captureOnce();
    }, BURST_MS);
  }, [captureOnce]);

  const save = useCallback(() => {
    const rs = rsRef.current;
    if (!rs?.isComplete()) return;
    const bytes = rs.assemble();
    const buf = new ArrayBuffer(bytes.length);
    new Uint8Array(buf).set(bytes);
    const blob = new Blob([buf], { type: "application/octet-stream" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `color-transfer-${Date.now()}.bin`;
    a.click();
    URL.revokeObjectURL(a.href);
    push("文件已保存", "ok");
  }, [push]);

  const pct = total > 0 ? Math.round((received / total) * 100) : 0;

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-ink-700 bg-ink-800 px-3 py-2">
        <span className="flex items-center gap-1.5 text-sm font-medium text-gray-100">
          <Camera size={15} className="text-brand-500" /> 产品接收端
        </span>
        <span className="truncate text-xs text-gray-400">{status}</span>
        {detected && <span className="rounded-md bg-ink-700 px-2 py-0.5 text-xs text-emerald-400">档位 {detected}</span>}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={start}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm text-white transition hover:bg-brand-500"
          >
            开启摄像头
          </button>
          <button
            type="button"
            onClick={lockExposure}
            className="flex items-center gap-1.5 rounded-lg bg-ink-700 px-3 py-1.5 text-sm text-gray-100 transition hover:bg-ink-600"
          >
            <Lock size={14} /> 锁定
          </button>
          <button
            type="button"
            onClick={captureOnce}
            className="flex items-center gap-1.5 rounded-lg bg-ink-700 px-3 py-1.5 text-sm text-gray-100 transition hover:bg-ink-600"
          >
            <Zap size={14} /> 拍一帧
          </button>
          <button
            type="button"
            onClick={toggleBurst}
            className={`rounded-lg px-3 py-1.5 text-sm transition ${
              bursting ? "bg-red-600 text-white hover:bg-red-500" : "bg-ink-700 text-gray-100 hover:bg-ink-600"
            }`}
          >
            {bursting ? "停止连拍" : "连拍"}
          </button>
        </div>
      </div>

      {lockMsg && <p className="rounded-lg bg-ink-800 px-3 py-1.5 text-xs text-gray-400">{lockMsg}</p>}

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-black">
        <video ref={videoRef} playsInline muted className="h-full w-full object-contain" />
        {done && (
          <div className="absolute inset-x-0 top-0 flex items-center justify-center gap-2 bg-emerald-600/90 px-3 py-2 text-sm text-white">
            <CheckCircle2 size={16} /> 已收齐全部数据块，可保存文件
          </div>
        )}
      </div>

      <div className="rounded-xl border border-ink-700 bg-ink-800 px-3 py-2">
        <div className="mb-1.5 flex items-center justify-between text-xs text-gray-400">
          <span>
            块进度 {received}/{total || "—"}
            {shot && <span className="ml-2 text-gray-500">{shot}</span>}
          </span>
          <span>{pct}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-ink-900">
          <div
            className={`h-full rounded-full transition-all duration-300 ${done ? "bg-emerald-500" : "bg-brand-600"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <button
          type="button"
          disabled={!done}
          onClick={save}
          className={`mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm transition ${
            done ? "bg-emerald-600 text-white hover:bg-emerald-500" : "cursor-not-allowed bg-ink-900 text-gray-600"
          }`}
        >
          <Download size={15} /> 保存文件
        </button>
      </div>

      <div className="max-h-40 overflow-auto rounded-xl border border-ink-700 bg-ink-900 p-2 text-[11px] leading-relaxed">
        {log.length === 0 ? (
          <p className="text-gray-600">解码日志会显示在这里</p>
        ) : (
          log.map((l, i) => (
            <p key={i} className={l.tone === "err" ? "text-red-400" : l.tone === "warn" ? "text-amber-400" : "text-emerald-400"}>
              <span className="text-gray-600">{l.t} </span>
              {l.msg}
            </p>
          ))
        )}
      </div>

      <p className="flex items-center gap-1.5 text-[11px] text-gray-500">
        <AlertTriangle size={12} /> 若持续「未解出」，先点锁定再拍，并确保整块屏幕都在取景框内。
      </p>
    </div>
  );
}
