// 调制映射（纯 TS、零 DOM）：把每格的 bits 拆为「符号位 + 颜色位」，并映射回 bits。
import type { SymbolBits, ColorBits, ModulationScheme } from "../shared/types.ts";
import { SYMBOLS_8x8, SYMBOL_GRID } from "../shared/symbols.ts";

export function symbolSubset(symbolBits: SymbolBits): number[][] {
  const n = 1 << symbolBits;
  return SYMBOLS_8x8.slice(0, n);
}

export function bitsPerCellOf(scheme: ModulationScheme): number {
  return scheme.symbolBits + scheme.colorBits;
}

export interface CellCode {
  symbolIdx: number;
  colorIdx: number;
  value: number; // 组合整数
}

// 低 colorBits 位为颜色，高 symbolBits 位为符号。
// 注：colorBits=0 时符号位照常取（value 的全部位都归符号维度），
// 旧版在此特判为 symbolIdx=0，会让「纯形状」方案（如 T8）每格画成同一个符号，形状维度零信息量。
export function encodeCell(scheme: ModulationScheme, value: number): CellCode {
  const colorMask = (1 << scheme.colorBits) - 1;
  const colorIdx = value & colorMask;
  const symbolIdx = (value >> scheme.colorBits) & ((1 << scheme.symbolBits) - 1);
  return { symbolIdx, colorIdx, value };
}

export function decodeCell(scheme: ModulationScheme, symbolIdx: number, colorIdx: number): number {
  return (symbolIdx << scheme.colorBits) | colorIdx;
}

export function popcount(x: number): number {
  let c = 0;
  while (x) {
    c += x & 1;
    x >>>= 1;
  }
  return c;
}

export { SYMBOL_GRID };
