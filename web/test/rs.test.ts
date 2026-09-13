import { rsEncode, rsDecode, rsGenerator } from "../src/core/rs.ts";
import { gfPolyEval, gfPow } from "../src/core/gf256.ts";

let pass = 0, fail = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { pass++; } else { fail++; console.error("✗ " + msg); }
}
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

// 1) 编码后必须为零码字（每个根 α^i 处值为 0）
{
  const r = rng(7);
  const k = 223, n = 255, nsym = n - k;
  const data = new Uint8Array(k);
  for (let i = 0; i < k; i++) data[i] = (r() * 256) | 0;
  const code = rsEncode(data, k, n);
  let ok = true;
  for (let i = 0; i < nsym; i++) if (gfPolyEval(Array.from(code), gfPow(2, i)) !== 0) ok = false;
  assert(ok, "编码后应为合法 RS 码字（所有 syndrome=0）");
  // 校验位不应全零
  let nz = 0; for (let j = 0; j < nsym; j++) if (code[j] !== 0) nz++;
  assert(nz > 0, "校验位不应全为零");
}

// 2) 干净往返 bit-exact
{
  const r = rng(11);
  const k = 223, n = 255;
  const data = new Uint8Array(k);
  for (let i = 0; i < k; i++) data[i] = (r() * 256) | 0;
  const code = rsEncode(data, k, n);
  const back = rsDecode(code, k, n);
  let same = back.length === k;
  for (let i = 0; i < k; i++) if (back[i] !== data[i]) same = false;
  assert(same, "干净往返 bit-exact");
}

// 3) 擦除纠正：最多 nsym 个擦除，bit-exact
{
  const r = rng(23);
  const k = 223, n = 255, nsym = n - k;
  const data = new Uint8Array(k);
  for (let i = 0; i < k; i++) data[i] = (r() * 256) | 0;
  const code = rsEncode(data, k, n);
  const E = nsym; // 满容量擦除
  const erasures: number[] = [];
  for (let i = 0; i < E; i++) erasures.push((i * 19) % n); // gcd(19,255)=1，保证位置互异
  const rx = code.slice();
  for (const p of erasures) rx[p] = 0; // 擦除 = 置零（值未知）
  const back = rsDecode(rx, k, n, erasures);
  let same = true;
  for (let i = 0; i < k; i++) if (back[i] !== data[i]) same = false;
  assert(same, `擦除纠正 ${E}/${nsym} bit-exact`);
}

// 4) 未知错误超限必须显式抛错（禁止静默）
{
  const r = rng(31);
  const k = 223, n = 255, nsym = n - k;
  const data = new Uint8Array(k);
  for (let i = 0; i < k; i++) data[i] = (r() * 256) | 0;
  const code = rsEncode(data, k, n);
  // 制造 (nsym/2 + 1) 个未声明擦除的随机错误
  const tE = Math.floor(nsym / 2) + 1;
  const rx = code.slice();
  const pos = new Set<number>();
  while (pos.size < tE) pos.add((r() * n) | 0);
  for (const p of pos) rx[p] ^= 1;
  let threw = false;
  try { rsDecode(rx, k, n); } catch { threw = true; }
  assert(threw, "未知错误超限必须显式抛错");
}

console.log(`rs.test: pass=${pass} fail=${fail}`);
if (fail > 0) process.exit(1);
