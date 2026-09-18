// 产品级传输编码（纯 TS、零 DOM）：文件 → RS(255,223) 码字 → 帧序列（含自描述帧头）→ 按真实 cellPx 铺满屏幕。
// 与 core/encoder.ts（实测脚手架）的区别：
//   1) 逻辑网格固定为常量（两端共享），cellPx 由屏幕尺寸反推 → 接收端无需知道发送端屏幕大小；
//   2) 顶部若干行为「帧头行」，承载 fileId/frameIndex/totalBytes → 支持乱序接收与收够即停；
//   3) 每帧承载整数个 RS 码字（块对齐），接收端按 frameIndex 直接定位码字区间。

import { RS_N, RS_K, PROFILES, bitsPerCell } from "../shared/params.ts";
import { rsEncode } from "./rs.ts";
import { packTransferHeader, headerToBits } from "../shared/protocol.ts";
import { CELL_META_ANCHOR, CELL_META_PILOT, CELL_META_ORIENT, type CellFrame } from "./encoder.ts";
import type { ModulationScheme, ProfileName, CalibMode, ColorBits } from "../shared/types.ts";

// 帧头行：既非数据也非校准格，单独一类，便于接收端先解帧头再取数据。
export const CELL_META_HEADER = 4;
export const CELL_META_DATA = 0;

// 逻辑网格（固定常量，发送端与接收端共享）。
// 取值使 1920×1080 下 cellPx **恰好等于**各档 colCellPx → 在【真实密度下铺满全屏】，
// 兑现仿真预测的净吞吐。（旧值 96×54 实际 cellPx=20，密度只有理论值的约 42%。）
export const GRIDS: Record<ProfileName, { cols: number; rows: number }> = {
  safe: { cols: 240, rows: 135 }, // colCellPx = 8 屏幕像素 → 1920×1080
  balanced: { cols: 640, rows: 360 }, // colCellPx = 3 屏幕像素 → 1920×1080
  fast: { cols: 640, rows: 360 } // colCellPx = 3 屏幕像素 → 1920×1080
};
export const HEADER_ROWS = 2;

export interface TransferPlan {
  profile: ProfileName;
  cols: number;
  rows: number;
  cellPx: number; // 由屏幕反推；必须 ≥ PROFILES[profile].cellPx
  cellPxOk: boolean; // 是否满足档位下限（不满足时只警告，不硬拦）
  scheme: ModulationScheme;
  headerRows: number;
  headerCellCount: number;
  dataCellCount: number;
  blocksPerFrame: number;
  sourceBytesPerFrame: number;
  fileId: number;
}

export interface TransferResult {
  plan: TransferPlan;
  frames: CellFrame[];
  totalBytes: number;
  totalBlocks: number;
  frameCount: number;
}

export function profileCode(p: ProfileName): number {
  return p === "safe" ? 0 : p === "balanced" ? 1 : 2;
}

export function profileFromCode(c: number): ProfileName {
  return c === 0 ? "safe" : c === 1 ? "balanced" : "fast";
}

// 纯颜色型：默认值统一取自 PROFILES（唯一事实来源），避免两处漂移。
export const DEFAULT_COLOR_BITS: Record<ProfileName, ColorBits> = {
  safe: PROFILES.safe.colorBits,
  balanced: PROFILES.balanced.colorBits,
  fast: PROFILES.fast.colorBits
};
export const DEFAULT_CALIB: Record<ProfileName, { calibMode: CalibMode; denseN: number }> = {
  safe: { calibMode: PROFILES.safe.calibMode, denseN: PROFILES.safe.denseN },
  balanced: { calibMode: PROFILES.balanced.calibMode, denseN: PROFILES.balanced.denseN },
  fast: { calibMode: PROFILES.fast.calibMode, denseN: PROFILES.fast.denseN }
};

// 帧布局：三主锚（左上/右上/左下）+ 右下方向标记 + 顶部帧头行 + 密集校准格，其余为数据格。
export function transferLayout(
  cols: number,
  rows: number,
  denseN: number,
  headerRows: number
): { cellMeta: Uint8Array; pilotParity: Uint8Array } {
  const cellMeta = new Uint8Array(cols * rows);
  const pilotParity = new Uint8Array(cols * rows);
  cellMeta[0] = CELL_META_ANCHOR;
  cellMeta[cols - 1] = CELL_META_ANCHOR;
  cellMeta[(rows - 1) * cols] = CELL_META_ANCHOR;
  cellMeta[(rows - 1) * cols + (cols - 1)] = CELL_META_ORIENT;

  // 帧头行放在第 1..headerRows 行（第 0 行两端是锚点，避开）。
  for (let r = 1; r <= headerRows && r < rows - 1; r++) {
    for (let c = 0; c < cols; c++) cellMeta[r * cols + c] = CELL_META_HEADER;
  }

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

// 由屏幕尺寸反推 cellPx，并校验是否满足档位下限。
export function planTransfer(
  profile: ProfileName,
  screenW: number,
  screenH: number,
  opts: { colorBits?: ColorBits; calibMode?: CalibMode; denseN?: number; fileId?: number } = {}
): TransferPlan {
  const g = GRIDS[profile];
  const cellPx = Math.max(1, Math.floor(Math.min(screenW / g.cols, screenH / g.rows)));
  const calib = DEFAULT_CALIB[profile];
  const denseN = opts.calibMode === "none" ? 0 : (opts.denseN ?? calib.denseN);
  const scheme: ModulationScheme = {
    id: `P-${profile}`,
    cellPx,
    symbolBits: 0, // 纯颜色型：无符号维度（v1.2 定案）
    colorBits: opts.colorBits ?? DEFAULT_COLOR_BITS[profile],
    calibMode: opts.calibMode ?? calib.calibMode,
    denseN,
    note: `产品档 ${profile}`
  };
  const bpc = bitsPerCell(scheme.symbolBits, scheme.colorBits);
  const { cellMeta } = transferLayout(g.cols, g.rows, denseN, HEADER_ROWS);
  let headerCellCount = 0;
  let dataCellCount = 0;
  for (let i = 0; i < cellMeta.length; i++) {
    if (cellMeta[i] === CELL_META_HEADER) headerCellCount++;
    else if (cellMeta[i] === CELL_META_DATA) dataCellCount++;
  }
  const payloadBytesPerFrame = Math.floor((dataCellCount * bpc) / 8);
  const blocksPerFrame = Math.max(1, Math.floor(payloadBytesPerFrame / RS_N));
  return {
    profile,
    cols: g.cols,
    rows: g.rows,
    cellPx,
    cellPxOk: cellPx >= PROFILES[profile].colCellPx,
    scheme,
    headerRows: HEADER_ROWS,
    headerCellCount,
    dataCellCount,
    blocksPerFrame,
    sourceBytesPerFrame: blocksPerFrame * RS_K,
    fileId: opts.fileId ?? Math.floor(Math.random() * 256)
  };
}

// 接收端专用：解码只依赖「网格 + 调制参数」，与 cellPx / 屏幕尺寸无关（cellPx 置 0）。
// 产品档为纯颜色型（symbolBits=0），颜色位宽与校准模式取自 PROFILES；
// 接收端只需在 3 个档位网格里试探并靠 CRC 锁定。
export function decodePlanFor(profile: ProfileName): TransferPlan {
  const g = GRIDS[profile];
  const calib = DEFAULT_CALIB[profile];
  const scheme: ModulationScheme = {
    id: `D-${profile}`,
    cellPx: 0,
    symbolBits: 0,
    colorBits: DEFAULT_COLOR_BITS[profile],
    calibMode: calib.calibMode,
    denseN: calib.denseN,
    note: "接收端解码模板"
  };
  const bpc = bitsPerCell(scheme.symbolBits, scheme.colorBits);
  const { cellMeta } = transferLayout(g.cols, g.rows, scheme.denseN, HEADER_ROWS);
  let headerCellCount = 0;
  let dataCellCount = 0;
  for (let i = 0; i < cellMeta.length; i++) {
    if (cellMeta[i] === CELL_META_HEADER) headerCellCount++;
    else if (cellMeta[i] === CELL_META_DATA) dataCellCount++;
  }
  const payloadBytesPerFrame = Math.floor((dataCellCount * bpc) / 8);
  const blocksPerFrame = Math.max(1, Math.floor(payloadBytesPerFrame / RS_N));
  return {
    profile,
    cols: g.cols,
    rows: g.rows,
    cellPx: 0,
    cellPxOk: true,
    scheme,
    headerRows: HEADER_ROWS,
    headerCellCount,
    dataCellCount,
    blocksPerFrame,
    sourceBytesPerFrame: blocksPerFrame * RS_K,
    fileId: 0
  };
}

function bytesToBits(bytes: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i++) for (let k = 7; k >= 0; k--) out.push((bytes[i] >> k) & 1);
  return out;
}

function packBitsToCellValues(bits: number[], bpc: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += bpc) {
    let v = 0;
    for (let k = 0; k < bpc; k++) v = (v << 1) | (bits[i + k] ?? 0);
    out.push(v);
  }
  return out;
}

export function encodeTransfer(file: Uint8Array, plan: TransferPlan): TransferResult {
  const { cols, rows, scheme, denseN } = { ...plan, denseN: plan.scheme.denseN };
  const bpc = bitsPerCell(scheme.symbolBits, scheme.colorBits);
  const { cellMeta, pilotParity } = transferLayout(cols, rows, denseN, plan.headerRows);

  const headerIdx: number[] = [];
  const dataIdx: number[] = [];
  for (let i = 0; i < cellMeta.length; i++) {
    if (cellMeta[i] === CELL_META_HEADER) headerIdx.push(i);
    else if (cellMeta[i] === CELL_META_DATA) dataIdx.push(i);
  }

  // 1) 分块 + RS(255,223)
  const totalBlocks = Math.max(1, Math.ceil(file.length / RS_K));
  const codewords: Uint8Array[] = [];
  for (let b = 0; b < totalBlocks; b++) {
    const chunk = new Uint8Array(RS_K);
    chunk.set(file.subarray(b * RS_K, (b + 1) * RS_K)); // 末块零填充
    codewords.push(rsEncode(chunk, RS_K, RS_N));
  }

  // 2) 切片成帧（块对齐）
  const B = plan.blocksPerFrame;
  const frameCount = Math.max(1, Math.ceil(totalBlocks / B));
  const frames: CellFrame[] = [];

  for (let fi = 0; fi < frameCount; fi++) {
    // 帧头：8 字节循环重复填满帧头行，接收端按位多数表决。
    const hdr = packTransferHeader({
      fileId: plan.fileId,
      profile: profileCode(plan.profile),
      frameIndex: fi,
      totalBytes: file.length
    });
    const hdrBits = headerToBits(hdr);
    const hdrCapBits = headerIdx.length * bpc;
    const hdrAll: number[] = [];
    while (hdrAll.length < hdrCapBits) hdrAll.push(...hdrBits);
    const hdrCells = packBitsToCellValues(hdrAll.slice(0, hdrCapBits), bpc);

    // 数据：本帧码字拼接 → 比特 → 格值
    const payload = new Uint8Array(B * RS_N);
    for (let j = 0; j < B; j++) {
      const cw = codewords[fi * B + j];
      if (cw) payload.set(cw, j * RS_N); // 末帧不足整块 → 留零（接收端按 totalBlocks 截断）
    }
    const dataCells = packBitsToCellValues(bytesToBits(payload), bpc);

    const values = new Int16Array(cols * rows).fill(-1);
    headerIdx.forEach((idx, k) => (values[idx] = hdrCells[k]));
    dataIdx.forEach((idx, k) => (values[idx] = dataCells[k] ?? -1));

    frames.push({
      cols,
      rows,
      scheme,
      denseN,
      fileId: plan.fileId,
      frameIndex: fi,
      frameCount,
      values,
      cellMeta,
      pilotParity
    });
  }

  return { plan, frames, totalBytes: file.length, totalBlocks, frameCount };
}
