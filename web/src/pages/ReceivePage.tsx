import { useEffect, useRef, useState } from "react";
import { Camera, Lock, Zap, AlertTriangle } from "lucide-react";

// 解码管线占位（本期不实现本体；后续任务填充 receiver/locate|normalize|decoder）。
// 仅保留函数签名，便于后续直接接入。
export interface CapturedFrame {
  width: number;
  height: number;
  data: Uint8ClampedArray; // RGBA
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function decodeCapturedFrame(_frame: CapturedFrame): Promise<number[]> {
  throw new Error("解码未实现（本期骨架）；后续接入 receiver/locate+normalize+decoder");
}

export function ReceivePage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<string>("未启动");
  const [captured, setCaptured] = useState<string | null>(null);
  const [lockMsg, setLockMsg] = useState<string>("");

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

  // 提示并尽量锁定对焦/曝光（网页端多数设备仅部分可锁；不可锁时如实提示）
  const lockExposure = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) {
      setLockMsg("未开启摄像头，无法锁定");
      return;
    }
    const caps = track.getCapabilities?.() ?? {};
    const msgs: string[] = [];
    try {
      if ((caps as { focusMode?: string[] }).focusMode?.includes("manual")) {
        // focusMode 属非标准约束，TS 的 MediaTrackConstraints 未收录，走 advanced 传递
        await track.applyConstraints({ advanced: [{ focusMode: "manual" } as unknown as MediaTrackConstraintSet] });
        msgs.push("对焦：已锁定(MF)");
      } else msgs.push("对焦：设备不可锁(自动)");
    } catch {
      msgs.push("对焦：锁定失败");
    }
    try {
      if ((caps as { exposureMode?: string[] }).exposureMode?.includes("manual")) {
        // exposureMode 同为非标准约束，走 advanced 传递
        await track.applyConstraints({ advanced: [{ exposureMode: "manual" } as unknown as MediaTrackConstraintSet] });
        msgs.push("曝光：已锁定");
      } else msgs.push("曝光：设备不可锁(自动)");
    } catch {
      msgs.push("曝光：锁定失败");
    }
    setLockMsg(msgs.join(" · "));
  };

  // 快门抓帧：绘制到离屏 canvas，预览 + 直接保存到手机本地（"传回本地"路径 A，零后端）
  const shutter = () => {
    const v = videoRef.current;
    const cv = canvasRef.current;
    if (!v || !cv) return;
    cv.width = v.videoWidth || 1280;
    cv.height = v.videoHeight || 720;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, cv.width, cv.height);
    const url = cv.toDataURL("image/png");
    setCaptured(url);
    setStatus("已抓帧并保存到手机本地（本期不解码）");
    cv.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `capture_${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    }, "image/png");
  };

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
        <button onClick={shutter} className="flex items-center gap-1 rounded-lg bg-ink-700 px-3 py-1.5 text-gray-200 hover:bg-ink-700/70">
          <Zap size={16} /> 快门抓帧
        </button>
      </div>

      {lockMsg && <div className="text-xs text-gray-400">{lockMsg}</div>}

      <div className="relative flex-1 overflow-hidden rounded-xl border border-ink-700 bg-black">
        <video ref={videoRef} className="block h-full w-full object-cover" playsInline muted />
        <canvas ref={canvasRef} className="hidden" />
      </div>

      {captured && (
        <div className="rounded-xl border border-ink-700 bg-ink-800 p-2">
          <div className="mb-1 flex items-center gap-2 text-xs text-gray-400">
            <AlertTriangle size={14} className="text-warn" /> 已抓帧（暂存预览，解码管线占位未启用）
          </div>
          <img src={captured} alt="captured" className="max-h-48 rounded-lg" />
        </div>
      )}

      <p className="text-xs text-gray-500">
        本期为接收端骨架：仅 getUserMedia 预览 + 快门抓帧。解码（locate/normalize/decoder）留空，后续任务接入。
      </p>
    </div>
  );
}
