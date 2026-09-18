// 读取 sweep_full.csv → 输出 TOP30 汇总表、A 组 BER vs sub、B 组 BER vs colCellPx、分信道胜负与 d_rec 对比
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "../../../calibration/out_sweep_v12");
const csv = readFileSync(resolve(OUT, "sweep_full.csv"), "utf8").trim().split("\n");
const head = csv[0].split(",");
type R = Record<string, string>;
const rows: R[] = csv.slice(1).map((l) => {
  const v = l.split(",");
  const o: R = {};
  head.forEach((h, i) => (o[h] = v[i] ?? ""));
  return o;
});
const num = (r: R, k: string) => parseFloat(r[k] || "0");
const out: string[] = [];
const say = (s = "") => {
  out.push(s);
  console.log(s);
};

// ---------- 1. TOP 30（满足硬约束，按净吞吐降序）----------
const meets = rows.filter((r) => r.meets === "true");
const top = [...meets].sort((a, b) => num(b, "netThroughput_bit_per_screenpx2") - num(a, "netThroughput_bit_per_screenpx2")).slice(0, 30);
say("## TOP 30 · 满足硬约束（整文件解码成功率 ≥ 99.9%）按净吞吐降序\n");
say("净吞吐单位：**bit / 屏幕像素²**（已扣校准开销，按 1920×1080 实际网格重算）；有效速率按 30 fps 计。");
say();
say("| # | 族 | 方案族参数（v1.2 命名） | 信道 | σ_PSF(屏幕px) | 格错误率 | 比特错误率 | 解码成功率 | 校准开销 | **净吞吐 bit/屏幕px²** | 有效速率 MB/s |");
say("|---|---|---|---|---|---|---|---|---|---|---|");
top.forEach((r, i) => {
  let p: string;
  if (r.family === "符号型") {
    p = `symRes=${r.symRes} sub=${r.sub_screen_px} → symCellPx=${r.symCellPx_screen_px} 屏幕px；${r.colorFmt}`;
  } else if (r.group === "C") {
    p = `colCellPx=${r.colCellPx_screen_px} 屏幕px；${r.colorFmt}；校准格边长=${r.pilotSide_screen_px} 屏幕px`;
  } else if (r.group === "D") {
    p = `colCellPx=${r.colCellPx_screen_px} 屏幕px；${r.colorFmt}；多帧×${r.frames}`;
  } else {
    p = `colCellPx=${r.colCellPx_screen_px} 屏幕px；${r.colorFmt}；校准=${r.calibMode}；窗口=${r.winFrac}`;
  }
  say(
    `| ${i + 1} | ${r.family} | ${p} | ${r.channel} | ${r.sigma_psf_screen_px} | ${num(r, "cellErrRate").toFixed(4)} | ${num(r, "bitErrRate").toFixed(4)} | ${num(r, "fileSuccess").toFixed(4)} | ${(num(r, "calibOverhead") * 100).toFixed(2)}% | **${num(r, "netThroughput_bit_per_screenpx2").toFixed(5)}** | ${num(r, "effectiveRate_MBps").toFixed(2)} |`
  );
});
say();

// ---------- 2. A 组：BER vs sub ----------
say("## A 组 · 符号型：格错误率 / 比特错误率 vs sub（扫描 sub，四角校准）\n");
for (const ch of ["native", "web_locked", "web_auto"]) {
  const d = rows.find((r) => r.channel === ch)!;
  say(`### ${ch}（σ_PSF = ${d.sigma_psf_screen_px} 屏幕像素；d_rec = ${d.d_rec_screen_px} 屏幕像素）\n`);
  say("| sub 屏幕px | symCellPx(8×8) 屏幕px | 格错误率 (4,0)bit | 格错误率 (4,2)bit | 格错误率(4×4, 2bit) | 成功率(4,2)bit |");
  say("|---|---|---|---|---|---|");
  for (const sub of [1, 1.5, 2, 3, 5, 8, 13]) {
    const g = (res: string, cb: number) => rows.find((r) => r.group === "A" && r.channel === ch && r.sub_screen_px === String(sub) && r.symRes === res && r.colorBits === String(cb))!;
    const a = g("8×8", 0);
    const b = g("8×8", 2);
    const c = g("4×4", 2);
    say(`| ${sub} | ${8 * sub} | ${num(a, "cellErrRate").toFixed(4)} | ${num(b, "cellErrRate").toFixed(4)} | ${num(c, "cellErrRate").toFixed(4)} | ${num(b, "fileSuccess").toFixed(4)} |`);
  }
  say();
}

// ---------- 3. B 组：BER vs colCellPx ----------
say("## B 组 · 纯颜色型：格错误率 vs colCellPx（每格取该 colCellPx 下的最优配置）\n");
for (const ch of ["native", "web_locked", "web_auto"]) {
  const d = rows.find((r) => r.channel === ch)!;
  say(`### ${ch}（σ_PSF = ${d.sigma_psf_screen_px} 屏幕像素；d_rec = ${d.d_rec_screen_px} 屏幕像素）\n`);
  say("| colCellPx 屏幕px | 最优配置（colorBits / 校准 / 窗口） | 格错误率 | 比特错误率 | 解码成功率 | 满足硬约束 | 净吞吐 bit/屏幕px² |");
  say("|---|---|---|---|---|---|---|");
  for (const cp of [3, 5, 8, 13]) {
    const cand = rows.filter((r) => r.group === "B" && r.channel === ch && r.colCellPx_screen_px === String(cp));
    const best = [...cand].sort((a, b) => num(b, "netThroughput_bit_per_screenpx2") - num(a, "netThroughput_bit_per_screenpx2"))[0];
    const bestOk = cand.filter((r) => r.meets === "true").sort((a, b) => num(b, "netThroughput_bit_per_screenpx2") - num(a, "netThroughput_bit_per_screenpx2"))[0];
    const r = bestOk ?? best;
    say(
      `| ${cp} | ${r.colorFmt} / ${r.calibMode} / 窗口 ${r.winFrac} | ${num(r, "cellErrRate").toFixed(4)} | ${num(r, "bitErrRate").toFixed(4)} | ${num(r, "fileSuccess").toFixed(4)} | ${r.meets === "true" ? "✅" : "❌"} | ${num(r, "netThroughput_bit_per_screenpx2").toFixed(5)} |`
    );
  }
  say();
}

// ---------- 4. 分信道 · 方案族胜负 ----------
say("## 分信道 · 方案族胜负（各自满足硬约束的最优者）\n");
say("| 信道 | 族 | 最优配置 | 格错误率 | 解码成功率 | **净吞吐 bit/屏幕px²** | 有效速率 MB/s |");
say("|---|---|---|---|---|---|---|");
for (const ch of ["native", "web_locked", "web_auto"]) {
  for (const fam of ["符号型", "纯颜色型"]) {
    const cand = meets.filter((r) => r.channel === ch && r.family === fam);
    if (cand.length === 0) {
      say(`| ${ch} | ${fam} | — 无满足硬约束的组合 — | | | | |`);
      continue;
    }
    const b = [...cand].sort((a, x) => num(x, "netThroughput_bit_per_screenpx2") - num(a, "netThroughput_bit_per_screenpx2"))[0];
    let p: string;
    if (fam === "符号型") p = `symRes=${b.symRes} sub=${b.sub_screen_px} 屏幕px（symCellPx=${b.symCellPx_screen_px}）${b.colorFmt}`;
    else p = `colCellPx=${b.colCellPx_screen_px} 屏幕px ${b.colorFmt} ${b.calibMode} 窗口${b.winFrac}`;
    say(`| ${ch} | ${fam} | ${p} | ${num(b, "cellErrRate").toFixed(4)} | ${num(b, "fileSuccess").toFixed(4)} | **${num(b, "netThroughput_bit_per_screenpx2").toFixed(5)}** | ${num(b, "effectiveRate_MBps").toFixed(2)} |`);
  }
}
say();

// ---------- 5. 最优点 vs d_rec ----------
say("## 最优点 vs d_rec 关系\n");
say("| 信道 | d_rec=ceil(4.5σ) 屏幕px | 最优纯颜色型 colCellPx 屏幕px | colCellPx / d_rec | 最优符号型 sub 屏幕px | sub / d_rec |");
say("|---|---|---|---|---|---|");
for (const ch of ["native", "web_locked", "web_auto"]) {
  const d = rows.find((r) => r.channel === ch)!;
  const dr = num(d, "d_rec_screen_px");
  const bc = meets.filter((r) => r.channel === ch && r.family === "纯颜色型").sort((a, x) => num(x, "netThroughput_bit_per_screenpx2") - num(a, "netThroughput_bit_per_screenpx2"))[0];
  const bs = meets.filter((r) => r.channel === ch && r.family === "符号型").sort((a, x) => num(x, "netThroughput_bit_per_screenpx2") - num(a, "netThroughput_bit_per_screenpx2"))[0];
  const bcPx = bc ? num(bc, "colCellPx_screen_px") : NaN;
  const bsSub = bs ? num(bs, "sub_screen_px") : NaN;
  say(`| ${ch} | ${dr} | ${isNaN(bcPx) ? "—" : bcPx} | ${isNaN(bcPx) ? "—" : (bcPx / dr).toFixed(2)}× | ${isNaN(bsSub) ? "—" : bsSub} | ${isNaN(bsSub) ? "—" : (bsSub / dr).toFixed(2)}× |`);
}
say();

// ---------- 6. C/D 组增益 ----------
say("## C 组（校准格尺寸）与 D 组（多帧时间平均）增益\n");
for (const ch of ["native", "web_locked", "web_auto"]) {
  const base = meets.filter((r) => r.group === "B" && r.channel === ch).sort((a, x) => num(x, "netThroughput_bit_per_screenpx2") - num(a, "netThroughput_bit_per_screenpx2"))[0];
  if (!base) continue;
  say(`**${ch}** 基线：colCellPx=${base.colCellPx_screen_px} 屏幕px ${base.colorFmt} 校准=${base.calibMode} 窗口=${base.winFrac} → 格错误率 ${num(base, "cellErrRate").toFixed(4)}，净吞吐 ${num(base, "netThroughput_bit_per_screenpx2").toFixed(5)}`);
  const cs = rows.filter((r) => r.group === "C" && r.channel === ch);
  if (cs.length) {
    say("| 校准格边长 屏幕px | 格错误率 | 解码成功率 | 满足 |");
    say("|---|---|---|---|");
    for (const r of cs) say(`| ${r.pilotSide_screen_px} | ${num(r, "cellErrRate").toFixed(4)} | ${num(r, "fileSuccess").toFixed(4)} | ${r.meets === "true" ? "✅" : "❌"} |`);
  }
  const ds = rows.filter((r) => r.group === "D" && r.channel === ch);
  if (ds.length) {
    say("| 平均帧数 N | 格错误率 | 解码成功率 | 满足 |");
    say("|---|---|---|---|");
    for (const r of ds) say(`| ${r.frames} | ${num(r, "cellErrRate").toFixed(4)} | ${num(r, "fileSuccess").toFixed(4)} | ${r.meets === "true" ? "✅" : "❌"} |`);
  }
  say();
}

writeFileSync(resolve(OUT, "report_tables.md"), out.join("\n"));
console.log(`\n[完成] 表格 → ${OUT}/report_tables.md`);
