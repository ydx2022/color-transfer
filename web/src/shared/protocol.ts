// 协议帧头（纯 TS、零 DOM）：产品级传输的「自描述帧头」。
// 与旧版 5 字节头不同，本帧头会被真正编码进画面顶部若干行数据格，
// 使接收端在任意一帧里都能读出 fileId / frameIndex / totalBytes，从而支持乱序接收与收够即停。
// 布局（8 字节 = 64 bit，MSB first）：
//   [0] magic 0x5A ｜ [1] fileId ｜ [2] profile<<6 | frameIndex>>6 ｜ [3] frameIndex&0x3F
//   [4..6] totalBytes(24bit) ｜ [7] crc8(前 7 字节)

export const PROTOCOL_VERSION = 2;
export const TRANSFER_MAGIC = 0x5a;
export const HEADER_BYTES = 8;
export const HEADER_BITS = HEADER_BYTES * 8; // 64

export const MAX_FRAMES = 1 << 12; // 4096（frameIndex 12 bit）
export const MAX_FILE_BYTES = (1 << 24) - 1; // 16 MB（totalBytes 24 bit）

export interface TransferHeader {
  fileId: number;
  profile: number;
  frameIndex: number;
  totalBytes: number;
}

// CRC-8/ATM (poly 0x07, init 0x00)：仅用于帧头完整性校验，失败即整帧丢弃（铁律：禁止静默）。
export function crc8(bytes: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let b = 0; b < 8; b++) crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  }
  return crc & 0xff;
}

export function packTransferHeader(h: TransferHeader): Uint8Array {
  if (h.frameIndex < 0 || h.frameIndex >= MAX_FRAMES) throw new Error(`packTransferHeader: frameIndex 越界 ${h.frameIndex}`);
  if (h.totalBytes < 0 || h.totalBytes > MAX_FILE_BYTES) throw new Error(`packTransferHeader: totalBytes 越界 ${h.totalBytes}`);
  const b = new Uint8Array(HEADER_BYTES);
  b[0] = TRANSFER_MAGIC;
  b[1] = h.fileId & 0xff;
  b[2] = ((h.profile & 0x03) << 6) | ((h.frameIndex >> 6) & 0x3f);
  b[3] = h.frameIndex & 0x3f;
  b[4] = (h.totalBytes >> 16) & 0xff;
  b[5] = (h.totalBytes >> 8) & 0xff;
  b[6] = h.totalBytes & 0xff;
  b[7] = crc8(b.subarray(0, 7));
  return b;
}

// 解析失败（magic 不符 / CRC 不符 / 越界）一律返回 null，由调用方显式处理。
export function parseTransferHeader(b: Uint8Array): TransferHeader | null {
  if (b.length < HEADER_BYTES) return null;
  if (b[0] !== TRANSFER_MAGIC) return null;
  if (crc8(b.subarray(0, 7)) !== b[7]) return null;
  const fileId = b[1];
  const profile = (b[2] >> 6) & 0x03;
  const frameIndex = ((b[2] & 0x3f) << 6) | (b[3] & 0x3f);
  const totalBytes = (b[4] << 16) | (b[5] << 8) | b[6];
  if (frameIndex >= MAX_FRAMES) return null;
  return { fileId, profile, frameIndex, totalBytes };
}

// 字节 → 比特（MSB first）
export function headerToBits(b: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < b.length; i++) for (let k = 7; k >= 0; k--) out.push((b[i] >> k) & 1);
  return out;
}

// 比特（MSB first）→ 字节；长度不足 8 的倍数时补零。
export function bitsToBytes(bits: number[]): Uint8Array {
  const n = Math.ceil(bits.length / 8);
  const out = new Uint8Array(n);
  for (let i = 0; i < bits.length; i++) if (bits[i]) out[i >> 3] |= 0x80 >> (i & 7);
  return out;
}

// 按位多数表决（用于帧头多次重复的抗错合并）。
export function majorityVoteBits(groups: number[][]): number[] {
  if (groups.length === 0) return [];
  const len = groups[0].length;
  const out = new Array<number>(len).fill(0);
  for (let i = 0; i < len; i++) {
    let ones = 0;
    for (const g of groups) if (g[i]) ones++;
    out[i] = ones * 2 >= groups.length ? 1 : 0;
  }
  return out;
}
