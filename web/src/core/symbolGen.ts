// 符号集离线生成：在 GRID×GRID 二值空间中搜索 2^symbolBits 个图案，最大化两两最小汉明距离。
// 确定性（固定种子），可复现。调制擂台赛将用其评估「模糊后实际可达距离」。
import { SYMBOL_GRID } from "../shared/params.ts";

export type BitPattern = number[]; // 长度 GRID*GRID，元素 0/1，行优先

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function randPattern(rng: () => number, n: number): BitPattern {
  const p = new Array<number>(n);
  for (let i = 0; i < n; i++) p[i] = rng() < 0.5 ? 0 : 1;
  return p;
}

export function hamming(a: BitPattern, b: BitPattern): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i] ^ b[i];
  return d;
}

function minDistToSet(set: BitPattern[], cand: BitPattern): number {
  let m = Infinity;
  for (const s of set) m = Math.min(m, hamming(s, cand));
  return m;
}

function setMinDist(set: BitPattern[]): number {
  let m = Infinity;
  for (let i = 0; i < set.length; i++) for (let j = i + 1; j < set.length; j++) m = Math.min(m, hamming(set[i], set[j]));
  return m === Infinity ? 0 : m;
}

export interface SymbolSet {
  grid: number;
  count: number;
  symbols: BitPattern[];
  minDistance: number;
}

// 贪心随机重启搜索：每步加入使「到现有集合最小距离」最大的候选
export function generateSymbols(grid = SYMBOL_GRID, count = 16, seed = 0x5eed1234): SymbolSet {
  const n = grid * grid;
  const rng = lcg(seed);
  let best: SymbolSet | null = null;
  const restarts = 300;
  const candidatesPerStep = 500;
  for (let restart = 0; restart < restarts; restart++) {
    const set: BitPattern[] = [randPattern(rng, n)];
    for (let k = 1; k < count; k++) {
      let bestCand: BitPattern | null = null;
      let bestScore = -1;
      for (let t = 0; t < candidatesPerStep; t++) {
        const c = randPattern(rng, n);
        const sc = minDistToSet(set, c);
        if (sc > bestScore) {
          bestScore = sc;
          bestCand = c;
        }
      }
      if (!bestCand || bestScore <= 0) break;
      set.push(bestCand);
    }
    const md = setMinDist(set);
    if (!best || md > best.minDistance) best = { grid, count: set.length, symbols: set.map((p) => p.slice()), minDistance: md };
    if (best && best.minDistance >= n * 0.45) break; // 已达较高距离，提前停止
  }
  if (!best) throw new Error("generateSymbols: 未能生成符号集");
  return best;
}

// 对图案施加简单盒式模糊（模拟 PSF 对形状维度的影响），返回浮点亮度场 0..1
export function blurPattern(p: BitPattern, grid: number, radius: number): number[] {
  const out = new Array<number>(p.length).fill(0);
  const r = Math.max(0, Math.round(radius));
  if (r === 0) return p.slice();
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      let sum = 0;
      let cnt = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy < 0 || yy >= grid || xx < 0 || xx >= grid) continue;
          sum += p[yy * grid + xx];
          cnt++;
        }
      }
      out[y * grid + x] = sum / cnt;
    }
  }
  return out;
}

// 模糊后两两最小汉明距离（按 0.5 阈值二值化比较）
export function blurredMinDistance(set: SymbolSet, blurRadius: number): number {
  const blurred = set.symbols.map((p) => blurPattern(p, set.grid, blurRadius).map((v) => (v >= 0.5 ? 1 : 0)));
  let m = Infinity;
  for (let i = 0; i < blurred.length; i++)
    for (let j = i + 1; j < blurred.length; j++) m = Math.min(m, hamming(blurred[i], blurred[j]));
  return m === Infinity ? 0 : m;
}
