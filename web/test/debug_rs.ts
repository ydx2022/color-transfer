import { gfPow, gfMatSolve, gfPolyEval } from "../src/core/gf256.ts";
import { rsEncode } from "../src/core/rs.ts";
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const r = rng(1);
const n = 255, k = 223;
const data = new Uint8Array(k);
for (let i = 0; i < k; i++) data[i] = (r() * 256) | 0;
const code = rsEncode(data, k, n);
const E = 10;
const erasures: number[] = [];
for (let i = 0; i < E; i++) { const p = (i * 7) % n; if (!erasures.includes(p)) erasures.push(p); }
const code2 = code.slice();
for (const p of erasures) code2[p] = 0;
const nsym = n - k;
const synd = new Array(nsym).fill(0);
for (let i = 0; i < nsym; i++) synd[i] = gfPolyEval(Array.from(code2), gfPow(2, i));
const X = erasures.map((p) => gfPow(2, p));
const A: number[][] = [];
for (let i = 0; i < E; i++) A.push(erasures.map((_, p) => gfPow(X[p], i)));
// 测试可逆性：解 A x = 0
const zero = new Array(E).fill(0);
const x0 = gfMatSolve(A, zero);
const singular = x0.some((v) => v !== 0);
console.log("ERASURE_NODES=" + erasures.join(","));
console.log("A_SINGULAR=" + singular + " x0=" + x0.join(","));
// 真值验证：S_i == Σ true_e X_p^i ?
let relOk = true;
const trueE = erasures.map((p) => code[p]);
for (let i = 0; i < E; i++) {
  let acc = 0;
  for (let p = 0; p < E; p++) acc ^= gfMul2(trueE[p], gfPow(X[p], i));
  if (acc !== synd[i]) relOk = false;
}
console.log("RELATION_Si_eq_sum_trueE=" + relOk);
function gfMul2(a: number, b: number) {
  if (a === 0 || b === 0) return 0;
  let aa = a, bb = b, res = 0;
  while (bb) { if (bb & 1) res ^= aa; bb >>= 1; aa <<= 1; if (aa & 0x100) aa ^= 0x11d; }
  return res;
}
