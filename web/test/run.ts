// 模块 round-trip 测试（纯 TS）：每个核心模块 encode→decode 验证；标定缺失显式抛错；三组标定→档位。
// 运行：npm test
import { rsEncode, rsDecode, rsGenerator } from "../src/core/rs.ts";
import { generateSymbols } from "../src/core/symbolGen.ts";
import { encodeCell, decodeCell, symbolSubset, bitsPerCellOf } from "../src/core/modulation.ts";
import { loadChannelModel, loadCalibration, loadAllModels } from "../src/core/calibration.ts";
import { getChannelQuality, getChannelQualityFromGroup, estimateDRec } from "../src/core/getChannelQuality.ts";
import { runScheme } from "../src/core/bakeoff.ts";
import { fountainRoundTrip, LTEncoder, LTDecoder } from "../src/core/fountain.ts";
import type { ChannelModel, ModulationScheme } from "../src/shared/types.ts";
import { DEFAULT_SYMBOL_BITS, DEFAULT_COLOR_BITS, MOIRE_ATT_SIGMA_DEFAULT } from "../src/shared/params.ts";
import { packFrameHeader, parseFrameHeader, FEEDBACK_CAPABLE } from "../src/shared/protocol.ts";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

console.log("== RS(255,223) ==");
{
  const n = 255;
  const k = 223;
  const r = rng(1);
  const data = new Uint8Array(k);
  for (let i = 0; i < k; i++) data[i] = (r() * 256) | 0;
  const code = rsEncode(data, k, n);
  const back = rsDecode(code, k, n);
  check("编码→解码（无错）bit-exact", sameBytes(back, data));

  // 擦除纠正：注入 10 个擦除
  const e = 10;
  const erased: number[] = [];
  const code2 = code.slice();
  for (let i = 0; i < e; i++) {
    const p = i * 7 % n;
    if (!erased.includes(p)) {
      erased.push(p);
      code2[p] = 0;
    }
  }
  const back2 = rsDecode(code2, k, n, erased);
  check(`擦除纠正（${e} 个）bit-exact`, sameBytes(back2, data));
  check("生成多项式阶数正确", rsGenerator(n - k).length === n - k + 1);
}

console.log("== 符号集 + 调制映射 ==");
{
  const set = generateSymbols(8, 16, 0x5eed1234);
  check("生成 16 个符号", set.symbols.length === 16);
  check("最小汉明距离 > 0", set.minDistance > 0, `d=${set.minDistance}`);

  const scheme: ModulationScheme = {
    id: "t",
    cellPx: 13,
    symbolBits: DEFAULT_SYMBOL_BITS,
    colorBits: DEFAULT_COLOR_BITS,
    calibMode: "dense",
    denseN: 3,
    note: "test"
  };
  const bits = bitsPerCellOf(scheme);
  let exact = true;
  for (let v = 0; v < 1 << bits; v++) {
    const c = encodeCell(scheme, v);
    const d = decodeCell(scheme, c.symbolIdx, c.colorIdx);
    if (d !== v) exact = false;
  }
  check("调制 encode→decode（无信道）bit-exact", exact, `bits=${bits}`);
  check("符号子集长度匹配", symbolSubset(DEFAULT_SYMBOL_BITS).length === 1 << DEFAULT_SYMBOL_BITS);
}

console.log("== 信道仿真：校准有效性 ==");
{
  const perfect: ChannelModel = {
    group: "perfect",
    rho: 100,
    sigmaPsf: 0.01,
    tC: 1,
    gamma: 1,
    gain: 1,
    blackOffset: 0,
    ccmEncoded: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    ccmOffset: [0, 0, 0],
    ccmLinear: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    ccmLinearOffset: [0, 0, 0],
    cornerLoss: 0,
    noiseSigmaY: 0,
    gradient: { tl: 1, tr: 1, bl: 1, br: 1 },
    worstCase: false,
    moireIntensity: 0,
    moireAngleDeg: 0,
    moireCycles: 3,
    moireAttenuationSigma: MOIRE_ATT_SIGMA_DEFAULT
  };
  const scheme: ModulationScheme = {
    id: "t",
    cellPx: 13,
    symbolBits: DEFAULT_SYMBOL_BITS,
    colorBits: DEFAULT_COLOR_BITS,
    calibMode: "dense",
    denseN: 3,
    note: "test"
  };
  const res = runScheme(scheme, perfect, { cells: 400, seed: 9 });
  check("近理想信道 + 密集校准：格错误率≈0", res.cellErrorRate === 0, `=${res.cellErrorRate}`);

  // 真实梯度（非径向）下：无校准应高于密集校准
  const realGrad: ChannelModel = { ...perfect, gradient: { tl: 0.252, tr: 0.201, bl: 0.493, br: 0.428 }, sigmaPsf: 0.5 };
  const none = runScheme({ ...scheme, calibMode: "none" }, realGrad, { cells: 600, seed: 9 });
  const dense = runScheme({ ...scheme, calibMode: "dense" }, realGrad, { cells: 600, seed: 9 });
  check("无校准在真实梯度下错误率>0", none.cellErrorRate > 0, `=${none.cellErrorRate}`);
  check("密集校准显著优于无校准", dense.cellErrorRate < none.cellErrorRate, `dense=${dense.cellErrorRate} none=${none.cellErrorRate}`);
}

console.log("== 喷泉码（LT）==");
{
  const data = new Uint8Array(120);
  const r = rng(3);
  for (let i = 0; i < data.length; i++) data[i] = (r() * 256) | 0;
  const out = fountainRoundTrip(data, 1.4, 7);
  check("LT 喷泉 round-trip bit-exact", sameBytes(out, data));
  // 手动验证：块不足时应报错而非静默
  const enc = new LTEncoder(7);
  enc.reset(data);
  const dec = new LTDecoder(data.length);
  dec.addBlock(enc.nextBlock());
  let threw = false;
  try {
    dec.getSource();
  } catch {
    threw = true;
  }
  check("源未集齐时 getSource 显式报错", threw);
}

console.log("== 标定加载（铁律：缺失显式抛错）==");
{
  let threw = false;
  try {
    loadCalibration("no_such_group");
  } catch {
    threw = true;
  }
  check("未知标定组抛错（不静默）", threw);
}

console.log("== getChannelQuality（三组标定 → 档位）==");
{
  const models = loadAllModels();
  check("web_auto → safe", getChannelQuality(models.web_auto) === "safe", `d_rec≈${estimateDRec(models.web_auto)}`);
  check("web_locked → fast", getChannelQuality(models.web_locked) === "fast", `d_rec≈${estimateDRec(models.web_locked)}`);
  check("native → fast", getChannelQuality(models.native) === "fast", `d_rec≈${estimateDRec(models.native)}`);
  check("fromGroup 一致", getChannelQualityFromGroup("web_auto") === "safe");
}

console.log("== 协议帧头（feedback_capable 预留 + round-trip）==");
{
  const hdr = { version: 1, feedbackCapable: FEEDBACK_CAPABLE, profile: "safe" as const, totalBlocks: 1234 };
  const back = parseFrameHeader(packFrameHeader(hdr));
  check("帧头 pack→parse bit-exact", back.version === hdr.version && back.feedbackCapable === hdr.feedbackCapable && back.profile === hdr.profile && back.totalBlocks === hdr.totalBlocks);
  check("feedback_capable 当前为 false（音频反馈暂缓，仅预留）", FEEDBACK_CAPABLE === false);
  let threw = false;
  try { parseFrameHeader(new Uint8Array([9, 0, 0, 0, 0])); } catch { threw = true; }
  check("版本不匹配显式抛错（不静默）", threw);
}

console.log(`\n结果：通过 ${pass}，失败 ${fail}`);
if (fail > 0) {
  console.error("有测试失败，终止。");
  process.exit(1);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
