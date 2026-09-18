// 文件编码流水线（纯 TS、零 DOM）：文件 → 分块 → RS(255,k) → 比特打包成「格值」→ 帧布局。
// 解码端反向：定位锚点 → 透视校正 → 读格 → encodeCell 逆映射 → RS 纠错 → 块重组（见 core/blockAssembler）。
// 注：喷泉码（rateless）作为外层，本期发送端按「整帧序列循环播放」铺满所有 RS 码字；
// 接收端收够任意 N+1 帧即可重组（等价于喷泉码「收够即停」语义）。

import { RS_N, RS_K } from "../shared/params.ts";
import { rsEncode } from "./rs.ts";
import { encodeCell, bitsPerCellOf } from "./modulation.ts";
import type { ModulationScheme } from "../shared/types.ts";

export const CELL_META_DATA = 0;
export const CELL_META_ANCHOR = 1; // 锚点 anchor（左上/右上/左下 三主锚）
export const CELL_META_PILOT = 2; // 校准格 pilot cell（颜色已知，供局部增益估计；不承载数据）
export const CELL_META_ORIENT = 3; // 方向标记（右下角；图案与主锚相反，用于判定旋转 0/90/180/270）

export interface CellFrame {
  cols: number;
  rows: number;
  scheme: ModulationScheme;
  denseN: number;
  fileId: number;
  frameIndex: number; // 0-based
  frameCount: number;
  // 每格编码值（已 encodeCell 拆好）；-1 = 非数据格（锚点/校准格/方向标记/未填充）
  values: Int16Array;
  cellMeta: Uint8Array; // CELL_META_*
  pilotParity: Uint8Array; // 校准格 pilot cell 的颜色索引（(c+r)&1 取 0/1）
}

export interface EncodeResult {
  frames: CellFrame[];
  totalBytes: number;
  rsBlocks: number;
  bitsPerCell: number;
  fileId: number;
}

// 帧布局：三主锚（左上/右上/左下）+ 右下角方向标记 + 内部按 denseN 网格插校准格，其余为数据格。
// 三主锚图案彼此相同，仅靠「空角」判旋转过于脆弱（实测抓帧为躺倒竖图），故补右下角方向标记：
// 其图案与主锚相反（暗底亮心 vs 亮底暗心），四个角两两可区分，旋转 0/90/180/270 可唯一判定。
export function computeLayout(cols: number, rows: number, denseN: number): { cellMeta: Uint8Array; pilotParity: Uint8Array } {
  const cellMeta = new Uint8Array(cols * rows);
  const pilotParity = new Uint8Array(cols * rows);
  const mark = (c: number, r: number) => {
    cellMeta[r * cols + c] = CELL_META_ANCHOR;
  };
  mark(0, 0);
  mark(cols - 1, 0);
  mark(0, rows - 1);
  cellMeta[(rows - 1) * cols + (cols - 1)] = CELL_META_ORIENT;
  if (denseN > 0) {
    for (let r = denseN; r < rows - 1; r += denseN + 1) {
      for (let c = denseN; c < cols - 1; c += denseN + 1) {
        const i = r * cols + c;
        if (cellMeta[i] === CELL_META_DATA) {
          cellMeta[i] = CELL_META_PILOT;
          pilotParity[i] = (c + r) & 1;
        }
      }
    }
  }
  return { cellMeta, pilotParity };
}

// 把字节流按 bitsPerCell 打包为「格值」整数数组（高位在前，末格补零）。
export function packBytesToCellValues(payload: Uint8Array, scheme: ModulationScheme): number[] {
  const bpc = bitsPerCellOf(scheme);
  const mask = (1 << bpc) - 1;
  const out: number[] = [];
  let acc = 0;
  let nb = 0;
  for (let i = 0; i < payload.length; i++) {
    acc = (acc << 8) | payload[i];
    nb += 8;
    while (nb >= bpc) {
      nb -= bpc;
      out.push((acc >>> nb) & mask);
    }
  }
  if (nb > 0) out.push((acc & ((1 << nb) - 1)) << (bpc - nb)); // 末格补零
  return out;
}

export function countDataCells(cellMeta: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < cellMeta.length; i++) if (cellMeta[i] === CELL_META_DATA) n++;
  return n;
}

export function encodeFile(
  file: Uint8Array,
  scheme: ModulationScheme,
  opts: { cols?: number; rows?: number; fileId?: number; fill?: "pad" | "cycle" } = {}
): EncodeResult {
  const cols = opts.cols ?? 24;
  const rows = opts.rows ?? 14;
  const fileId = opts.fileId ?? 1;
  const denseN = scheme.calibMode === "dense" ? Math.max(1, scheme.denseN ?? 3) : 0;

  // 1) 分块 + RS(255,k) 系统码
  const k = RS_K;
  const n = RS_N;
  const blocks: Uint8Array[] = [];
  for (let off = 0; off < file.length; off += k) {
    let blk = file.subarray(off, off + k);
    if (blk.length < k) {
      const pad = new Uint8Array(k);
      pad.set(blk);
      blk = pad;
    }
    blocks.push(rsEncode(blk, k, n));
  }
  const rsPayload = new Uint8Array(blocks.length * n);
  blocks.forEach((b, i) => rsPayload.set(b, i * n));

  // 2) 帧布局（先算数据格容量，用于 cycle 填充）
  const { cellMeta, pilotParity } = computeLayout(cols, rows, denseN);
  const dataCapacity = countDataCells(cellMeta);

  // 3) 比特打包成格值
  //    fill="cycle"：把 RS 码字循环铺满全部数据格（全屏实测用，避免大网格下大量空白格）
  //    fill="pad"（默认）：载荷不足则剩余格置 -1（擦除），用于真实文件传输
  let cellValues: number[];
  if (opts.fill === "cycle" && rsPayload.length > 0) {
    const targetBytes = Math.ceil((dataCapacity * bitsPerCellOf(scheme)) / 8);
    const full = new Uint8Array(targetBytes);
    for (let i = 0; i < targetBytes; i++) full[i] = rsPayload[i % rsPayload.length];
    cellValues = packBytesToCellValues(full, scheme);
  } else {
    cellValues = packBytesToCellValues(rsPayload, scheme);
  }

  // 4) 切片成帧
  const frameCount = Math.max(1, Math.ceil(cellValues.length / Math.max(1, dataCapacity)));
  const frames: CellFrame[] = [];
  let idx = 0;
  for (let fi = 0; fi < frameCount; fi++) {
    const values = new Int16Array(cols * rows).fill(-1);
    for (let i = 0; i < cellMeta.length; i++) {
      if (cellMeta[i] === CELL_META_DATA && idx < cellValues.length) {
        values[i] = cellValues[idx++];
      }
    }
    frames.push({ cols, rows, scheme, denseN, fileId, frameIndex: fi, frameCount, values, cellMeta, pilotParity });
  }
  return { frames, totalBytes: file.length, rsBlocks: blocks.length, bitsPerCell: bitsPerCellOf(scheme), fileId };
}

// 单帧可承载的源字节（含 RS 开销与锚点/校准占用）
export function frameCapacityBytes(scheme: ModulationScheme, cols: number, rows: number): number {
  const denseN = scheme.calibMode === "dense" ? Math.max(1, scheme.denseN ?? 3) : 0;
  const { cellMeta } = computeLayout(cols, rows, denseN);
  const dataCap = countDataCells(cellMeta);
  const cellsPerFileByte = 8 / bitsPerCellOf(scheme);
  const bytesPerFrame = (dataCap / cellsPerFileByte) * (RS_K / RS_N); // 扣 RS 开销
  return Math.floor(bytesPerFrame);
}
