#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
合成自检数据生成器（用于验证 analyze_calibration.py 是否真的测对了）

背景：旧项目正是被"看起来在跑、其实测错了"的模块骗了很久。
本脚本用**已知真值**的光学退化模型生成一张仿真照片，再交给 analyze_calibration.py 分析，
最后 --verify 比对"真值 vs 实测"，任何一环静默失效都会暴露成 FAIL。

用法：
    # 1) 生成仿真照片 + 真值 + layout
    python make_synthetic_test.py --outdir selftest
    # 2) 用正式分析脚本分析它
    python analyze_calibration.py --layout selftest/layout.json ^
           --photos selftest/photo.png --outdir selftest/out
    # 3) 比对
    python make_synthetic_test.py --verify selftest/out/calibration.json selftest/truth.json
"""

import argparse
import json
import math
import os
import sys

import numpy as np
import cv2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from analyze_calibration import (srgb_to_linear, linear_to_srgb, apply_h,
                                 imwrite_any, lum_encoded)

PERIODS = [2, 3, 4, 5, 6, 8, 10, 12, 16]
GRAY_STEPS = 32
COLORS = [
    [0, 0, 0], [255, 255, 255], [255, 0, 0], [0, 255, 0], [0, 0, 255],
    [255, 255, 0], [0, 255, 255], [255, 0, 255],
    [32, 32, 32], [64, 64, 64], [128, 128, 128], [192, 192, 192], [224, 224, 224],
    [128, 0, 0], [0, 128, 0], [0, 0, 128],
    [128, 128, 0], [0, 128, 128], [128, 0, 128],
    [255, 128, 0], [0, 255, 128], [128, 0, 255], [128, 255, 0], [0, 128, 255]
]


# --------------------------------------------------------------------------
# 布局（与 chart.html 同 schema，尺寸固定，便于复现）
# --------------------------------------------------------------------------
def build_layout(W=1600, H=1240, dpr=1.0):
    BG, GAP = 128, 24
    RS = 60
    F = 120
    REP_INSET, FID_INSET = 12, 12 + RS + 18
    L = {
        "version": 1, "created": "synthetic",
        "canvas": {"w": W, "h": H, "dpr": dpr, "css_w": W, "css_h": H},
        "background": BG, "ppi": None, "ppi_line": None,
        "fiducials": [], "regions": {"edge": None, "stripes": [], "gray": [],
                                     "color": [], "repeat": []},
        "notes": "synthetic test layout"
    }
    for cid, x, y in [("tl", FID_INSET, FID_INSET),
                      ("tr", W - FID_INSET - F, FID_INSET),
                      ("bl", FID_INSET, H - FID_INSET - F),
                      ("br", W - FID_INSET - F, H - FID_INSET - F)]:
        L["fiducials"].append({"id": cid, "x": x, "y": y, "size": F})

    cx, cy = (W - RS) // 2, (H - RS) // 2
    for cid, x, y in [("center", cx, cy),
                      ("tl", REP_INSET, REP_INSET),
                      ("tr", W - RS - REP_INSET, REP_INSET),
                      ("bl", REP_INSET, H - RS - REP_INSET),
                      ("br", W - RS - REP_INSET, H - RS - REP_INSET),
                      ("top", cx, REP_INSET), ("bottom", cx, H - RS - REP_INSET),
                      ("left", REP_INSET, cy), ("right", W - RS - REP_INSET, cy)]:
        L["regions"]["repeat"].append({"id": cid, "x": x, "y": y, "w": RS, "h": RS, "size": RS})

    x0 = FID_INSET + F + GAP
    y0 = x0
    innerW, innerH = W - 2 * x0, H - 2 * y0

    # 1) 斜边
    ew, eh = min(760, innerW), 340
    L["regions"]["edge"] = {"x": x0, "y": y0, "w": ew, "h": eh, "angle_deg": 5.0}
    cur_y = y0 + eh + GAP

    # 2) 竖条纹（周期沿 X）
    cross = 64
    sx = x0
    for p in PERIODS:
        pw = max(72, p * 8)
        L["regions"]["stripes"].append({"id": f"sv_p{p}", "x": sx, "y": cur_y,
                                        "w": pw, "h": cross, "period": p,
                                        "orientation": "vertical"})
        sx += pw + 16
    cur_y += cross + GAP

    # 3) 横条纹（周期沿 Y）
    sx = x0
    for p in PERIODS:
        ph = max(72, p * 8)
        L["regions"]["stripes"].append({"id": f"sh_p{p}", "x": sx, "y": cur_y,
                                        "w": 64, "h": ph, "period": p,
                                        "orientation": "horizontal"})
        sx += 64 + 16
    cur_y += max(72, 16 * 8) + GAP

    # 4) 灰阶
    step = 32
    for i in range(GRAY_STEPS):
        v = round(i * 255 / (GRAY_STEPS - 1))
        L["regions"]["gray"].append({"id": f"g{i}", "x": x0 + i * (step + 4),
                                     "y": cur_y, "w": step, "h": 100, "value": v})
    cur_y += 100 + GAP

    # 5) 色块
    pw, gap = 84, 10
    cols = max(1, (innerW + gap) // (pw + gap))
    for i, c in enumerate(COLORS):
        cxi, cyi = i % cols, i // cols
        L["regions"]["color"].append({"id": f"c{i}", "name": f"c{i}",
                                      "x": x0 + cxi * (pw + gap),
                                      "y": cur_y + cyi * (pw + gap),
                                      "w": pw, "h": pw, "rgb": c})
    return L


# --------------------------------------------------------------------------
# 渲染屏幕真值图
# --------------------------------------------------------------------------
def render_screen(L):
    W, H = L["canvas"]["w"], L["canvas"]["h"]
    img = np.full((H, W, 3), L["background"], dtype=np.uint8)
    R = L["regions"]

    # 斜边（上白下黑，硬边，无抗锯齿 —— 模拟屏幕像素孔径）
    e = R["edge"]
    midY, midX = e["y"] + e["h"] / 2.0, e["x"] + e["w"] / 2.0
    tan = math.tan(math.radians(e["angle_deg"]))
    for x in range(e["x"], e["x"] + e["w"]):
        yc = int(round(midY + tan * (x - midX)))
        yc = max(e["y"] + 1, min(e["y"] + e["h"] - 1, yc))
        img[e["y"]:yc, x] = 255
        img[yc:e["y"] + e["h"], x] = 0

    # 条纹
    for s in R["stripes"]:
        x, y, w, h, p = s["x"], s["y"], s["w"], s["h"], s["period"]
        if s["orientation"] == "vertical":
            idx = np.arange(w) // p
            row = np.where((idx % 2) == 0, 255, 0).astype(np.uint8)
            img[y:y + h, x:x + w] = np.repeat(row[None, :], h, axis=0)[:, :, None]
        else:
            idy = np.arange(h) // p
            col = np.where((idy % 2) == 0, 255, 0).astype(np.uint8)
            img[y:y + h, x:x + w] = np.repeat(col[:, None], w, axis=1)[:, :, None]

    # 灰阶 / 色块
    for g in R["gray"]:
        img[g["y"]:g["y"] + g["h"], g["x"]:g["x"] + g["w"]] = g["value"]
    for c in R["color"]:
        img[c["y"]:c["y"] + c["h"], c["x"]:c["x"] + c["w"]] = c["rgb"]

    # 定位标记（同心三方块）
    for f in L["fiducials"]:
        cxp = f["x"] + f["size"] / 2.0
        cyp = f["y"] + f["size"] / 2.0
        for size, col in ((f["size"], 0), (f["size"] * 0.62, 255), (f["size"] * 0.28, 0)):
            s2 = int(round(size))
            x0 = int(round(cxp - s2 / 2.0)); y0 = int(round(cyp - s2 / 2.0))
            img[y0:y0 + s2, x0:x0 + s2] = col

    # 重复图案（左上中灰 / 右上2px条纹 / 左下黑 / 右下白）
    for r in R["repeat"]:
        q = r["w"] // 2
        img[r["y"]:r["y"] + q, r["x"]:r["x"] + q] = 128
        idx = np.arange(q) // 2
        row = np.where((idx % 2) == 0, 255, 0).astype(np.uint8)
        img[r["y"]:r["y"] + q, r["x"] + q:r["x"] + q + q] = np.repeat(row[None, :], q, axis=0)[:, :, None]
        img[r["y"] + q:r["y"] + r["h"], r["x"]:r["x"] + q] = 0
        img[r["y"] + q:r["y"] + r["h"], r["x"] + q:r["x"] + r["w"]] = 255
    return img


# --------------------------------------------------------------------------
# 光学退化仿真
# --------------------------------------------------------------------------
def simulate(screen, layout, rho, sigma_cam, K1, K2, gain, M_ccm, sigma_noise,
             surround=180, border_frac=0.15, rot_deg=1.5, persp=0.02, seed=7):
    rng = np.random.default_rng(seed)
    H_s, W_s = screen.shape[:2]
    lin = srgb_to_linear(screen.astype(np.float64) / 255.0).astype(np.float32)

    # 屏幕四角 -> 照片坐标
    sc = np.array([[0, 0], [W_s, 0], [0, H_s], [W_s, H_s]], dtype=np.float64)
    pw = int(round(W_s * rho * (1 + 2 * border_frac)))
    ph = int(round(H_s * rho * (1 + 2 * border_frac)))
    offx, offy = W_s * rho * border_frac, H_s * rho * border_frac

    th = math.radians(rot_deg)
    rot = np.array([[math.cos(th), -math.sin(th)], [math.sin(th), math.cos(th)]])
    def map_pt(p):
        q = np.array([p[0] * rho - W_s * rho / 2.0, p[1] * rho - H_s * rho / 2.0])
        q = rot @ q
        return [q[0] + pw / 2.0, q[1] + ph / 2.0]
    pc = np.array([map_pt(p) for p in sc], dtype=np.float64)
    # 轻微透视扰动（模拟非正对拍摄）
    pert = np.array([[0, 0], [persp * pw, persp * ph * 0.4],
                     [-persp * pw * 0.3, persp * ph], [0, -persp * ph * 0.5]])
    pc = pc + pert

    H_s2p = cv2.getPerspectiveTransform(sc.astype(np.float32), pc.astype(np.float32))
    H_p2s = np.linalg.inv(H_s2p)  # 照片->屏幕（采样方向，真值/调试用）

    bval = float(srgb_to_linear(np.array([surround / 255.0]))[0])
    # 方向铁律：warpPerspective 默认把 M 视作 src->dst 映射（内部自动求逆采样）。
    # src 是屏幕图，因此必须传 H_s2p（屏幕->照片）。
    # 若传 H_p2s 会把照片变成"原图左上约 1/10 面积"的放大图。
    out = cv2.warpPerspective(lin, H_s2p.astype(np.float32), (pw, ph),
                              flags=cv2.INTER_LINEAR,
                              borderMode=cv2.BORDER_CONSTANT,
                              borderValue=(bval, bval, bval))

    # 摄像头 PSF
    out = cv2.GaussianBlur(out, (0, 0), sigmaX=sigma_cam, sigmaY=sigma_cam)

    # 暗角（以照片中心为原点）
    yy, xx = np.mgrid[0:ph, 0:pw]
    rcx, rcy = pw / 2.0, ph / 2.0
    rr = np.sqrt((xx - rcx) ** 2 + (yy - rcy) ** 2) / math.hypot(rcx, rcy)
    vig = 1.0 / (1.0 + K1 * rr ** 2 + K2 * rr ** 4)
    out = out * vig[:, :, None].astype(np.float32)

    # 曝光 + 色彩串扰（线性域）
    out = out * gain
    out = out @ np.asarray(M_ccm, dtype=np.float32).T

    # 编码 + 噪声
    enc = np.clip(linear_to_srgb(np.clip(out, 0, 1)) * 255.0, 0, 255)
    if sigma_noise > 0:
        enc = enc + rng.normal(0, sigma_noise, enc.shape)
    photo = np.clip(np.round(enc), 0, 255).astype(np.uint8)

    # ---- 真值 ----
    # ρ：单应矩阵在画布中心的局部尺度（与分析脚本同法）
    h = 2.0
    p0 = apply_h(H_s2p, [[W_s / 2, H_s / 2]])[0]
    px = apply_h(H_s2p, [[W_s / 2 + h, H_s / 2]])[0]
    py = apply_h(H_s2p, [[W_s / 2, H_s / 2 + h]])[0]
    J = np.array([[(px[0] - p0[0]) / h, (py[0] - p0[0]) / h],
                  [(px[1] - p0[1]) / h, (py[1] - p0[1]) / h]])
    sv = np.linalg.svd(J, compute_uv=False)
    rho_true = float(np.sqrt(sv[0] * sv[1]))

    # 系统 σ（屏幕像素）：屏幕孔径(box 1px) ⊛ 光电积分(box 1/ρ px) ⊛ 摄像头高斯
    var = 1.0 / 12.0 + (1.0 / rho_true) ** 2 / 12.0 + (sigma_cam / rho_true) ** 2
    sigma_sys_true = float(math.sqrt(var))

    # 暗角真值：与分析脚本同口径——r=1 定义在「图表四角重复图案中心」
    rep_c = [[r["x"] + r["w"] / 2.0, r["y"] + r["h"] / 2.0]
             for r in layout["regions"]["repeat"] if r["id"] in ("tl", "tr", "bl", "br")]
    rep_photo = apply_h(H_s2p, rep_c)
    k = float(np.mean(np.linalg.norm(rep_photo - np.array([pw / 2.0, ph / 2.0]), axis=1))
              / math.hypot(pw / 2.0, ph / 2.0))
    k1_analysis = K1 * k ** 2   # 分析口径：vig = 1/(1+k1*r^2+k2*r^4)，r=1 在四角重复图案
    k2_analysis = K2 * k ** 4
    corner_loss_true = float((1.0 - 1.0 / (1.0 + k1_analysis + k2_analysis)) * 100.0)

    # 噪声：编码域 i.i.d. 高斯 σ_n -> σ_Y
    sigma_Y_true = float(math.sqrt(0.2126 ** 2 + 0.7152 ** 2 + 0.0722 ** 2) * sigma_noise)

    truth = {
        "rho": rho_true,
        "sigma_sys_screen_px": sigma_sys_true,
        "sigma_cam_photo_px": sigma_cam,
        "sigma_components": {"screen_aperture_var": 1 / 12.0,
                             "photo_integration_var": (1 / rho_true) ** 2 / 12.0,
                             "camera_gauss_var": (sigma_cam / rho_true) ** 2},
        "gamma": 1.0,
        "gain_effective": float(gain ** (1 / 2.4)),
        "ccm_linear": M_ccm,
        "k1_analysis_units": k1_analysis,
        "k2_analysis_units": k2_analysis,
        "corner_loss_percent": corner_loss_true,
        "sigma_Y_8bit": sigma_Y_true,
        "sigma_noise_per_channel": sigma_noise,
        "photo_size": [pw, ph]
    }
    return photo, truth


# --------------------------------------------------------------------------
# 验证
# --------------------------------------------------------------------------
def verify(cal_path, truth_path, tol=None):
    with open(cal_path, "r", encoding="utf-8") as f:
        cal = json.load(f)
    with open(truth_path, "r", encoding="utf-8") as f:
        T = json.load(f)
    tol = tol or {}
    rows, npass, nfail = [], 0, 0

    def chk(name, meas, true, rel=None, absd=None, unit=""):
        nonlocal npass, nfail
        ok = False
        if meas is None:
            rows.append([name, "未能确认", f"{true:.4g}{unit}", "-", "❌ FAIL"])
            nfail += 1
            return
        if rel is not None and true != 0:
            err = abs(meas - true) / abs(true)
            ok = err <= rel
            rows.append([name, f"{meas:.4g}{unit}", f"{true:.4g}{unit}",
                         f"{err*100:.1f}% (限{rel*100:.0f}%)", "✅ PASS" if ok else "❌ FAIL"])
        elif absd is not None:
            err = abs(meas - true)
            ok = err <= absd
            rows.append([name, f"{meas:.4g}{unit}", f"{true:.4g}{unit}",
                         f"{err:.4g} (限{absd:g})", "✅ PASS" if ok else "❌ FAIL"])
        npass += ok
        nfail += (not ok)

    g = cal.get("geometry", {}).get("rho_camera_px_per_screen_px", {}).get("value")
    chk("ρ (摄像头px/屏幕px)", g, T["rho"], rel=tol.get("rho", 0.03))

    p = cal.get("psf", {})
    chk("σ_PSF 二阶矩(屏幕px)", p.get("sigma_moment_screen_px", {}).get("value"),
        T["sigma_sys_screen_px"], rel=tol.get("sigma", 0.30))
    chk("σ_PSF 高斯拟合(屏幕px)", p.get("sigma_screen_px", {}).get("value"),
        T["sigma_sys_screen_px"], rel=tol.get("sigma_fit", 0.40))

    chk("γ", cal.get("gamma", {}).get("gamma", {}).get("value"), T["gamma"],
        absd=tol.get("gamma", 0.12))
    chk("角落暗角衰减 %", cal.get("vignetting", {}).get("corner_loss_percent", {}).get("value"),
        T["corner_loss_percent"], absd=tol.get("corner", 4.0))
    chk("σ_Y 噪声(8bit)", cal.get("noise", {}).get("sigma_Y_8bit", {}).get("value"),
        T["sigma_Y_8bit"], rel=tol.get("noise", 0.25))

    # T_c 与 MTF 曲线自洽性（无独立真值，做一致性检查）
    tc = cal.get("contrast", {}).get("t_c_screen_px", {}).get("value")
    m16 = p.get("mtf_at_period_screen_px", {}).get("16", {}).get("value")
    mtc = None
    if tc and tc > 0:
        # 在已测周期点之间插值 MTF(T_c)
        per = [2, 3, 4, 6, 8, 12, 16]
        xs, ys = [], []
        for q in per:
            v = p.get("mtf_at_period_screen_px", {}).get(str(q), {}).get("value")
            if v is not None:
                xs.append(q); ys.append(v)
        if len(xs) >= 2 and xs[0] <= tc <= xs[-1]:
            mtc = float(np.interp(tc, xs, ys))
    consistent = (tc is not None and m16 and mtc is not None and
                  abs(mtc - 0.2 * m16) < 0.15)
    rows.append(["T_c 与 MTF 曲线自洽性",
                 f"MTF(T_c={tc:.2f})={mtc:.3f}" if mtc is not None else "未能确认",
                 f"≈0.2×MTF(16)={0.2*m16:.3f}" if m16 else "-",
                 "-" if mtc is None else f"{abs(mtc-0.2*m16):.3f} (限0.15)",
                 "✅ PASS" if consistent else "❌ FAIL"])
    npass += bool(consistent); nfail += (not consistent)

    d = cal.get("design", {})
    has_design = d.get("d_min_screen_px") is not None and d.get("d_recommended_screen_px") is not None
    rows.append(["设计结论 d_min/d_rec 已产出",
                 f"{d.get('d_min_screen_px')}/{d.get('d_recommended_screen_px')}" if has_design else "未能确认",
                 "非 None", "-", "✅ PASS" if has_design else "❌ FAIL"])
    npass += bool(has_design); nfail += (not has_design)

    # CCM 比例一致性：M_fit 应 ≈ s · M_true（s 为平均曝光×暗角标量）
    Mf = cal.get("ccm", {}).get("M_linear")
    if Mf and T.get("ccm_linear"):
        Mf = np.array(Mf, dtype=np.float64); Mt = np.array(T["ccm_linear"], dtype=np.float64)
        try:
            ratio = Mf @ np.linalg.inv(Mt)
            s = float(np.trace(ratio) / 3.0)
            dev = float(np.max(np.abs(ratio - s * np.eye(3))))
            ok = dev < tol.get("ccm", 0.06)
            rows.append(["CCM ≈ s·M_true (线性域)", f"s={s:.3f}", "s 为标量",
                         f"最大偏差 {dev:.4f} (限{tol.get('ccm',0.06)})",
                         "✅ PASS" if ok else "❌ FAIL"])
            npass += ok; nfail += (not ok)
        except Exception as e:
            rows.append(["CCM 比例一致性", "未能确认", "-", str(e), "❌ FAIL"]); nfail += 1

    import io
    buf = io.StringIO()
    buf.write("| 检查项 | 实测 | 真值/期望 | 误差 | 结果 |\n|---|---|---|---|---|\n")
    for r in rows:
        buf.write("| " + " | ".join(str(x) for x in r) + " |\n")
    print("\n===== 自检结果：实测 vs 真值 =====")
    print(buf.getvalue())
    print(f"通过 {npass} 项，失败 {nfail} 项")
    if nfail == 0:
        print("🎉 分析管线与真值一致，可以用于真实照片标定。\n")
    else:
        print("⚠ 存在不一致项：请先修复分析脚本或检查仿真参数，再用于真实照片。\n")
    return 0 if nfail == 0 else 1


# --------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="合成自检数据生成 / 验证")
    ap.add_argument("--outdir", default="selftest")
    ap.add_argument("--verify", nargs=2, metavar=("CALIBRATION_JSON", "TRUTH_JSON"))
    ap.add_argument("--rho", type=float, default=0.60)
    ap.add_argument("--sigma-cam", type=float, default=0.80, help="摄像头高斯 σ（照片像素）")
    ap.add_argument("--k1", type=float, default=0.35)
    ap.add_argument("--k2", type=float, default=0.15)
    ap.add_argument("--gain", type=float, default=0.85)
    ap.add_argument("--noise", type=float, default=1.5)
    ap.add_argument("--width", type=int, default=1600)
    ap.add_argument("--height", type=int, default=1240)
    args = ap.parse_args()

    if args.verify:
        return verify(args.verify[0], args.verify[1])

    os.makedirs(args.outdir, exist_ok=True)
    L = build_layout(args.width, args.height)
    screen = render_screen(L)
    M_ccm = [[0.95, 0.04, 0.01], [0.03, 0.94, 0.03], [0.01, 0.05, 0.94]]
    photo, truth = simulate(screen, L, args.rho, args.sigma_cam, args.k1, args.k2,
                            args.gain, M_ccm, args.noise)

    with open(os.path.join(args.outdir, "layout.json"), "w", encoding="utf-8") as f:
        json.dump(L, f, ensure_ascii=False, indent=2)
    with open(os.path.join(args.outdir, "truth.json"), "w", encoding="utf-8") as f:
        json.dump(truth, f, ensure_ascii=False, indent=2)
    imwrite_any(os.path.join(args.outdir, "photo.png"), photo)
    imwrite_any(os.path.join(args.outdir, "screen_ground_truth.png"), screen)

    print(f"[生成] {args.outdir}/layout.json")
    print(f"[生成] {args.outdir}/photo.png  ({photo.shape[1]}×{photo.shape[0]})")
    print(f"[生成] {args.outdir}/truth.json")
    print("\n真值：")
    for k, v in truth.items():
        if not isinstance(v, dict):
            print(f"  {k}: {v}")
    print("\n下一步：")
    print(f"  python analyze_calibration.py --layout {args.outdir}/layout.json "
          f"--photos {args.outdir}/photo.png --outdir {args.outdir}/out")
    print(f"  python make_synthetic_test.py --verify {args.outdir}/out/calibration.json "
          f"{args.outdir}/truth.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
