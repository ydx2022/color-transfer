#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""摩尔纹模型校准：用真实标定照片的 2D FFT 反推仿真器幅度与 OLPF σ。

思路
1. 在每张标定照片上切出"均匀块"（纯色/校准区域），对亮度做 2D FFT；
2. 在 3..30 px 周期带内取主峰 → 实测摩尔纹幅度 A_photo（8bit）与周期；
3. 用与 channelSim.ts 完全相同的摩尔纹公式生成同尺寸合成块（幅度取理想值
   a_ref = BASE_AMP*intensity，无衰减），用同一套 FFT 流程测出 A_synth_ref；
   因测量流程完全相同，窗增益/亮度加权等修正项全部相消，
   故真实世界相对"理想栅格叠加"的衰减 H = A_photo / A_synth_ref；
4. 由高斯 OLPF 传递函数 H = exp(-2*pi^2 * f^2 * sigma^2) 反解 sigma
   （f 取仿真帧的格频率，与 channelSim.olpfAttenuation 一致）。

输出 JSON 供 TS 侧读取；频谱对比图由 TS 侧渲染（与其余图表同一风格）。
运行：python calibration/calibrate_moire.py
"""
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.fft import fft2, fftshift, fftfreq

CAL = Path(__file__).resolve().parent
OUT = CAL / "out_moire_calibration"
OUT.mkdir(parents=True, exist_ok=True)

BASE_AMP = 0.04  # 与 channelSim.ts 一致：a = BASE_AMP * intensity * H(sigma)
FRAME_COLS, FRAME_ROWS = 40, 50  # 与 runScheme(cells=2000) 的仿真帧一致
BLOCK = 128
PERIOD_MIN, PERIOD_MAX = 3.0, 30.0
CH_PHASE = [0.0, 2 * math.pi / 3, 4 * math.pi / 3]  # 与 channelSim 一致（Bayer 子采样错位）

TIERS = {
    "native": dict(photo="photos/20260904/full_1.jpg", intensity=1, angle_deg=0.6, cycles=3),
    "web_locked": dict(photo="photos/web_locked/web_1788684222690_01.png", intensity=3, angle_deg=1.2, cycles=3),
    "web_auto": dict(photo="photos/web/web_1788539984957_01.png", intensity=5, angle_deg=2.5, cycles=3),
}


def hann2d(h, w):
    return np.outer(np.hanning(h), np.hanning(w))


def freq_grid(h, w):
    fy = fftshift(fftfreq(h))
    fx = fftshift(fftfreq(w))
    FX, FY = np.meshgrid(fx, fy)
    return FX, FY


def measure(block):
    """返回 (幅度 8bit, 主峰周期 px, 峰值/噪声底)"""
    h, w = block.shape
    win = hann2d(h, w)
    x = (block - block.mean()) * win
    mag = np.abs(fftshift(fft2(x)))
    FX, FY = freq_grid(h, w)
    P = 1.0 / (np.sqrt(FX * FX + FY * FY) + 1e-12)
    band = (P >= PERIOD_MIN) & (P <= PERIOD_MAX)
    idx = int(np.argmax(np.where(band, mag, -1.0)))
    peak = float(mag.flat[idx])
    floor = float(np.median(mag[band]))
    amp = 2.0 * peak / float(win.sum())  # 实正弦幅度反演（含窗增益）
    return amp, float(P.flat[idx]), (peak / floor if floor > 0 else 0.0)


def radial(block, nbins=24):
    """按周期对数分箱的径向平均幅度谱，用于「仿真 vs 实测」对比图"""
    h, w = block.shape
    win = hann2d(h, w)
    mag = np.abs(fftshift(fft2((block - block.mean()) * win)))
    FX, FY = freq_grid(h, w)
    P = 1.0 / (np.sqrt(FX * FX + FY * FY) + 1e-12)
    hi = min(PERIOD_MAX, h / 2.0)
    edges = np.geomspace(PERIOD_MIN, hi, nbins + 1)
    ys = []
    for i in range(nbins):
        m = (P >= edges[i]) & (P < edges[i + 1])
        ys.append(float(mag[m].mean()) if m.any() else 0.0)
    centers = np.sqrt(edges[:-1] * edges[1:])
    return [float(c) for c in centers], ys


def synth_block(shape, a_ref, cycles_per_block, angle_deg):
    """与 channelSim.moireContamination 同公式的合成块（返回亮度）"""
    h, w = shape
    th = math.radians(angle_deg)
    v, u = np.mgrid[0:h, 0:w]
    u = u / w
    v = v / h
    ph = 2 * math.pi * cycles_per_block * (u * math.cos(th) + v * math.sin(th))
    chans = [128.0 + 255.0 * a_ref * np.sin(ph + p) for p in CH_PHASE]
    return 0.299 * chans[0] + 0.587 * chans[1] + 0.114 * chans[2]


def load_y(path):
    im = Image.open(path).convert("RGB")
    a = np.asarray(im, dtype=np.float32)
    return (0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]).astype(np.float32)


def sigma_from_H(H, cycles, angle_deg):
    """由 H=exp(-2*pi^2*f^2*sigma^2) 反解 sigma（f = 仿真帧的格频率）"""
    th = math.radians(angle_deg)
    kx = cycles * math.cos(th) / FRAME_COLS
    ky = cycles * math.sin(th) / FRAME_ROWS
    f2 = kx * kx + ky * ky
    H = min(max(H, 1e-6), 1.0)
    return math.sqrt(-math.log(H) / (2 * math.pi ** 2 * f2))


def main():
    result = {
        "schema_version": 1,
        "source": "calibration/calibrate_moire.py",
        "note": "由真实照片 2D FFT 反推的摩尔纹幅度衰减 H 与 OLPF sigma（单位：格）",
        "base_amp": BASE_AMP,
        "frame_cols": FRAME_COLS,
        "frame_rows": FRAME_ROWS,
        "block_px": BLOCK,
        "period_band_px": [PERIOD_MIN, PERIOD_MAX],
        "tiers": {},
    }

    for tier, cfg in TIERS.items():
        path = CAL / cfg["photo"]
        Y = load_y(path)
        Hh, Ww = Y.shape
        blocks, coords, means, stds = [], [], [], []
        for y in range(0, Hh - BLOCK + 1, BLOCK):
            for x in range(0, Ww - BLOCK + 1, BLOCK):
                b = Y[y:y + BLOCK, x:x + BLOCK]
                blocks.append(b)
                coords.append((x, y))
                means.append(float(b.mean()))
                stds.append(float(b.std()))
        means = np.array(means)
        stds = np.array(stds)
        # 均匀块（内容变化小 → 残留周期即摩尔纹/噪声）+ 偏亮块（画面主体=屏幕）
        uni = stds <= np.percentile(stds, 40)
        bri = means >= np.percentile(means, 40)
        sel = np.where(uni & bri)[0]
        if len(sel) == 0:
            sel = np.argsort(stds)[:8]

        amps, periods, proms = [], [], []
        for i in sel:
            a, p, pr = measure(blocks[i])
            amps.append(a)
            periods.append(p)
            proms.append(pr)
        A_photo = float(np.median(amps))
        period = float(np.median(periods))
        prom = float(np.median(proms))

        a_ref = BASE_AMP * cfg["intensity"]
        cycles_syn = BLOCK / max(period, PERIOD_MIN)  # 对齐实测周期，便于对比图对齐
        A_ref, _, _ = measure(synth_block((BLOCK, BLOCK), a_ref, cycles_syn, cfg["angle_deg"]))
        ratio = A_photo / A_ref if A_ref > 0 else 0.0
        H_cal = min(ratio, 1.0)
        sigma = sigma_from_H(H_cal, cfg["cycles"], cfg["angle_deg"]) if H_cal < 1.0 else 0.0

        rep_i = int(sel[int(np.argmin(np.abs(np.array(amps) - A_photo)))])
        pm, ym = radial(blocks[rep_i])
        _, yo = radial(synth_block((BLOCK, BLOCK), a_ref, cycles_syn, cfg["angle_deg"]))
        _, yn = radial(synth_block((BLOCK, BLOCK), a_ref * H_cal, cycles_syn, cfg["angle_deg"]))

        result["tiers"][tier] = {
            "photo": cfg["photo"],
            "image_size": [Ww, Hh],
            "n_blocks_selected": int(len(sel)),
            "selected_block_coords": [coords[i] for i in sel[:16]],
            "moire_amp_8bit": A_photo,
            "moire_period_px": period,
            "peak_over_floor": prom,
            "ideal_amp_8bit": A_ref,
            "ideal_amp_norm": a_ref,
            "attenuation_H": H_cal,
            "calibrated_sigma_cells": sigma,
            "calibrated_amp_norm": a_ref * H_cal,
            "radial": {"period_px": pm, "measured": ym, "sim_old": yo, "sim_new": yn},
        }
        print(
            f"{tier:11s} blocks={len(sel):3d} A_photo={A_photo:7.3f} (周期 {period:5.2f}px, 峰/底 {prom:5.2f}) "
            f"理想={A_ref:7.3f} -> H={H_cal:.4f} sigma={sigma:.4f} 格"
        )

    sig = [t["calibrated_sigma_cells"] for t in result["tiers"].values()]
    result["recommended_default_sigma_cells"] = float(np.median(sig))
    print(f"\n推荐全局默认 sigma = {result['recommended_default_sigma_cells']:.4f} 格（各档中位数）")

    out = OUT / "moire_calibration.json"
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"已写出：{out}")


if __name__ == "__main__":
    main()
