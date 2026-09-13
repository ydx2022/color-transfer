// 协议帧头（纯 TS、零 DOM）：屏幕编码帧的元数据头。
// 铁律：音频反馈暂缓，但协议帧预留 feedback_capable 标志位（bit0）+ getChannelQuality() 函数。
// 字节布局（5 字节）：[version:1][flags:1][profile:1][totalBlocks:2]
import type { ProfileName } from "./types.ts";

export const PROTOCOL_VERSION = 1;

// 音频反馈暂缓：预留标志位，当前恒为 false。未来可用于「通知发送端收够可停」与「回传信道质量」。
export const FEEDBACK_CAPABLE = false;

export interface FrameHeader {
  version: number;
  feedbackCapable: boolean;
  profile: ProfileName;
  totalBlocks: number; // 文件分块总数（喷泉码下为源符号数）
}

const PROFILE_CODE: Record<ProfileName, number> = { safe: 0, balanced: 1, fast: 2 };
const CODE_PROFILE: ProfileName[] = ["safe", "balanced", "fast"];

export function packFrameHeader(h: FrameHeader): Uint8Array {
  if (h.totalBlocks < 0 || h.totalBlocks > 0xffff) throw new Error(`packFrameHeader: totalBlocks 越界 ${h.totalBlocks}`);
  const b = new Uint8Array(5);
  b[0] = h.version & 0xff;
  b[1] = (h.feedbackCapable ? 1 : 0) & 0xff;
  b[2] = PROFILE_CODE[h.profile] & 0xff;
  b[3] = (h.totalBlocks >> 8) & 0xff;
  b[4] = h.totalBlocks & 0xff;
  return b;
}

export function parseFrameHeader(b: Uint8Array): FrameHeader {
  if (b.length < 5) throw new Error(`parseFrameHeader: 长度不足 ${b.length}（需 5 字节）`);
  if (b[0] !== PROTOCOL_VERSION) throw new Error(`parseFrameHeader: 协议版本不匹配 ${b[0]}（期望 ${PROTOCOL_VERSION}）`);
  const p = CODE_PROFILE[b[2]];
  if (!p) throw new Error(`parseFrameHeader: 未知档位码 ${b[2]}`);
  return {
    version: b[0],
    feedbackCapable: (b[1] & 1) === 1,
    profile: p,
    totalBlocks: (b[3] << 8) | b[4]
  };
}
