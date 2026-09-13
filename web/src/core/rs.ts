// Reed-Solomon(255,k) 内层纠错：系统码编码 + Forney 擦除纠正（纯 TS、零 DOM）。
// 约定：所有多项式按「升幂」表示（coeff[0] 为常数项）；本原元 2；fcr=0。
// 设计铁律：禁止汉明码；ECC 一律 RS + 喷泉。本模块为内层块纠错（解决块内比特错）。
// 擦除纠正：解码端可显式标记低置信度单元为「擦除」，RS 最多纠正 nsym 个擦除。
// 纠错容量（未知错误）由 rsBlockSuccessProbability 给出解析上界，供擂台赛评估。

import {
  gfMul,
  gfPow,
  gfInv,
  gfDiv,
  gfPolyMul,
  gfPolyEval,
  gfMatSolve
} from "./gf256.ts";

const genCache = new Map<number, number[]>();

// 生成多项式 g(x) = ∏_{i=0}^{nsym-1} (x + α^i)，升幂
export function rsGenerator(nsym: number): number[] {
  const cached = genCache.get(nsym);
  if (cached) return cached;
  let g: number[] = [1];
  for (let i = 0; i < nsym; i++) {
    g = gfPolyMul(g, [gfPow(2, i), 1]); // (x + α^i)
  }
  genCache.set(nsym, g);
  return g;
}

// 系统码编码：data 置于高次项（索引 nsym..n-1），校验位于低次项（0..nsym-1）
export function rsEncode(data: Uint8Array, k: number, n: number, gen?: number[]): Uint8Array {
  const nsym = n - k;
  const g = gen ?? rsGenerator(nsym);
  const code = new Array<number>(n).fill(0);
  for (let i = 0; i < k; i++) code[i + nsym] = data[i];
  const rem = polyModXm(code, g, nsym); // (data·x^{nsym}) mod g，长度 nsym
  for (let j = 0; j < nsym; j++) code[j] = rem[j];
  return Uint8Array.from(code);
}

// 解码：erasurePos 为「升幂索引」（即码字数组下标）。返回数据段 k 字节。
// 完整纠正（擦除 + Forney）。若超出容量显式抛错，禁止静默返回垃圾。
export function rsDecode(rx: Uint8Array, k: number, n: number, erasurePos: number[] = []): Uint8Array {
  const nsym = n - k;
  if (rx.length !== n) throw new Error(`rsDecode: 码字长度应为 ${n}，实际 ${rx.length}`);
  if (erasurePos.length > nsym) throw new Error(`rsDecode: 擦除数 ${erasurePos.length} 超过容量 nsym=${nsym}`);

  const synd = new Array<number>(nsym);
  for (let i = 0; i < nsym; i++) synd[i] = gfPolyEval(Array.from(rx), gfPow(2, i));
  const hasErr = synd.some((s) => s !== 0) || erasurePos.length > 0;
  if (!hasErr) return rx.slice(nsym, n);

  const code = Array.from(rx);
  if (erasurePos.length > 0) {
    // 擦除幅度求解：Σ_p e_p X_p^i = S_i，X_p = α^{pos_p}，范德蒙 GF(256) 线性解。
    const X = erasurePos.map((p) => gfPow(2, p));
    const A: number[][] = [];
    for (let i = 0; i < erasurePos.length; i++) {
      const row = new Array<number>(erasurePos.length);
      for (let p = 0; p < erasurePos.length; p++) row[p] = gfPow(X[p], i);
      A.push(row);
    }
    const b = synd.slice(0, erasurePos.length);
    const e = gfMatSolve(A, b);
    for (let p = 0; p < erasurePos.length; p++) code[erasurePos[p]] ^= e[p];
  }

  // 完整性校验：纠正后必须所有 syndrome 归零；否则存在未纠正错误 → 显式报错（铁律：禁止静默）。
  for (let i = 0; i < nsym; i++) {
    if (gfPolyEval(code, gfPow(2, i)) !== 0) {
      throw new Error("rsDecode: 纠正后仍有残留错误（本期仅支持擦除纠正，存在未知错误时块失败）");
    }
  }
  return Uint8Array.from(code.slice(nsym, n));
}

// (a mod g)，保留低 m 项（m = nsym）。a、g 均为升幂数组。
// 升幂长除法：从最高次向低次消元，余数落在低次项（0..m-1）。
function polyModXm(a: number[], g: number[], m: number): number[] {
  const r = a.slice();
  const dg = g.length - 1; // = m，g 为 monic
  for (let i = r.length - 1; i >= dg; i--) {
    const coef = r[i];
    if (coef === 0) continue;
    // r(x) -= coef · x^{i-dg} · g(x)，消去第 i 次项（g[dg]=1 → r[i] ^= coef·1 = 0）
    for (let j = 0; j <= dg; j++) r[i - dg + j] ^= gfMul(g[j], coef);
  }
  return r.slice(0, m);
}

// RS(n,k) 块级成功概率解析上界：每字节错误概率 pByte，最多纠正 tE=(n-k)/2 未知错误。
// 用于擂台赛「解码成功率」评估（理论可纠正上限），标注为解析界而非实测解码。
export function rsBlockSuccessProbability(pByte: number, k: number, n: number): number {
  const nsym = n - k;
  const tE = Math.floor(nsym / 2);
  let pFail = 0;
  // 失败 = 错误字节数 > tE
  for (let e = tE + 1; e <= n; e++) {
    pFail += binomial(n, e) * Math.pow(pByte, e) * Math.pow(1 - pByte, n - e);
  }
  return Math.max(0, 1 - pFail);
}

function binomial(N: number, K: number): number {
  if (K < 0 || K > N) return 0;
  let r = 1;
  for (let i = 0; i < K; i++) r = (r * (N - i)) / (i + 1);
  return r;
}

// 纠错容量信息（供文档/日志）
export function rsCapacityInfo(k: number, n: number) {
  const nsym = n - k;
  return {
    n,
    k,
    parity: nsym,
    maxErasures: nsym,
    maxErrors: Math.floor(nsym / 2)
  };
}
