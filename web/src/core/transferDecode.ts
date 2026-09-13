// 产品级传输解码（纯 TS、零 DOM）：把 decodeImage 的结果还原为「帧头 + RS 码字（带擦除位置）」并重组文件。
// 擦除策略：解码端对每格给出置信度，低置信度格所覆盖的字节标记为「擦除」交给 RS；
// RS(255,223) 最多纠正 32 个擦除（远优于 16 个未知错误），故置信度驱动的擦除是本链路的关键。

import { RS_N, RS_K, bitsPerCell } from "../shared/params.ts";
import { rsDecode } from "./rs.ts";
import { parseTransferHeader, bitsToBytes, majorityVoteBits } from "../shared/protocol.ts";
import type { TransferHeader } from "../shared/protocol.ts";
import { CELL_META_HEADER, CELL_META_DATA, transferLayout, type TransferPlan } from "./transfer.ts";
import type { DecodedFrame } from "../receiver/types.ts";

// 置信度低于此值 → 该格所覆盖的字节标记为擦除。
export const ERASE_CONFIDENCE = 0.15;

export interface Codeword {
  blockIndex: number;
  data: Uint8Array; // 255 字节
  erasures: number[]; // 码字内下标
}

export interface DecodedTransferFrame {
  header: TransferHeader;
  totalBlocks: number;
  codewords: Codeword[];
  headerOk: boolean;
  avgConfidence: number;
}

function layoutIndices(plan: TransferPlan): { headerIdx: number[]; dataIdx: number[] } {
  const { cellMeta } = transferLayout(plan.cols, plan.rows, plan.scheme.denseN, plan.headerRows);
  const headerIdx: number[] = [];
  const dataIdx: number[] = [];
  for (let i = 0; i < cellMeta.length; i++) {
    if (cellMeta[i] === CELL_META_HEADER) headerIdx.push(i);
    else if (cellMeta[i] === CELL_META_DATA) dataIdx.push(i);
  }
  return { headerIdx, dataIdx };
}

// 从解码结果中解出帧头：帧头行按 64 bit 分组 → 逐位多数表决 → CRC 校验。
export function readFrameHeader(decoded: DecodedFrame, plan: TransferPlan): TransferHeader | null {
  const bpc = bitsPerCell(plan.scheme.symbolBits, plan.scheme.colorBits);
  const { headerIdx } = layoutIndices(plan);
  const bits: number[] = [];
  for (const idx of headerIdx) {
    const v = decoded.values[idx];
    for (let k = bpc - 1; k >= 0; k--) bits.push(v < 0 ? 0 : (v >> k) & 1);
  }
  const groups: number[][] = [];
  for (let i = 0; i + 64 <= bits.length; i += 64) groups.push(bits.slice(i, i + 64));
  if (groups.length === 0) return null;
  const merged = majorityVoteBits(groups);
  return parseTransferHeader(bitsToBytes(merged));
}

// 解出本帧承载的 RS 码字（含擦除位置）。
export function decodeTransferFrame(decoded: DecodedFrame, plan: TransferPlan): DecodedTransferFrame | null {
  const header = readFrameHeader(decoded, plan);
  if (!header) return null;
  const bpc = bitsPerCell(plan.scheme.symbolBits, plan.scheme.colorBits);
  const { dataIdx } = layoutIndices(plan);

  const bits: number[] = [];
  const eraseRanges: Array<[number, number]> = [];
  let bitPos = 0;
  let confSum = 0;
  let confN = 0;
  for (const idx of dataIdx) {
    const v = decoded.values[idx];
    const c = decoded.cells?.[idx];
    const conf = c ? Math.min(c.colorConf, c.symbolConf) : 0;
    if (c) {
      confSum += conf;
      confN++;
    }
    for (let k = bpc - 1; k >= 0; k--) bits.push(v < 0 ? 0 : (v >> k) & 1);
    if (v < 0 || conf < ERASE_CONFIDENCE) eraseRanges.push([bitPos, bitPos + bpc]);
    bitPos += bpc;
  }

  const nBytes = Math.floor(bits.length / 8);
  const bytes = new Uint8Array(nBytes);
  const byteErased = new Uint8Array(nBytes);
  for (let j = 0; j < nBytes; j++) {
    let v = 0;
    for (let k = 0; k < 8; k++) v = (v << 1) | bits[j * 8 + k];
    bytes[j] = v;
    const s = j * 8;
    const e = s + 8;
    for (const [rs, re] of eraseRanges) {
      if (rs < e && re > s) {
        byteErased[j] = 1;
        break;
      }
    }
  }

  const totalBlocks = Math.max(1, Math.ceil(header.totalBytes / RS_K));
  const B = plan.blocksPerFrame;
  const codewords: Codeword[] = [];
  for (let j = 0; j < B; j++) {
    const blockIndex = header.frameIndex * B + j;
    if (blockIndex >= totalBlocks) break;
    const off = j * RS_N;
    if (off + RS_N > nBytes) break;
    const erasures: number[] = [];
    for (let p = 0; p < RS_N; p++) if (byteErased[off + p]) erasures.push(p);
    codewords.push({ blockIndex, data: bytes.subarray(off, off + RS_N), erasures });
  }

  return {
    header,
    totalBlocks,
    codewords,
    headerOk: true,
    avgConfidence: confN > 0 ? confSum / confN : 0
  };
}

// 块重组：按 blockIndex 收集源数据，收够即停。
export class TransferReassembler {
  private blocks = new Map<number, Uint8Array>();
  readonly totalBlocks: number;
  readonly totalBytes: number;

  constructor(totalBytes: number) {
    this.totalBytes = totalBytes;
    this.totalBlocks = Math.max(1, Math.ceil(totalBytes / RS_K));
  }

  has(i: number): boolean {
    return this.blocks.has(i);
  }

  addSource(blockIndex: number, data: Uint8Array): boolean {
    if (blockIndex < 0 || blockIndex >= this.totalBlocks) return false;
    if (this.blocks.has(blockIndex)) return false;
    this.blocks.set(blockIndex, data);
    return true;
  }

  get received(): number {
    return this.blocks.size;
  }

  get progress(): number {
    return this.blocks.size / this.totalBlocks;
  }

  isComplete(): boolean {
    return this.blocks.size >= this.totalBlocks;
  }

  assemble(): Uint8Array {
    if (!this.isComplete()) throw new Error("TransferReassembler: 块未收齐，无法重组");
    const out = new Uint8Array(this.totalBlocks * RS_K);
    for (let i = 0; i < this.totalBlocks; i++) out.set(this.blocks.get(i)!, i * RS_K);
    return out.subarray(0, this.totalBytes);
  }
}

export interface RsAttemptResult {
  ok: number;
  fail: number;
  tooManyErasures: number;
  log: string[];
}

// 对本帧各码字做 RS 擦除纠正并入库。返回统计，供 UI 显示。
export function ingestFrame(fr: DecodedTransferFrame, rs: TransferReassembler): RsAttemptResult {
  const res: RsAttemptResult = { ok: 0, fail: 0, tooManyErasures: 0, log: [] };
  for (const cw of fr.codewords) {
    if (rs.has(cw.blockIndex)) continue;
    if (cw.erasures.length > RS_N - RS_K) {
      res.tooManyErasures++;
      res.log.push(`块 #${cw.blockIndex} 擦除 ${cw.erasures.length} > 容量 ${RS_N - RS_K}，本帧放弃`);
      continue;
    }
    try {
      const src = rsDecode(cw.data, RS_K, RS_N, cw.erasures);
      if (rs.addSource(cw.blockIndex, src)) {
        res.ok++;
        res.log.push(`块 #${cw.blockIndex} 纠正成功（擦除 ${cw.erasures.length}）`);
      }
    } catch (e) {
      res.fail++;
      res.log.push(`块 #${cw.blockIndex} 纠正失败：${(e as Error).message}`);
      console.error(e);
    }
  }
  return res;
}
