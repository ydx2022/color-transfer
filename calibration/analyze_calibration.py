#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
光学信道标定分析脚本 (ColorTransfer)

用法：
    python analyze_calibration.py --layout layout.json --photos p1.jpg p2.jpg p3.jpg
                                  --outdir output [--supersample 4]

铁律对应实现：
  1. 先做透视校正（四角定位标记 -> getPerspectiveTransform + warpPerspective），再测量
  2. 所有长度统一换算到「屏幕像素」为单位（内部用 K 倍超采样，输出时 /K）
  3. 无法确认的测量一律输出「未能确认」，不编造数值
  4. 每个测量步骤都输出带检测框的 PNG（debug/），便于肉眼核对"脚本量的地方对不对"
  5. 报告末尾给出设计结论（数据单元最小尺寸 / 像素级编码是否可行）
"""

import argparse
import json
import math
import os
import sys

import numpy as np
import cv2

NA = "未能确认"          # 未能确认（铁律 3）
NA_KEY = None            # JSON 中的"未确认"用 null


# --------------------------------------------------------------------------
# 基础工具
# --------------------------------------------------------------------------
def imread_any(path):
    """支持中文路径读图，返回 RGB uint8。"""
    data = np.fromfile(path, dtype=np.uint8)
    img = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if img is None:
        raise IOError(f"无法读取图片: {path}")
    return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)


def imwrite_any(path, rgb):
    """支持中文路径写图，输入 RGB uint8。"""
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    ext = os.path.splitext(path)[1] or ".png"
    ok, buf = cv2.imencode(ext, bgr)
    if not ok:
        raise IOError(f"无法写出图片: {path}")
    buf.tofile(path)


def srgb_to_linear(x):
    """sRGB 电光转换函数 EOTF，输入 0..1，返回线性光 0..1。"""
    x = np.asarray(x, dtype=np.float64)
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(x):
    """线性光 -> sRGB 编码，输入 0..1。"""
    x = np.asarray(x, dtype=np.float64)
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * (x ** (1 / 2.4)) - 0.055)


def lum_linear(rgb):
    """线性光下的 Rec.709 亮度，返回 0..1 浮点。"""
    lin = srgb_to_linear(np.asarray(rgb, dtype=np.float64) / 255.0)
    return 0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2]


def lum_encoded(rgb):
    """编码域亮度（不做 EOTF），0..255。"""
    a = np.asarray(rgb, dtype=np.float64)
    return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]


def fmt(v, nd=3, suffix=""):
    return NA if v is None else f"{v:.{nd}f}{suffix}"


def mean_std(vals):
    vals = [v for v in vals if v is not None]
    if not vals:
        return None, None
    if len(vals) == 1:
        return float(vals[0]), 0.0
    return float(np.mean(vals)), float(np.std(vals, ddof=1))


def fit_view(rgb, max_dim=1600):
    """缩放到便于查看的尺寸（仅用于 debug 可视化，不参与测量）。"""
    h, w = rgb.shape[:2]
    s = max_dim / max(h, w)
    if s >= 1.0:
        return rgb
    return cv2.resize(rgb, (int(round(w * s)), int(round(h * s))), interpolation=cv2.INTER_AREA)


def draw_rects(rgb, rects, color=(255, 64, 64), thick=2, labels=None):
    """rects: [(x,y,w,h)]，labels: 可选同长字符串列表。画在 RGB 图上。"""
    out = rgb.copy()
    for i, (x, y, w, h) in enumerate(rects):
        p1 = (int(round(x)), int(round(y)))
        p2 = (int(round(x + w)), int(round(y + h)))
        cv2.rectangle(out, p1, p2, color, thick)
        if labels and i < len(labels) and labels[i]:
            ty = max(0, p1[1] - 4)
            cv2.putText(out, str(labels[i]), (p1[0], ty),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 1, cv2.LINE_AA)
    return out


# --------------------------------------------------------------------------
# 1. 定位标记检测 + 透视校正 + ρ
# --------------------------------------------------------------------------
def _find_contours(mask):
    res = cv2.findContours(mask, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)
    if len(res) == 2:          # OpenCV >= 4
        return res[0], res[1]
    return res[1], res[2]      # OpenCV 3


def find_fiducials(rgb, layout, dbg_path):
    """检测同心三方块定位标记（黑-白-黑嵌套）。返回 4 个中心点（按 tl,tr,bl,br）或 None。"""
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)

    cw, ch = layout["canvas"]["w"], layout["canvas"]["h"]
    ph, pw = gray.shape[:2]
    rho_guess = max(pw / cw, ph / ch)
    fids = layout.get("fiducials") or []
    F = fids[0]["size"] if fids else 80.0
    exp_area = (F * rho_guess) ** 2

    found = []          # [(area, cx, cy, cnt_index_tuple)]
    all_boxes = []

    for frac in (0.30, 0.40, 0.50, 0.60):
        mask = (gray < frac * 255).astype(np.uint8) * 255
        contours, hierarchy = _find_contours(mask)
        if not contours:
            continue
        h0 = hierarchy[0] if hierarchy is not None else None
        if h0 is None:
            continue
        for i, cnt in enumerate(contours):
            area = cv2.contourArea(cnt)
            if area < 0.04 * exp_area or area > 16 * exp_area:
                continue
            peri = cv2.arcLength(cnt, True)
            if peri <= 0:
                continue
            approx = cv2.approxPolyDP(cnt, 0.05 * peri, True)
            if len(approx) != 4:
                continue
            (_, _), (rw, rh), _ = cv2.minAreaRect(cnt)
            if min(rw, rh) <= 0:
                continue
            if min(rw, rh) / max(rw, rh) < 0.70:
                continue
            child = int(h0[i][2])
            if child < 0:
                continue
            a2 = cv2.contourArea(contours[child])
            gchild = int(h0[child][2])
            if gchild < 0:
                continue
            a3 = cv2.contourArea(contours[gchild])
            r1, r2 = a2 / area, a3 / area
            if not (0.18 <= r1 <= 0.65 and 0.015 <= r2 <= 0.22):
                continue
            M = cv2.moments(cnt)
            if M["m00"] <= 0:
                continue
            cx, cy = M["m10"] / M["m00"], M["m01"] / M["m00"]
            found.append((area, cx, cy, (i, child, gchild)))
            all_boxes.append((int(cv2.boundingRect(cnt)[0]), int(cv2.boundingRect(cnt)[1]),
                              int(cv2.boundingRect(cnt)[2]), int(cv2.boundingRect(cnt)[3])))

    # 去重：按中心点距离聚类，每类保留面积最大的
    min_sep = F * rho_guess * 0.5
    picked = []
    for area, cx, cy, idx in sorted(found, key=lambda t: -t[0]):
        if all(math.hypot(cx - px, cy - py) > min_sep for _, px, py, _ in picked):
            picked.append((area, cx, cy, idx))
        if len(picked) >= 8:
            break

    dbg = fit_view(rgb)
    sc = dbg.shape[1] / rgb.shape[1]
    for (bx, by, bw, bh) in all_boxes:
        cv2.rectangle(dbg, (int(bx * sc), int(by * sc)), (int((bx + bw) * sc), int((by + bh) * sc)),
                      (80, 200, 80), 1)

    if len(picked) < 4:
        imwrite_any(dbg_path, dbg)
        return None

    pts = np.array([[p[1], p[2]] for p in picked[:4]], dtype=np.float64)
    # 角落分配（要求 4 点互不相同）
    s = pts.sum(axis=1)
    d = pts[:, 0] - pts[:, 1]
    i_tl, i_br = int(np.argmin(s)), int(np.argmax(s))
    rest = [i for i in range(len(pts)) if i not in (i_tl, i_br)]
    if len(rest) != 2:
        imwrite_any(dbg_path, dbg)
        return None
    i_tr = rest[int(np.argmax(d[rest]))]
    i_bl = rest[int(np.argmin(d[rest]))]
    if len({i_tl, i_tr, i_bl, i_br}) != 4:
        imwrite_any(dbg_path, dbg)
        return None
    quad = np.array([pts[i_tl], pts[i_tr], pts[i_bl], pts[i_br]], dtype=np.float64)  # tl,tr,bl,br

    for j, (px, py) in enumerate(quad):
        cv2.circle(dbg, (int(px * sc), int(py * sc)), max(4, int(8 * sc)), (255, 40, 40), -1)
        cv2.putText(dbg, ["TL", "TR", "BL", "BR"][j],
                    (int(px * sc) + 8, int(py * sc) - 8),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 40, 40), 2, cv2.LINE_AA)
    imwrite_any(dbg_path, dbg)
    return quad


def apply_h(H, pts):
    """齐次变换，pts (N,2) -> (N,2)。"""
    pts = np.asarray(pts, dtype=np.float64)
    ones = np.ones((len(pts), 1))
    ph = np.concatenate([pts, ones], axis=1) @ H.T
    ph = ph[:, :2] / ph[:, 2:3]
    return ph


def vig_gain(vig, cx, cy, canvas_w, canvas_h):
    """按实测暗角模型返回该点位相对中心的增益（无模型时返回 1.0）。

    vig 需含 k1/k2（分析口径）与 rmax_screen_px（r=1 对应四角重复图案中心距离）。
    """
    if not vig or vig.get("k1") is None or not vig.get("rmax_screen_px"):
        return 1.0
    r = math.hypot(cx - canvas_w / 2.0, cy - canvas_h / 2.0) / vig["rmax_screen_px"]
    return 1.0 / (1.0 + vig["k1"] * r * r + vig["k2"] * r ** 4)


def compute_rho(H_screen_to_photo, canvas_w, canvas_h, quad_screen, quad_photo):
    """ρ = 摄像头像素 / 屏幕像素。主估计：中心处单应矩阵雅可比的奇异值几何平均。"""
    cx, cy = canvas_w / 2.0, canvas_h / 2.0
    h = 2.0
    p0 = apply_h(H_screen_to_photo, [[cx, cy]])[0]
    px = apply_h(H_screen_to_photo, [[cx + h, cy]])[0]
    py = apply_h(H_screen_to_photo, [[cx, cy + h]])[0]
    J = np.array([[(px[0] - p0[0]) / h, (py[0] - p0[0]) / h],
                  [(px[1] - p0[1]) / h, (py[1] - p0[1]) / h]], dtype=np.float64)
    sv = np.linalg.svd(J, compute_uv=False)
    rho_center = float(np.sqrt(sv[0] * sv[1]))
    aniso = float(sv[0] / sv[1]) if sv[1] > 0 else None

    # 副估计：四角四边形边长比
    def edge_len(q):
        order = [(0, 1), (1, 3), (3, 2), (2, 0)]   # tl-tr, tr-br, br-bl, bl-tl
        return [float(np.linalg.norm(q[a] - q[b])) for a, b in order]
    es, ep = edge_len(quad_screen), edge_len(quad_photo)
    rho_edge = float(np.mean(ep) / np.mean(es)) if np.mean(es) > 0 else None
    return rho_center, aniso, rho_edge


# --------------------------------------------------------------------------
# 2. 斜边 ISO 12233：ESF -> LSF -> MTF
# --------------------------------------------------------------------------
def measure_edge(warped, edge_region, K, dbg_path, roi_dbg_path):
    """返回 dict: sigma_screen, mtf50_period_screen, mtf_curve, esf/lsf 等。"""
    res = {"sigma_screen": None, "sigma_moment_screen": None, "fwhm_screen": None,
           "mtf50_freq": None, "mtf50_period": None, "mtf_at_period": {},
           "esf": None, "lsf": None, "freq": None, "mtf": None,
           "angle_deg_measured": None, "n_columns": 0, "status": "ok"}

    rx, ry, rw, rh = edge_region["x"], edge_region["y"], edge_region["w"], edge_region["h"]
    # 内缩，避开外框与边界效应
    x0 = int(round((rx + 0.10 * rw) * K)); x1 = int(round((rx + 0.90 * rw) * K))
    y0 = int(round((ry + 0.10 * rh) * K)); y1 = int(round((ry + 0.90 * rh) * K))
    x1, y1 = max(x1, x0 + 8), max(y1, y0 + 8)
    roi = warped[y0:y1, x0:x1]
    if roi.size == 0:
        res["status"] = "edge ROI 为空"
        return res

    Y = lum_linear(roi)                       # 线性光亮度（MTF 必须在线性光下测）
    Hh, Ww = Y.shape
    lo, hi = np.percentile(Y, 2), np.percentile(Y, 98)
    if hi - lo < 1e-6:
        res["status"] = "斜边区对比度不足"
        return res

    N = int(round(16 * K))                    # ESF 单侧窗口 = 16 屏幕像素
    if Hh < 2 * N + 16:
        N = max(4, (Hh - 16) // 2)
    if Hh < 2 * N + 8:
        res["status"] = "斜边区高度不足"
        return res

    # 方向归一化：始终让"上白下黑"（ESF 递减）
    if Y[:max(1, Hh // 10)].mean() < Y[-max(1, Hh // 10):].mean():
        Y = Y[::-1, :]

    Yn = (Y - lo) / (hi - lo)
    cols, ycross = [], []
    for x in range(Ww):
        p = Yn[:, x]
        idx = np.nonzero((p[:-1] >= 0.5) & (p[1:] < 0.5))[0]
        if idx.size == 0:
            continue
        i = int(idx[0])
        denom = p[i] - p[i + 1]
        t = 0.5 if abs(denom) < 1e-9 else (p[i] - 0.5) / denom
        cols.append(x); ycross.append(i + t)
    if len(cols) < 20:
        res["status"] = "未能定位斜边（有效列数不足）"
        return res

    xs = np.array(cols, dtype=np.float64)
    ys = np.array(ycross, dtype=np.float64)
    b, a = np.polyfit(xs, ys, 1)              # 拟合边线（降低噪声，且保留亚像素相位）
    res["angle_deg_measured"] = float(np.degrees(np.arctan(b)))
    yfit = a + b * xs

    # 移位平均得到过采样 ESF（相位自然分布 -> 亚像素过采样）
    u = np.arange(-N, N, dtype=np.float64)
    acc = np.zeros(2 * N); cnt = 0
    grid = np.arange(Hh, dtype=np.float64)
    for x, yc in zip(xs, yfit):
        if yc - N < 0 or yc + N > Hh - 1:
            continue
        acc += np.interp(yc + u, grid, Y[:, int(x)])
        cnt += 1
    if cnt < 20:
        res["status"] = "ESF 有效列数不足"
        return res
    esf = acc / cnt
    res["n_columns"] = int(cnt)

    lsf = -np.gradient(esf)                   # ESF 递减 -> 取负得正的线扩散函数
    lsf = np.clip(lsf, 0, None)
    ssum = lsf.sum()
    if ssum <= 0:
        res["status"] = "LSF 全零"
        return res
    lsf = lsf / ssum

    # --- MTF ---
    nfft = 1
    while nfft < max(2048, 8 * len(lsf)):
        nfft *= 2
    win = np.hanning(len(lsf))
    spec = np.abs(np.fft.rfft(lsf * win, nfft))
    spec = spec / (spec[0] if spec[0] > 0 else 1.0)
    freq_warped = np.arange(len(spec)) / nfft          # cycles / 超采样像素
    freq_screen = freq_warped * K                      # cycles / 屏幕像素

    def mtf_at(f_target):
        if f_target <= 0 or f_target >= freq_screen[-1]:
            return None
        return float(np.interp(f_target, freq_screen, spec))

    def period_at_mtf(level):
        idx = np.nonzero(spec < level)[0]
        if idx.size == 0 or idx[0] == 0:
            return None, None
        i = int(idx[0])
        f = np.interp(level, [spec[i], spec[i - 1]], [freq_screen[i], freq_screen[i - 1]])
        return (float(f), float(1.0 / f) if f > 0 else None)

    f50, p50 = period_at_mtf(0.5)
    res["mtf50_freq"], res["mtf50_period"] = f50, p50
    # 口径统一：条纹/设计里的「周期 p」指条宽 p，整周期 2p（基频 f=1/(2p)）。
    # 此前用 f=1/p，与条纹曲线及 d>=T_c/2 设计规则相差一倍频率。
    for pd in (2, 3, 4, 6, 8, 12, 16):
        v = mtf_at(1.0 / (2.0 * pd))
        res["mtf_at_period"][str(pd)] = v
    res["freq"] = freq_screen.tolist()
    res["mtf"] = spec.tolist()
    res["esf"] = esf.tolist()
    res["lsf"] = lsf.tolist()

    # --- 高斯拟合 σ（对 LSF 取对数后拟合二次曲线） ---
    peak = lsf.max()
    sel = np.nonzero(lsf > 0.15 * peak)[0]
    if sel.size >= 5:
        uu = (u[sel] - u[int(np.argmax(lsf))])
        yy = np.log(lsf[sel])
        try:
            c2, c1, c0 = np.polyfit(uu, yy, 2)
            if c2 < -1e-12:
                s_warped = math.sqrt(-1.0 / (2.0 * c2))
                res["sigma_screen"] = float(s_warped / K)
                res["fwhm_screen"] = float(2.3548 * s_warped / K)
        except Exception:
            pass
    # 二阶矩法（交叉校验，不依赖高斯假设）
    center = float(np.sum(lsf * u) / np.sum(lsf)) if np.sum(lsf) > 0 else 0.0
    var = float(np.sum(lsf * (u - center) ** 2) / np.sum(lsf)) if np.sum(lsf) > 0 else 0.0
    res["sigma_moment_screen"] = float(math.sqrt(var) / K) if var > 0 else None

    # --- 可视化 ---
    view = fit_view(warped)
    sc = view.shape[1] / warped.shape[1]
    view = draw_rects(view, [(rx * K * sc, ry * K * sc, rw * K * sc, rh * K * sc)],
                      color=(255, 60, 60), thick=2, labels=["edge ROI"])
    imwrite_any(roi_dbg_path, view)

    rv = (roi * 255).astype(np.uint8) if roi.dtype != np.uint8 else roi
    rv = cv2.resize(rv, (max(8, roi.shape[1]), max(8, roi.shape[0])))
    ov = rv.copy()
    h2, w2 = ov.shape[:2]
    ss = h2 / Hh
    for x, yc in zip(xs[::max(1, len(xs) // 40)], yfit[::max(1, len(xs) // 40)]):
        cv2.circle(ov, (int(x * ss), int(yc * ss)), 2, (255, 60, 60), -1)
    lx0, ly0 = int(xs[0] * ss), int((a + b * xs[0]) * ss)
    lx1, ly1 = int(xs[-1] * ss), int((a + b * xs[-1]) * ss)
    cv2.line(ov, (lx0, ly0), (lx1, ly1), (60, 220, 60), 2)
    imwrite_any(dbg_path, ov)
    return res


# --------------------------------------------------------------------------
# 3. 条纹对比度曲线
# --------------------------------------------------------------------------
def measure_stripes(warped, stripe_regions, K, rho, dbg_path):
    rows = []
    rects, labels = [], []
    for s in stripe_regions:
        rx, ry, rw, rh = s["x"], s["y"], s["w"], s["h"]
        ix0 = int(round((rx + 0.10 * rw) * K)); ix1 = int(round((rx + 0.90 * rw) * K))
        iy0 = int(round((ry + 0.20 * rh) * K)); iy1 = int(round((ry + 0.80 * rh) * K))
        ix1, iy1 = max(ix1, ix0 + 4), max(iy1, iy0 + 4)
        roi = warped[iy0:iy1, ix0:ix1]
        rects.append((rx * K, ry * K, rw * K, rh * K))
        labels.append(f"p{s['period']}{'V' if s['orientation'] == 'vertical' else 'H'}")
        if roi.size == 0:
            rows.append({"period": s["period"], "orientation": s["orientation"],
                         "contrast": None, "mod_fft": None, "mean_level": None,
                         "alias_flag": None, "status": "ROI 为空"})
            continue
        Y = lum_linear(roi)
        prof = Y.mean(axis=0) if s["orientation"] == "vertical" else Y.mean(axis=1)
        prof = np.asarray(prof, dtype=np.float64)
        if prof.size < 4 or np.mean(prof) <= 0:
            rows.append({"period": s["period"], "orientation": s["orientation"],
                         "contrast": None, "mod_fft": None, "mean_level": None,
                         "alias_flag": None, "status": "信号无效"})
            continue
        p_hi, p_lo = np.percentile(prof, 97), np.percentile(prof, 3)
        contrast = float((p_hi - p_lo) / (p_hi + p_lo)) if (p_hi + p_lo) > 1e-9 else None

        # FFT 基波调制度（交叉校验）
        mod_fft = None
        try:
            n = prof.size
            cyc = n / (s["period"] * K)                 # 窗口内的周期数
            k = int(round(cyc))
            if 0 < k < n / 2:
                w = np.hanning(n)
                X = np.fft.rfft((prof - prof.mean()) * w)
                mod_fft = float(2.0 * abs(X[k]) / (n * prof.mean() / 2.0) / 2.0)
        except Exception:
            mod_fft = None

        spp = s["period"] * rho if rho else None         # 每个周期有多少摄像头像素
        rows.append({"period": s["period"], "orientation": s["orientation"],
                     "contrast": contrast, "mod_fft": mod_fft,
                     "mean_level": float(np.mean(prof)),
                     "alias_flag": (spp is not None and spp < 2.5),
                     "status": "ok"})

    # 归一化（以最粗周期为参考）+ 临界周期 T_c
    out = {"rows": rows, "t_c": None, "t_c_note": "", "by_orientation": {}}
    for orient in ("vertical", "horizontal"):
        sub = [r for r in rows if r["orientation"] == orient and r["contrast"] is not None]
        if not sub:
            out["by_orientation"][orient] = {"t_c": None, "ref_period": None, "curves": []}
            continue
        sub.sort(key=lambda r: r["period"])
        ref = max(sub, key=lambda r: r["period"])
        ref_c = ref["contrast"]
        curves = []
        for r in sub:
            rel = (r["contrast"] / ref_c) if (ref_c and ref_c > 0.02) else None
            curves.append({"period": r["period"], "contrast_abs": r["contrast"],
                           "contrast_rel": rel, "mod_fft": r["mod_fft"],
                           "alias": r["alias_flag"]})
            r["contrast_rel"] = rel
        tc, note = interp_tc([(c["period"], c["contrast_rel"]) for c in curves
                              if c["contrast_rel"] is not None])
        out["by_orientation"][orient] = {"t_c": tc, "note": note,
                                         "ref_period": ref["period"], "curves": curves}
    tcs = [v["t_c"] for v in out["by_orientation"].values()
           if v and v.get("t_c") is not None]
    if tcs:
        out["t_c"] = float(max(tcs))                     # 取最差（保守）
        out["t_c_note"] = "取竖/横两个方向中较大的 T_c（保守）"
    else:
        out["t_c_note"] = "未能确认：无有效对比度数据"

    view = fit_view(warped)
    sc = view.shape[1] / warped.shape[1]
    rects = [(x * sc, y * sc, w * sc, h * sc) for (x, y, w, h) in rects]
    imwrite_any(dbg_path, draw_rects(view, rects, color=(255, 200, 60), thick=1, labels=labels))
    return out


def interp_tc(pairs, level=0.2):
    """pairs: [(period, rel_contrast)] 升序。返回达到 level 的最小周期（线性插值）。"""
    if not pairs:
        return None, "未能确认"
    pairs = sorted(pairs)
    for i, (p, c) in enumerate(pairs):
        if c >= level:
            if i == 0:
                return float(p), f"最小周期 p={p} 已满足 >= {level}，实际 T_c <= {p}"
            p0, c0 = pairs[i - 1]
            p1, c1 = p, c
            if abs(c1 - c0) < 1e-9:
                return float(p1), "插值退化"
            tc = p0 + (level - c0) * (p1 - p0) / (c1 - c0)
            return float(tc), f"在 p={p0}~{p1} 之间插值"
    return None, f"所有周期对比度均 < {level}，T_c > {pairs[-1][0]}"


# --------------------------------------------------------------------------
# 4. 伽马曲线
# --------------------------------------------------------------------------
def measure_gamma(warped, gray_regions, K, dbg_path, vig=None, canvas=None):
    vals, meas, rects, labels = [], [], [], []
    for g in gray_regions:
        rx, ry, rw, rh = g["x"], g["y"], g["w"], g["h"]
        ix0 = int(round((rx + 0.20 * rw) * K)); ix1 = int(round((rx + 0.80 * rw) * K))
        iy0 = int(round((ry + 0.20 * rh) * K)); iy1 = int(round((ry + 0.80 * rh) * K))
        ix1, iy1 = max(ix1, ix0 + 2), max(iy1, iy0 + 2)
        roi = warped[iy0:iy1, ix0:ix1]
        rects.append((rx * K, ry * K, rw * K, rh * K)); labels.append(str(g["value"]))
        if roi.size == 0:
            continue
        m = float(lum_encoded(roi).mean())
        if canvas is not None:
            # 暗角校正：增益作用在线性域，先除增益再回编码域
            g_ = vig_gain(vig, rx + rw / 2.0, ry + rh / 2.0, canvas["w"], canvas["h"])
            if g_ != 1.0:
                m = float(linear_to_srgb(srgb_to_linear(m / 255.0) / g_) * 255.0)
        vals.append(g["value"]); meas.append(m)

    res = {"gamma": None, "gain": None, "black_offset": None, "rms": None,
           "table": [], "n_used": 0, "n_clipped": 0, "status": "ok"}
    if len(vals) < 4:
        res["status"] = "有效灰阶块不足"
        _write_roi_dbg(warped, rects, labels, dbg_path)
        return res

    x = np.array(vals, dtype=np.float64) / 255.0
    y = np.array(meas, dtype=np.float64) / 255.0
    keep = (y > 0.012) & (y < 0.988)        # 剔除黑/白削波点
    n_clip = int((~keep).sum())
    res["n_clipped"] = n_clip
    if keep.sum() < 4:
        keep = np.ones_like(keep, dtype=bool)
    xk, yk = x[keep], y[keep]

    best = None
    for g in np.arange(0.40, 4.005, 0.005):
        A = np.stack([xk ** g, np.ones_like(xk)], axis=1)
        try:
            coef, *_ = np.linalg.lstsq(A, yk, rcond=None)
        except Exception:
            continue
        r = yk - A @ coef
        rms = float(np.sqrt(np.mean(r ** 2)))
        if best is None or rms < best[0]:
            best = (rms, float(g), float(coef[0]), float(coef[1]))
    if best is None:
        res["status"] = "拟合失败"
        _write_roi_dbg(warped, rects, labels, dbg_path)
        return res
    rms, gbest, a, b = best
    res.update({"gamma": gbest, "gain": a, "black_offset": b, "rms": rms,
                "n_used": int(keep.sum())})
    res["table"] = [{"input": int(v), "measured_Y": round(m, 2),
                     "predicted_Y": round(255.0 * (a * (v / 255.0) ** gbest + b), 2),
                     "used": bool(k)}
                    for v, m, k in zip(vals, meas, keep)]
    _write_roi_dbg(warped, rects, labels, dbg_path)
    return res


def _write_roi_dbg(warped, rects, labels, dbg_path):
    view = fit_view(warped)
    sc = view.shape[1] / warped.shape[1]
    r = [(x * sc, y * sc, w * sc, h * sc) for (x, y, w, h) in rects]
    imwrite_any(dbg_path, draw_rects(view, r, color=(90, 200, 255), thick=1, labels=labels))


# --------------------------------------------------------------------------
# 5. CCM 色彩串扰矩阵
# --------------------------------------------------------------------------
def solve_ccm(known, measured):
    """known/measured: (N,3) 0..1。返回 (M 3x3, c 3, rms)。"""
    A = np.concatenate([known, np.ones((len(known), 1))], axis=1)
    coef, *_ = np.linalg.lstsq(A, measured, rcond=None)
    M = coef[:3, :].T          # 每行 = 一个输出通道对输入的线性组合
    c = coef[3, :]
    pred = A @ coef
    rms = float(np.sqrt(np.mean((measured - pred) ** 2)))
    return M, c, rms, pred


def measure_ccm(warped, color_regions, K, dbg_path, vig=None, canvas=None):
    known, measured, rects, labels, gains = [], [], [], [], []
    for c in color_regions:
        rx, ry, rw, rh = c["x"], c["y"], c["w"], c["h"]
        ix0 = int(round((rx + 0.20 * rw) * K)); ix1 = int(round((rx + 0.80 * rw) * K))
        iy0 = int(round((ry + 0.20 * rh) * K)); iy1 = int(round((ry + 0.80 * rh) * K))
        ix1, iy1 = max(ix1, ix0 + 2), max(iy1, iy0 + 2)
        roi = warped[iy0:iy1, ix0:ix1]
        rects.append((rx * K, ry * K, rw * K, rh * K)); labels.append(c.get("name", ""))
        if roi.size == 0:
            continue
        known.append(c["rgb"])
        measured.append([float(v) for v in roi.reshape(-1, 3).mean(axis=0)])
        gains.append(vig_gain(vig, c["x"] + c["w"] / 2.0, c["y"] + c["h"] / 2.0,
                              canvas["w"], canvas["h"]) if canvas else 1.0)
    res = {"M_linear": None, "c_linear": None, "rms_linear": None,
           "M_encoded": None, "c_encoded": None, "rms_encoded": None,
           "max_patch_err_8bit": None, "table": [], "n_patches": 0, "status": "ok"}
    if len(known) < 5:
        res["status"] = "有效色块不足"
        _write_roi_dbg(warped, rects, labels, dbg_path)
        return res
    KN = np.array(known, dtype=np.float64) / 255.0
    MS = np.array(measured, dtype=np.float64) / 255.0
    KL, ML = srgb_to_linear(KN), srgb_to_linear(MS)
    ML = ML / np.asarray(gains, dtype=np.float64)[:, None]   # 暗角校正（线性域）
    MS = linear_to_srgb(ML)
    M, c, rms, pred_lin = solve_ccm(KL, ML)
    Me, ce, rmse, pred_enc = solve_ccm(KN, MS)
    res.update({"M_linear": M.tolist(), "c_linear": c.tolist(), "rms_linear": rms,
                "M_encoded": Me.tolist(), "c_encoded": ce.tolist(), "rms_encoded": rmse,
                "n_patches": len(known)})
    errs = np.abs(pred_enc - MS) * 255.0
    res["max_patch_err_8bit"] = float(errs.max())
    res["table"] = [{"name": c.get("name", ""), "known_rgb": c["rgb"],
                     "measured_rgb": [round(v, 1) for v in m],
                     "predicted_rgb": [round(float(v) * 255, 1) for v in p],
                     "err_8bit_max": round(float(e), 1)}
                    for c, m, p, e in zip(color_regions, MS, pred_enc, errs.max(axis=1))]
    _write_roi_dbg(warped, rects, labels, dbg_path)
    return res


# --------------------------------------------------------------------------
# 6. Vignetting 暗角场 + 几何畸变
# --------------------------------------------------------------------------
def measure_vignetting(warped, repeat_regions, K, canvas, dbg_path):
    res = {"copies": [], "k1": None, "k2": None, "rmax_screen_px": None,
           "corner_loss_pct": None,
           "edge_loss_pct": None, "distortion_max_screen_px": None,
           "distortion_rms_screen_px": None, "status": "ok"}
    if not repeat_regions:
        res["status"] = "无重复图案区（repeat=0）"
        return res

    Wp, Hp = int(round(canvas["w"] * K)), int(round(canvas["h"] * K))
    icx, icy = Wp / 2.0, Hp / 2.0
    centers = np.array([[r["x"] + r["w"] / 2.0, r["y"] + r["h"] / 2.0] for r in repeat_regions])
    dists = np.linalg.norm(centers * K - np.array([icx, icy]), axis=1)
    corner_ids = {"tl", "tr", "bl", "br"}
    cd = [d for r, d in zip(repeat_regions, dists) if r["id"] in corner_ids]
    rmax = float(np.mean(cd)) if cd else float(dists.max())
    res["rmax_screen_px"] = float(np.mean(cd) / K) if cd else None

    rects, labels = [], []
    tmpl = None
    for r, dist in zip(repeat_regions, dists):
        q = r["w"] / 2.0
        def sub(fx, fy, fw, fh):
            x0 = int(round((r["x"] + fx) * K)); x1 = int(round((r["x"] + fx + fw) * K))
            y0 = int(round((r["y"] + fy) * K)); y1 = int(round((r["y"] + fy + fh) * K))
            x1, y1 = max(x1, x0 + 2), max(y1, y0 + 2)
            return warped[y0:y1, x0:x1]
        g_roi = sub(0.15 * q, 0.15 * q, 0.7 * q, 0.7 * q)          # 左上：中灰
        w_roi = sub(q + 0.15 * q, q + 0.15 * q, 0.7 * q, 0.7 * q)  # 右下：白
        b_roi = sub(0.15 * q, q + 0.15 * q, 0.7 * q, 0.7 * q)      # 左下：黑
        s_roi = sub(q + 0.10 * q, 0.10 * q, 0.8 * q, 0.8 * q)      # 右上：2px 细条纹
        rects.append((r["x"] * K, r["y"] * K, r["w"] * K, r["h"] * K)); labels.append(r["id"])
        if min(g_roi.size, w_roi.size, b_roi.size) == 0:
            continue
        Yg = float(lum_linear(g_roi).mean())
        Yw = float(lum_linear(w_roi).mean())
        Yb = float(lum_linear(b_roi).mean())
        mod = None
        if s_roi.size:
            prof = lum_linear(s_roi).mean(axis=1)
            ph, pl = np.percentile(prof, 95), np.percentile(prof, 5)
            mod = float((ph - pl) / (ph + pl)) if (ph + pl) > 1e-9 else None
        res["copies"].append({"id": r["id"], "r": float(dist / rmax) if rmax > 0 else None,
                              "gray_lin": Yg, "white_lin": Yw, "black_lin": Yb,
                              "range_lin": Yw - Yb, "stripe_mod": mod})
        if r["id"] == "center":
            tmpl = s_roi

    # 径向衰减拟合： 1/g - 1 = k1*r^2 + k2*r^4
    by_id = {c["id"]: c for c in res["copies"]}
    if "center" in by_id and by_id["center"]["gray_lin"] > 1e-6:
        g0 = by_id["center"]["gray_lin"]
        rs, ys = [], []
        for c in res["copies"]:
            if c["r"] is None or c["r"] <= 1e-3:
                continue
            g = c["gray_lin"] / g0
            if g <= 1e-3:
                continue
            rs.append(c["r"]); ys.append(1.0 / g - 1.0)
        if len(rs) >= 3:
            A = np.array([[r ** 2, r ** 4] for r in rs])
            b = np.array(ys)
            try:
                coef, *_ = np.linalg.lstsq(A, b, rcond=None)
                k1, k2 = float(coef[0]), float(coef[1])
                res["k1"], res["k2"] = k1, k2
                g_corner = 1.0 / (1.0 + k1 + k2)
                g_edge = 1.0 / (1.0 + k1 * 0.25 + k2 * 0.0625)
                res["corner_loss_pct"] = float((1.0 - g_corner) * 100.0)
                res["edge_loss_pct"] = float((1.0 - g_edge) * 100.0)
            except Exception:
                pass

    # 几何畸变：用中心副本的细条纹做模板，在其余副本附近做模板匹配
    offs = []
    if tmpl is not None and tmpl.size > 0:
        tg = cv2.cvtColor(tmpl, cv2.COLOR_RGB2GRAY).astype(np.float32)
        if tg.std() > 3.0 and tg.shape[0] >= 6 and tg.shape[1] >= 6:
            margin = int(round(12 * K))
            for r in repeat_regions:
                if r["id"] == "center":
                    continue
                q = r["w"] / 2.0
                ex = int(round((r["x"] + q) * K)); ey = int(round(r["y"] * K))
                ew = int(round(q * K)); eh = int(round(q * K))
                x0 = max(0, ex - margin); y0 = max(0, ey - margin)
                x1 = min(Wp, ex + ew + margin); y1 = min(Hp, ey + eh + margin)
                win = warped[y0:y1, x0:x1]
                if win.shape[0] < tg.shape[0] + 2 or win.shape[1] < tg.shape[1] + 2:
                    continue
                wg = cv2.cvtColor(win, cv2.COLOR_RGB2GRAY).astype(np.float32)
                try:
                    mm = cv2.matchTemplate(wg, tg, cv2.TM_CCOEFF_NORMED)
                    _, mx, _, loc = cv2.minMaxLoc(mm)
                except Exception:
                    continue
                if mx < 0.45:
                    continue
                dx = (x0 + loc[0]) - ex
                dy = (y0 + loc[1]) - ey
                offs.append((r["id"], dx / K, dy / K, float(mx)))
    if offs:
        mags = [math.hypot(dx, dy) for _, dx, dy, _ in offs]
        res["distortion_max_screen_px"] = float(max(mags))
        res["distortion_rms_screen_px"] = float(np.sqrt(np.mean(np.square(mags))))
        res["distortion_detail"] = [{"id": i, "dx": round(dx, 2), "dy": round(dy, 2),
                                     "score": round(sc, 3)} for i, dx, dy, sc in offs]

    view = fit_view(warped)
    sc = view.shape[1] / warped.shape[1]
    imwrite_any(dbg_path, draw_rects(view, [(x * sc, y * sc, w * sc, h * sc)
                                            for (x, y, w, h) in rects],
                                     color=(200, 120, 255), thick=2, labels=labels))
    return res


# --------------------------------------------------------------------------
# 7. 噪声
# --------------------------------------------------------------------------
def plane_residual_std(img2d):
    h, w = img2d.shape
    if h * w < 36:
        return None
    yy, xx = np.mgrid[0:h, 0:w]
    x = (xx.ravel() - w / 2.0) / max(w, 1)
    y = (yy.ravel() - h / 2.0) / max(h, 1)
    A = np.stack([np.ones_like(x), x, y, x * x, x * y, y * y], axis=1)
    b = img2d.ravel().astype(np.float64)
    try:
        coef, *_ = np.linalg.lstsq(A, b, rcond=None)
    except Exception:
        return None
    return float(np.std(b - A @ coef))


def measure_noise(warped, gray_regions, K, dbg_path):
    """在平坦区（最接近 128 的灰阶块）估计 σ_Y / σ_Cb / σ_Cr。"""
    res = {"sigma_Y": None, "sigma_Cb": None, "sigma_Cr": None, "snr_db": None,
           "patch_value": None, "roi_px": None, "status": "ok"}
    if not gray_regions:
        res["status"] = "无灰阶区（gray=0）"
        return res
    g = min(gray_regions, key=lambda r: abs(r["value"] - 128))
    rx, ry, rw, rh = g["x"], g["y"], g["w"], g["h"]
    ix0 = int(round((rx + 0.25 * rw) * K)); ix1 = int(round((rx + 0.75 * rw) * K))
    iy0 = int(round((ry + 0.25 * rh) * K)); iy1 = int(round((ry + 0.75 * rh) * K))
    ix1, iy1 = max(ix1, ix0 + 8), max(iy1, iy0 + 8)
    # 避开画布边缘：真实照片的 PSF 会把图表外背景混入最外围几个屏幕像素
    m = 2 * K
    iy0, ix0 = max(iy0, m), max(ix0, m)
    iy1, ix1 = min(iy1, warped.shape[0] - m), min(ix1, warped.shape[1] - m)
    if iy1 - iy0 < 8 or ix1 - ix0 < 8:
        res["status"] = "噪声 ROI 贴近画布边缘，无法安全取样"
        return res
    roi = warped[iy0:iy1, ix0:ix1]
    if roi.size == 0:
        res["status"] = "噪声 ROI 为空"
        return res
    f = roi.astype(np.float64)
    R, Gc, B = f[..., 0], f[..., 1], f[..., 2]
    Y = 0.2126 * R + 0.7152 * Gc + 0.0722 * B
    Cb = (B - Y) * 0.564
    Cr = (R - Y) * 0.713
    res["sigma_Y"] = plane_residual_std(Y)
    res["sigma_Cb"] = plane_residual_std(Cb)
    res["sigma_Cr"] = plane_residual_std(Cr)
    if res["sigma_Y"] and res["sigma_Y"] > 0:
        res["snr_db"] = float(20 * math.log10(255.0 / res["sigma_Y"]))
    res["patch_value"] = g["value"]
    res["roi_px"] = [int(roi.shape[1]), int(roi.shape[0])]

    view = fit_view(warped)
    sc = view.shape[1] / warped.shape[1]
    imwrite_any(dbg_path, draw_rects(view, [(rx * K * sc, ry * K * sc, rw * K * sc, rh * K * sc)],
                                     color=(120, 255, 120), thick=2,
                                     labels=[f"noise ROI v={g['value']}"]))
    return res


# --------------------------------------------------------------------------
# 单张照片的完整流程
# --------------------------------------------------------------------------
def gray_orientation_score(rgb, quad, quad_screen, layout):
    """区分 180° 倒置：校正后测灰阶序列，与 layout 已知顺序算相关性。

    正确方向下灰阶实测应随 value 单调递增（相关性≈+1）；
    上下/左右颠倒时序列反转，相关性为负。用于 90° 与 270° 的二选一。
    """
    canvas = layout["canvas"]
    cw, ch = int(canvas["w"]), int(canvas["h"])
    regs = (layout.get("regions") or {}).get("gray") or []
    if len(regs) < 4:
        return 0.0
    Hw = cv2.getPerspectiveTransform(quad.astype(np.float32),
                                     quad_screen.astype(np.float32))
    w = cv2.warpPerspective(rgb, Hw, (cw, ch), flags=cv2.INTER_AREA)
    g = cv2.cvtColor(w, cv2.COLOR_RGB2GRAY) if w.ndim == 3 else w
    vals, meas = [], []
    for rg in regs:
        x0 = int(rg["x"] + rg["w"] * 0.3); x1 = int(rg["x"] + rg["w"] * 0.7)
        y0 = int(rg["y"] + rg["h"] * 0.3); y1 = int(rg["y"] + rg["h"] * 0.7)
        x0, x1 = max(0, min(x0, g.shape[1] - 1)), max(0, min(x1, g.shape[1] - 1))
        y0, y1 = max(0, min(y0, g.shape[0] - 1)), max(0, min(y1, g.shape[0] - 1))
        if x1 <= x0 or y1 <= y0:
            continue
        vals.append(float(rg["value"]))
        meas.append(float(g[y0:y1, x0:x1].mean()))
    if len(vals) < 4:
        return 0.0
    a = np.asarray(vals, dtype=np.float64)
    b = np.asarray(meas, dtype=np.float64)
    if a.std() == 0 or b.std() == 0:
        return 0.0
    return float(np.corrcoef(a, b)[0, 1])


def analyze_one(photo_path, layout, outdir, K):
    name = os.path.splitext(os.path.basename(photo_path))[0]
    dbg_dir = os.path.join(outdir, "debug", name)
    os.makedirs(dbg_dir, exist_ok=True)

    rgb0 = imread_any(photo_path)
    canvas = layout["canvas"]
    cw, ch = canvas["w"], canvas["h"]

    # 屏幕坐标下的四角中心（tl,tr,bl,br）
    def cen(f):
        return [f["x"] + f["size"] / 2.0, f["y"] + f["size"] / 2.0]
    order = {"tl": 0, "tr": 1, "bl": 2, "br": 3}
    quad_screen = np.zeros((4, 2), dtype=np.float64)
    for f in layout["fiducials"]:
        if f["id"] in order:
            quad_screen[order[f["id"]]] = cen(f)

    # --- 方向自适应：4 个角度全部尝试，按几何合理性 + 内容方向评分选最佳 ---
    # 不能"检出即用"：定位标记四角对称，照片躺倒时也能配上四个角，
    # 但单应会把 16:9 拉成 9:16（各向异性≈4），导致所有下游测量失真。
    candidates = []
    for ang in (0, 90, 180, 270):
        trial = rgb0 if ang == 0 else np.rot90(rgb0, k=(ang // 90) % 4).copy()
        q = find_fiducials(trial, layout, os.path.join(dbg_dir, f"00_fiducials_try{ang}.png"))
        if q is None:
            continue
        Hq = cv2.getPerspectiveTransform(quad_screen.astype(np.float32),
                                         q.astype(np.float32))
        rq, aq, req = compute_rho(Hq, cw, ch, quad_screen, q)
        candidates.append({"ang": ang, "quad": q, "rgb": trial,
                           "rho": rq, "aniso": aq, "rho_edge": req})
    out = {"photo": os.path.basename(photo_path)}

    if not candidates:
        out["rotation_applied"] = 0
        out["status"] = "未找到 4 个定位标记"
        out["rho"] = None
        return out, None

    best = None
    for c in candidates:
        an = c["aniso"]
        pen = abs(math.log(an)) if (an and an > 0) else 9.9
        if pen > 0.4:            # aniso 超出 ~[0.67, 1.49]：方向与 layout 不匹配
            continue
        c["gray_corr"] = gray_orientation_score(c["rgb"], c["quad"], quad_screen, layout)
        if best is None or c["gray_corr"] > best["gray_corr"]:
            best = c
    if best is None:
        # 无一通过几何校验：取各向异性最接近 1 的，并明确告警（防静默失效）
        best = min(candidates,
                   key=lambda c: abs(math.log(c["aniso"])) if c["aniso"] else 9.9)
        best["gray_corr"] = None
        out["orientation_warning"] = (
            "所有角度各向异性均异常(最佳 %.3f)，方向与 layout 可能不匹配"
            % (best["aniso"] or 0.0))

    quad, rgb, angle = best["quad"], best["rgb"], best["ang"]
    rho, aniso, rho_edge = best["rho"], best["aniso"], best["rho_edge"]
    out["rotation_applied"] = angle
    out["orientation_gray_corr"] = best["gray_corr"]
    out["orientation_candidates"] = [
        {"angle": c["ang"],
         "aniso": (round(c["aniso"], 4) if c["aniso"] else None),
         "gray_corr": (round(c["gray_corr"], 4) if c.get("gray_corr") is not None else None)}
        for c in candidates]

    # --- 几何与 ρ ---
    out["rho"] = rho
    out["rho_anisotropy"] = aniso
    out["rho_quad_edge"] = rho_edge
    out["photo_size"] = [int(rgb.shape[1]), int(rgb.shape[0])]
    out["canvas_size"] = [int(cw), int(ch)]
    out["supersample_K"] = K

    # --- 透视校正（铁律 1：所有测量都在校正后的图上做）---
    Wp, Hp = int(round(cw * K)), int(round(ch * K))
    dst = quad_screen * K
    H_warp = cv2.getPerspectiveTransform(quad.astype(np.float32), dst.astype(np.float32))
    warped = cv2.warpPerspective(rgb, H_warp, (Wp, Hp), flags=cv2.INTER_CUBIC)
    reproj = apply_h(H_warp, quad)
    out["reprojection_rms_screen_px"] = float(np.sqrt(np.mean(
        np.sum((reproj - dst) ** 2, axis=1))) / K)
    out["status"] = "ok"

    imwrite_any(os.path.join(dbg_dir, "01_corrected_overview.png"), fit_view(warped))
    # 全部区域总览（一眼核对"量在哪"）
    allr, alllab = [], []
    reg = layout["regions"]
    if reg.get("edge"):
        e = reg["edge"]; allr.append((e["x"] * K, e["y"] * K, e["w"] * K, e["h"] * K)); alllab.append("edge")
    for s in reg.get("stripes", []):
        allr.append((s["x"] * K, s["y"] * K, s["w"] * K, s["h"] * K))
        alllab.append(f"p{s['period']}{'V' if s['orientation'] == 'vertical' else 'H'}")
    for g in reg.get("gray", []):
        allr.append((g["x"] * K, g["y"] * K, g["w"] * K, g["h"] * K)); alllab.append(str(g["value"]))
    for c in reg.get("color", []):
        allr.append((c["x"] * K, c["y"] * K, c["w"] * K, c["h"] * K)); alllab.append(c.get("name", ""))
    for r in reg.get("repeat", []):
        allr.append((r["x"] * K, r["y"] * K, r["w"] * K, r["h"] * K)); alllab.append(r["id"])
    view = fit_view(warped)
    sc = view.shape[1] / warped.shape[1]
    imwrite_any(os.path.join(dbg_dir, "02_all_regions.png"),
                draw_rects(view, [(x * sc, y * sc, w * sc, h * sc) for (x, y, w, h) in allr],
                           color=(255, 90, 90), thick=1, labels=alllab))

    # --- 各项测量 ---
    if reg.get("edge"):
        out["psf"] = measure_edge(warped, reg["edge"], K,
                                  os.path.join(dbg_dir, "03_edge_fit.png"),
                                  os.path.join(dbg_dir, "03_edge_roi.png"))
    else:
        out["psf"] = {"status": "未拍摄斜边区（edge=0）"}

    if reg.get("stripes"):
        out["stripes"] = measure_stripes(warped, reg["stripes"], K, rho,
                                         os.path.join(dbg_dir, "04_stripes.png"))
    else:
        out["stripes"] = {"status": "未拍摄条纹区（stripes=0）", "t_c": None}

    # 顺序：先测暗角（作为其它测量的校正依据），再测伽马/CCM
    if reg.get("repeat"):
        out["vignetting"] = measure_vignetting(warped, reg["repeat"], K, canvas,
                                               os.path.join(dbg_dir, "05_repeat_vignetting.png"))
    else:
        out["vignetting"] = {"status": "未拍摄重复图案区（repeat=0）"}

    if reg.get("gray"):
        out["gamma"] = measure_gamma(warped, reg["gray"], K,
                                     os.path.join(dbg_dir, "06_gray.png"),
                                     vig=out.get("vignetting"), canvas=canvas)
    else:
        out["gamma"] = {"status": "未拍摄灰阶区（gray=0）"}

    if reg.get("color"):
        out["ccm"] = measure_ccm(warped, reg["color"], K,
                                 os.path.join(dbg_dir, "07_color.png"),
                                 vig=out.get("vignetting"), canvas=canvas)
    else:
        out["ccm"] = {"status": "未拍摄色块区（color=0）"}

    if reg.get("gray"):
        out["noise"] = measure_noise(warped, reg["gray"], K,
                                     os.path.join(dbg_dir, "08_noise.png"))
    else:
        out["noise"] = {"status": "无灰阶区，无法测噪声"}

    return out, warped


# --------------------------------------------------------------------------
# 报告
# --------------------------------------------------------------------------
def md_table(headers, rows):
    if not rows:
        return "_（无数据）_\n"
    out = ["| " + " | ".join(headers) + " |",
           "|" + "|".join(["---"] * len(headers)) + "|"]
    for r in rows:
        out.append("| " + " | ".join("" if v is None else str(v) for v in r) + " |")
    return "\n".join(out) + "\n"


def build_report(results, layout, K, args):
    L = []
    A = L.append
    A("# 光学信道标定报告\n")
    A(f"- 生成时间：{__import__('datetime').datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    A(f"- 布局文件：`{os.path.basename(args.layout)}`（画布 {layout['canvas']['w']}×{layout['canvas']['h']} 设备px，dpr={layout['canvas']['dpr']}）")
    A(f"- 照片数量：{len(results)}（重复拍摄用于评估可复现性）")
    A(f"- 超采样倍数 K = {K}（1 屏幕像素 = {K} 超采样像素；**所有长度已换算为屏幕像素**）")
    ppi = layout.get("ppi")
    A(f"- 屏幕 PPI：{fmt(ppi, 1) if ppi else NA}（未标定则无法把屏幕像素换算为毫米）")
    A("")

    ok = [r for r in results if r.get("status") == "ok"]
    if not ok:
        A("## ⛔ 全部照片均未能完成定位\n")
        for r in results:
            A(f"- `{r['photo']}`：{r.get('status')}")
        A("\n请检查 `debug/<照片名>/00_fiducials_try*.png`，确认四角定位标记是否被完整拍入。\n")
        return "\n".join(L)

    A("## 1. 几何与 ρ（摄像头像素 / 屏幕像素）\n")
    A(md_table(["照片", "旋转", "照片尺寸", "ρ(中心雅可比)", "各向异性", "ρ(四边均值)", "重投影误差(屏幕px)"],
               [[r["photo"], f"{r['rotation_applied']}°", f"{r['photo_size'][0]}×{r['photo_size'][1]}",
                 fmt(r.get("rho"), 4), fmt(r.get("rho_anisotropy"), 3),
                 fmt(r.get("rho_quad_edge"), 4), fmt(r.get("reprojection_rms_screen_px"), 3)]
                for r in ok]))
    rho_m, rho_s = mean_std([r.get("rho") for r in ok])
    A(f"**ρ（均值）= {fmt(rho_m, 4)} ± {fmt(rho_s, 4)}**\n")
    A("> ρ<1 表示屏幕像素被欠采样；ρ<2 时**屏幕单像素级细节会发生混叠**，这是设计上的硬约束。\n")

    A("## 2. PSF 与 MTF（ISO 12233 斜边法）\n")
    rows = []
    for r in ok:
        p = r.get("psf") or {}
        rows.append([r["photo"], fmt(p.get("sigma_screen"), 3), fmt(p.get("sigma_moment_screen"), 3),
                     fmt(p.get("fwhm_screen"), 3), fmt(p.get("mtf50_period"), 2),
                     fmt(p.get("angle_deg_measured"), 2), p.get("n_columns", 0),
                     p.get("status", "")])
    A(md_table(["照片", "σ_高斯(屏幕px)", "σ_二阶矩(屏幕px)", "FWHM(屏幕px)",
                "MTF50周期(屏幕px)", "实测边角(°)", "有效列数", "状态"], rows))
    A(md_table(["照片"] + [f"MTF@周期{p}px" for p in (2, 3, 4, 6, 8, 12, 16)],
               [[r["photo"]] + [fmt((r.get("psf") or {}).get("mtf_at_period", {}).get(str(p)), 3)
                                for p in (2, 3, 4, 6, 8, 12, 16)] for r in ok]))
    s_m, s_s = mean_std([(r.get("psf") or {}).get("sigma_screen") for r in ok])
    A(f"**σ_PSF（均值）= {fmt(s_m, 3)} ± {fmt(s_s, 3)} 屏幕像素**\n")
    A("> σ 已包含「屏幕像素孔径 ⊗ 摄像头 PSF」的**系统**模糊，这正是设计所需数字。\n")

    A("## 3. 条纹对比度曲线与临界周期 T_c\n")
    for orient, label in (("vertical", "竖条（周期沿 X）"), ("horizontal", "横条（周期沿 Y）")):
        A(f"### {label}\n")
        rows = []
        for r in ok:
            st = (r.get("stripes") or {}).get("by_orientation", {}).get(orient) or {}
            for c in st.get("curves", []):
                rows.append([r["photo"], c["period"], fmt(c.get("contrast_abs"), 4),
                             fmt(c.get("contrast_rel"), 4), fmt(c.get("mod_fft"), 4),
                             "⚠欠采样" if c.get("alias") else ""])
        A(md_table(["照片", "周期(屏幕px)", "绝对对比度", "相对对比度", "FFT调制度", "备注"], rows))
    rows = []
    for r in ok:
        st = r.get("stripes") or {}
        b = st.get("by_orientation", {})
        rows.append([r["photo"],
                     fmt((b.get("vertical") or {}).get("t_c"), 2),
                     fmt((b.get("horizontal") or {}).get("t_c"), 2),
                     fmt(st.get("t_c"), 2), st.get("t_c_note", "") or st.get("status", "")])
    A(md_table(["照片", "T_c 竖向(屏幕px)", "T_c 横向(屏幕px)", "**T_c 采用值**", "说明"], rows))
    tc_m, tc_s = mean_std([(r.get("stripes") or {}).get("t_c") for r in ok])
    A(f"**T_c（均值，取最差方向）= {fmt(tc_m, 2)} ± {fmt(tc_s, 2)} 屏幕像素**")
    A("> T_c = 相对对比度跌破 0.2 的临界周期。相邻两个数据单元一黑一白时构成周期 2d，"
      "故要求 2d ≥ T_c，即 **d ≥ T_c/2**。\n")

    A("## 4. 伽马响应曲线\n")
    rows = []
    for r in ok:
        g = r.get("gamma") or {}
        rows.append([r["photo"], fmt(g.get("gamma"), 3), fmt(g.get("gain"), 4),
                     fmt(g.get("black_offset"), 4), fmt(g.get("rms"), 5),
                     g.get("n_used", 0), g.get("n_clipped", 0), g.get("status", "")])
    A(md_table(["照片", "γ", "增益 a", "黑电平 b", "拟合RMS", "参与点数", "削波剔除", "状态"], rows))
    gm, gs = mean_std([(r.get("gamma") or {}).get("gamma") for r in ok])
    A(f"**γ（均值）= {fmt(gm, 3)} ± {fmt(gs, 3)}**（模型：Y/255 = a·(v/255)^γ + b）\n")
    first = (ok[0].get("gamma") or {}).get("table") or []
    if first:
        A("<details><summary>灰阶逐点数据（第 1 张）</summary>\n")
        A(md_table(["输入 v", "实测 Y", "拟合 Y", "参与拟合"],
                   [[t["input"], t["measured_Y"], t["predicted_Y"], "✓" if t["used"] else "剔除"] for t in first]))
        A("</details>\n")

    A("## 5. CCM 色彩串扰矩阵\n")
    rows = []
    for r in ok:
        c = r.get("ccm") or {}
        rows.append([r["photo"], fmt(c.get("rms_linear"), 5), fmt(c.get("rms_encoded"), 5),
                     fmt(c.get("max_patch_err_8bit"), 2), c.get("n_patches", 0), c.get("status", "")])
    A(md_table(["照片", "线性域拟合RMS", "编码域拟合RMS", "单块最大误差(8bit)", "色块数", "状态"], rows))
    c0 = next((r.get("ccm") for r in ok if (r.get("ccm") or {}).get("M_linear")), None)
    if c0:
        A("**线性域 CCM**（measured_lin = M · known_lin + c）：\n")
        A("```\nM = \n" + np.array2string(np.array(c0["M_linear"]), precision=4, suppress_small=True)
          + "\nc = " + np.array2string(np.array(c0["c_linear"]), precision=5, suppress_small=True) + "\n```\n")
        A("**编码域 CCM**（解码器判色实际使用的是这一组）：\n")
        A("```\nM_enc = \n" + np.array2string(np.array(c0["M_encoded"]), precision=4, suppress_small=True)
          + "\nc_enc = " + np.array2string(np.array(c0["c_encoded"]), precision=5, suppress_small=True) + "\n```\n")
        if c0.get("table"):
            A("<details><summary>色块逐块数据（第 1 张）</summary>\n")
            A(md_table(["名称", "已知 sRGB", "实测 RGB", "拟合 RGB", "最大误差(8bit)"],
                       [[t["name"], str(t["known_rgb"]), str(t["measured_rgb"]),
                         str(t["predicted_rgb"]), t["err_8bit_max"]] for t in c0["table"][:30]]))
            A("</details>\n")

    A("## 6. Vignetting 暗角场与几何畸变\n")
    rows = []
    for r in ok:
        v = r.get("vignetting") or {}
        rows.append([r["photo"], fmt(v.get("k1"), 4), fmt(v.get("k2"), 4),
                     fmt(v.get("corner_loss_pct"), 2, "%"), fmt(v.get("edge_loss_pct"), 2, "%"),
                     fmt(v.get("distortion_max_screen_px"), 2),
                     fmt(v.get("distortion_rms_screen_px"), 2), v.get("status", "")])
    A(md_table(["照片", "k1", "k2", "角落衰减", "边缘中点衰减",
                "畸变最大(屏幕px)", "畸变RMS(屏幕px)", "状态"], rows))
    A("> 模型：gain(r) = 1 / (1 + k1·r² + k2·r⁴)，r=1 对应画面四角。\n")
    v0 = next((r.get("vignetting") for r in ok if (r.get("vignetting") or {}).get("copies")), None)
    if v0 and v0["copies"]:
        A(md_table(["位置", "r(归一化)", "中灰亮度(线性)", "白", "黑", "黑白跨度", "细条纹调制度"],
                   [[c["id"], fmt(c.get("r"), 3), fmt(c.get("gray_lin"), 5), fmt(c.get("white_lin"), 4),
                     fmt(c.get("black_lin"), 4), fmt(c.get("range_lin"), 4), fmt(c.get("stripe_mod"), 4)]
                    for c in v0["copies"]]))

    A("## 7. 噪声\n")
    A(md_table(["照片", "σ_Y (8bit)", "σ_Cb (8bit)", "σ_Cr (8bit)", "SNR(dB)", "平坦区", "ROI(px)", "状态"],
               [[r["photo"], fmt((r.get("noise") or {}).get("sigma_Y"), 3),
                 fmt((r.get("noise") or {}).get("sigma_Cb"), 3),
                 fmt((r.get("noise") or {}).get("sigma_Cr"), 3),
                 fmt((r.get("noise") or {}).get("snr_db"), 1),
                 (r.get("noise") or {}).get("patch_value", ""),
                 str((r.get("noise") or {}).get("roi_px", "")),
                 (r.get("noise") or {}).get("status", "")] for r in ok]))
    A("> 用二次曲面拟合去除暗角梯度后取残差标准差，避免把渐变误算成噪声。\n")

    A("## 8. 可复现性（多次拍摄一致性）\n")
    metrics = [("ρ", lambda r: r.get("rho"), 4),
               ("σ_PSF(屏幕px)", lambda r: (r.get("psf") or {}).get("sigma_screen"), 3),
               ("T_c(屏幕px)", lambda r: (r.get("stripes") or {}).get("t_c"), 3),
               ("γ", lambda r: (r.get("gamma") or {}).get("gamma"), 3),
               ("角落衰减%", lambda r: (r.get("vignetting") or {}).get("corner_loss_pct"), 2),
               ("σ_Y", lambda r: (r.get("noise") or {}).get("sigma_Y"), 3)]
    A(md_table(["指标", "均值", "标准差", "相对标准差", "样本数"],
               [[nm, fmt(m, nd), fmt(s, nd),
                 (f"{100*s/m:.1f}%" if (m and s and m != 0) else NA),
                 sum(1 for r in ok if f(r) is not None)]
                for nm, f, nd in metrics for m, s in [mean_std([f(r) for r in ok])]]))
    if len(ok) < 2:
        A("\n> 仅 1 张照片，无法评估可复现性（建议同一条件拍 3 张）。\n")

    # ---------------- 设计结论 ----------------
    A("\n## 9. 设计结论：数据单元到底能做多大？\n")
    rho = rho_m
    sigma = s_m
    tc = tc_m
    A("判定规则（同时满足三条，取最大值）：\n")
    A("1. **分辨率约束**：相邻单元构成周期 2d，需 2d ≥ T_c → `d ≥ T_c/2`")
    A("2. **模糊约束**：单元需 ≥ 3σ 才不至于被邻近单元串扰 → `d ≥ 3·σ_PSF`")
    A("3. **采样约束**：每个单元在摄像头上至少 3 个像素 → `d ≥ 3/ρ`\n")

    c1 = tc / 2.0 if tc else None
    c2 = 3.0 * sigma if sigma else None
    c3 = 3.0 / rho if rho else None
    A(md_table(["约束", "依据", "下限 d (屏幕px)"],
               [["分辨率", f"T_c/2 = {fmt(tc,2)}/2", fmt(c1, 2)],
                ["模糊", f"3σ = 3×{fmt(sigma,3)}", fmt(c2, 2)],
                ["采样", f"3/ρ = 3/{fmt(rho,4)}", fmt(c3, 2)]]))
    cand = [v for v in (c1, c2, c3) if v is not None]
    if cand:
        d_min = max(cand)
        d_rec = math.ceil(d_min * 1.5)          # 1.5 倍安全系数
        A(f"\n**d_min = {d_min:.2f} 屏幕像素；建议 d_rec = {d_rec} 屏幕像素（含 1.5× 安全系数）**\n")
        cw_, ch_ = layout["canvas"]["w"], layout["canvas"]["h"]
        A(md_table(["方案", "单元尺寸(屏幕px)", "全屏单元数", "备注"],
                   [["像素级 3×3 子格", 3, f"{cw_//3}×{ch_//3} = {(cw_//3)*(ch_//3):,}",
                     ("✅ 可行" if d_rec <= 3 else f"❌ 不可行（需 ≥ {d_rec}px）")],
                    ["8×8 符号（每符号像素 = d_rec）", 8 * d_rec,
                     f"{cw_//(8*d_rec)}×{ch_//(8*d_rec)} = {(cw_//(8*d_rec))*(ch_//(8*d_rec)):,}",
                     "符号内部最细特征 = d_rec 屏幕像素"],
                    ["统一色块（每块 = d_rec）", d_rec,
                     f"{cw_//d_rec}×{ch_//d_rec} = {(cw_//d_rec)*(ch_//d_rec):,}",
                     "纯颜色编码，无形状维度"]]))
        A("\n### 直接回答\n")
        if d_rec <= 3:
            A(f"- **像素级 3×3 子格编码可行**（d_min={d_min:.2f} ≤ 3）。")
        else:
            A(f"- **像素级 3×3 子格编码不可行**：该信道下单元至少需 {d_rec} 屏幕像素，"
              f"比 3×3 大了 {d_rec/3:.1f} 倍。")
        A(f"- 若采用 8×8 符号方案，符号内部最细特征需 ≥ d_rec={d_rec} 屏幕像素，"
          f"即**单个符号格子应渲染为 {8*d_rec}×{8*d_rec} 屏幕像素**。")
        if rho is not None and rho < 2:
            A(f"- ⚠ ρ={rho:.3f} < 2：屏幕**单像素级**细节会混叠，"
              "任何依赖 1 屏幕像素宽特征的方案都不可靠，请以 d_rec 为最小设计单位。")
        if rho is not None:
            A(f"- 每个 d_rec×d_rec 单元在摄像头上约覆盖 {d_rec*rho:.1f}×{d_rec*rho:.1f} 像素"
              f"（ρ={rho:.3f}），可支撑稳定的区域平均采样。")
    else:
        A("\n**未能确认**：T_c、σ_PSF、ρ 三者至少一项缺失，无法给出单元尺寸结论。"
          "请检查对应区域是否已拍摄且被正确检测（见 debug/ 下的可视化图）。\n")

    A("\n## 10. 输出文件\n")
    A("- `calibration.json`：供信道仿真器直接读取的机器可读结果")
    A("- `debug/<照片名>/`：每步测量的可视化校验图（**务必肉眼核对**）")
    A("  - `00_fiducials_try*.png` 四角定位标记检测（绿=候选，红=最终采用的 4 个）")
    A("  - `02_all_regions.png` 校正后全区域框选总览")
    A("  - `03_edge_fit.png` / `03_edge_roi.png` 斜边拟合与 ROI")
    A("  - `04_stripes.png` / `05_repeat_vignetting.png` / `06_gray.png` / `07_color.png` / `08_noise.png`")
    return "\n".join(L)


def build_calibration_json(results, layout, K):
    ok = [r for r in results if r.get("status") == "ok"]
    def agg(f, nd=6):
        m, s = mean_std([f(r) for r in ok])
        return {"value": (None if m is None else round(m, nd)),
                "std": (None if s is None else round(s, nd)),
                "n": sum(1 for r in ok if f(r) is not None)}
    psf = lambda k: (lambda r: (r.get("psf") or {}).get(k))
    st = lambda k: (lambda r: (r.get("stripes") or {}).get(k))
    ga = lambda k: (lambda r: (r.get("gamma") or {}).get(k))
    vi = lambda k: (lambda r: (r.get("vignetting") or {}).get(k))
    no = lambda k: (lambda r: (r.get("noise") or {}).get(k))

    rho = agg(lambda r: r.get("rho"))
    sigma = agg(psf("sigma_screen"))
    tc = agg(st("t_c"))
    d_min, d_rec = None, None
    cands = []
    if tc["value"]:
        cands.append(tc["value"] / 2.0)
    if sigma["value"]:
        cands.append(3.0 * sigma["value"])
    if rho["value"]:
        cands.append(3.0 / rho["value"])
    if cands:
        d_min = round(max(cands), 3)
        d_rec = int(math.ceil(max(cands) * 1.5))

    ccm0 = next((r.get("ccm") for r in ok if (r.get("ccm") or {}).get("M_linear")), {})
    return {
        "schema_version": 1,
        "generated": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
        "unit_note": "所有长度单位均为【屏幕像素】；NA/null 表示未能确认",
        "source": {
            "canvas": layout["canvas"],
            "ppi": layout.get("ppi"),
            "photos": [r["photo"] for r in results],
            "n_ok": len(ok)
        },
        "geometry": {
            "rho_camera_px_per_screen_px": rho,
            "rho_anisotropy": agg(lambda r: r.get("rho_anisotropy")),
            "reprojection_rms_screen_px": agg(lambda r: r.get("reprojection_rms_screen_px"))
        },
        "psf": {
            "sigma_screen_px": sigma,
            "sigma_moment_screen_px": agg(psf("sigma_moment_screen")),
            "fwhm_screen_px": agg(psf("fwhm_screen")),
            "mtf50_period_screen_px": agg(psf("mtf50_period")),
            "mtf_at_period_screen_px": {str(p): agg(lambda r, p=p: (r.get("psf") or {})
                                                    .get("mtf_at_period", {}).get(str(p)))
                                        for p in (2, 3, 4, 6, 8, 12, 16)}
        },
        "contrast": {
            "t_c_screen_px": tc,
            "T_c_definition": "相对对比度跌破 0.2 的临界条纹周期（取竖/横最差）"
        },
        "gamma": {
            "gamma": agg(ga("gamma")),
            "gain": agg(ga("gain")),
            "black_offset": agg(ga("black_offset")),
            "fit_rms": agg(ga("rms")),
            "model": "Y/255 = a * (v/255)^gamma + b"
        },
        "ccm": {
            "M_linear": ccm0.get("M_linear"),
            "c_linear": ccm0.get("c_linear"),
            "rms_linear": ccm0.get("rms_linear"),
            "M_encoded": ccm0.get("M_encoded"),
            "c_encoded": ccm0.get("c_encoded"),
            "rms_encoded": ccm0.get("rms_encoded"),
            "note": "measured = M @ known + c，known/measured 为 0..1；linear 域已做 sRGB EOTF"
        },
        "vignetting": {
            "k1": agg(vi("k1")), "k2": agg(vi("k2")),
            "rmax_screen_px": agg(vi("rmax_screen_px")),
            "corner_loss_percent": agg(vi("corner_loss_pct")),
            "edge_mid_loss_percent": agg(vi("edge_loss_pct")),
            "distortion_max_screen_px": agg(vi("distortion_max_screen_px")),
            "model": "gain(r) = 1 / (1 + k1*r^2 + k2*r^4), r=1 at corners"
        },
        "noise": {
            "sigma_Y_8bit": agg(no("sigma_Y")),
            "sigma_Cb_8bit": agg(no("sigma_Cb")),
            "sigma_Cr_8bit": agg(no("sigma_Cr")),
            "snr_db": agg(no("snr_db"))
        },
        "design": {
            "d_min_screen_px": d_min,
            "d_recommended_screen_px": d_rec,
            "rules": ["d >= T_c/2", "d >= 3*sigma_PSF", "d >= 3/rho", "safety factor 1.5"],
            "pixel_level_3x3_feasible": (d_rec is not None and d_rec <= 3)
        },
        "per_photo": results
    }


# --------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="光学信道标定分析")
    ap.add_argument("--layout", required=True, help="标定卡导出的 layout.json")
    ap.add_argument("--photos", nargs="+", required=True, help="拍摄的照片（可多张）")
    ap.add_argument("--outdir", default="output", help="输出目录")
    ap.add_argument("--supersample", type=int, default=4,
                    help="每屏幕像素的超采样像素数 K（默认 4）")
    ap.add_argument("--ppi-mm", type=float, default=None,
                    help="物理标尺实测毫米长度（用于把屏幕像素换算为毫米）")
    args = ap.parse_args()

    with open(args.layout, "r", encoding="utf-8") as f:
        layout = json.load(f)

    # PPI 换算：layout 内标尺长度为已知像素，实测毫米 → 每英寸屏幕像素数
    if args.ppi_mm and layout.get("ppi_line"):
        layout["ppi"] = layout["ppi_line"]["dev_len"] / (args.ppi_mm / 25.4)
        layout["ppi_mm"] = args.ppi_mm
        print(f"[PPI] 标尺 {layout['ppi_line']['dev_len']}px = {args.ppi_mm}mm "
              f"→ PPI = {layout['ppi']:.2f}")

    K = args.supersample
    cw, ch = layout["canvas"]["w"], layout["canvas"]["h"]
    while K > 1 and cw * ch * K * K > 40e6:      # 控制内存 <= ~40MP
        K -= 1
    os.makedirs(args.outdir, exist_ok=True)

    results = []
    for p in args.photos:
        print(f"[分析] {p}")
        try:
            r, _ = analyze_one(p, layout, args.outdir, K)
        except Exception as e:
            r = {"photo": os.path.basename(p), "status": f"异常: {e}"}
        results.append(r)
        print(f"        -> {r.get('status')}  rho={fmt(r.get('rho'), 4)}")

    report = build_report(results, layout, K, args)
    with open(os.path.join(args.outdir, "report.md"), "w", encoding="utf-8") as f:
        f.write(report)
    cal = build_calibration_json(results, layout, K)
    with open(os.path.join(args.outdir, "calibration.json"), "w", encoding="utf-8") as f:
        json.dump(cal, f, ensure_ascii=False, indent=2)

    print(f"\n[完成] 报告: {os.path.join(args.outdir, 'report.md')}")
    print(f"[完成] 标定: {os.path.join(args.outdir, 'calibration.json')}")
    print(f"[完成] 可视化: {os.path.join(args.outdir, 'debug')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
