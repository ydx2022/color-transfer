// GF(2^8) 有限域算术（生成多项式 0x11d，本原元 2），纯 TS、零 DOM。
// 来源：标准 Reed-Solomon 实现依据；用于 RS(255,k) 内层纠错与喷泉码符号运算。

export const GF_POLY = 0x11d;

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

(function initTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= GF_POLY;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  LOG[0] = 0; // 约定；gfMul/gfDiv 对 0 单独处理
})();

export function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

export function gfDiv(a: number, b: number): number {
  if (b === 0) throw new Error("gfDiv: 除零");
  if (a === 0) return 0;
  return EXP[(LOG[a] + 255 - LOG[b]) % 255];
}

export function gfPow(a: number, p: number): number {
  if (a === 0) return p === 0 ? 1 : 0;
  const r = (LOG[a] * p) % 255;
  return r < 0 ? EXP[r + 255] : EXP[r];
}

export function gfInv(a: number): number {
  if (a === 0) throw new Error("gfInv(0)");
  return EXP[255 - LOG[a]];
}

// 多项式（系数按升幂排列：coeff[0] 为常数项）
export function gfPolyScale(p: number[], s: number): number[] {
  return p.map((c) => gfMul(c, s));
}

export function gfPolyAdd(a: number[], b: number[]): number[] {
  const out = a.slice();
  while (out.length < b.length) out.push(0);
  for (let i = 0; i < b.length; i++) out[i] ^= b[i];
  while (out.length > 1 && out[out.length - 1] === 0) out.pop();
  return out;
}

export function gfPolyMul(a: number[], b: number[]): number[] {
  const out = new Array<number>(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 0) continue;
    for (let j = 0; j < b.length; j++) {
      out[i + j] ^= gfMul(a[i], b[j]);
    }
  }
  return out;
}

export function gfPolyEval(p: number[], x: number): number {
  let y = p[p.length - 1];
  for (let i = p.length - 2; i >= 0; i--) y = gfMul(y, x) ^ p[i];
  return y;
}

// 多项式形式导数（GF(2)：仅奇数次幂保留系数）
export function gfPolyDeriv(p: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < p.length; i++) {
    if (i & 1) out.push(p[i]);
    else out.push(0);
  }
  return out;
}

export function gfPolyEvalDeriv(p: number[], x: number): number {
  return gfPolyEval(gfPolyDeriv(p), x);
}

// 解线性方程组 A x = b（GF(256)，高斯消元 + 行主元）。用于 RS 擦除幅度求解（稳健、不依赖 Forney 公式）。
export function gfMatSolve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = -1;
    for (let r = col; r < n; r++) {
      if (M[r][col] !== 0) {
        piv = r;
        break;
      }
    }
    if (piv === -1) throw new Error("gfMatSolve: 奇异矩阵（无解）");
    [M[col], M[piv]] = [M[piv], M[col]];
    const inv = gfInv(M[col][col]);
    for (let j = col; j <= n; j++) M[col][j] = gfMul(M[col][j], inv);
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      if (factor !== 0) for (let j = col; j <= n; j++) M[r][j] ^= gfMul(factor, M[col][j]);
    }
  }
  return M.map((row) => row[n]);
}
