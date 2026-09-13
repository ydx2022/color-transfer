#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
标定测试卡生成器（图像方案）

一次生成 chart_<W>x<H>.png + layout.json，两者严格同源——
不再依赖浏览器实时渲染/导出，杜绝窗口尺寸、缩放、dpr 引入的一切变数。

用法：
    python make_chart.py                        # 自动检测主屏设备分辨率
    python make_chart.py --width 1600 --height 1240
    python make_chart.py --outdir charts

显示：
    用浏览器打开 view_chart.html?img=charts/chart_<W>x<H>.png，按 F 全屏。
    查看器把 PNG 按 1:1 设备像素映射（image-rendering: pixelated），
    浏览器缩放/Windows 显示缩放都不会破坏像素对位。
    不要用看图软件直接打开拍摄用的 PNG——它们会"适应窗口"缩放，
    把 1px 条纹插值糊掉，摧毁测量。
"""

import argparse
import json
import math
import os
import sys

import numpy as np
import cv2

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
COLOR_NAMES = ["black", "white", "red", "green", "blue", "yellow", "cyan", "magenta",
               "n32", "n64", "n128", "n192", "n224",
               "dark-red", "dark-green", "dark-blue",
               "dk-yellow", "dk-cyan", "dk-magenta",
               "orange", "spring", "violet", "chartreuse", "azure"]


def clamp(v, a, b):
    return max(a, min(b, v))


# --------------------------------------------------------------------------
# 布局（与 chart.html 的 buildLayout 同一套自适应逻辑；高度随屏幕自适应）
# --------------------------------------------------------------------------
def build_layout(W, H, dpr=1.0, ruler_len=800):
    BG, GAP, GAP2 = 128, 24, 16
    RS = clamp(round(min(W, H) * 0.045), 36, 72)     # 重复图案副本边长
    F = clamp(round(min(W, H) * 0.075), 56, 130)     # 定位标记边长
    REP_INSET, FID_INSET = 8, 8 + RS + 18
    edge_h = clamp(round(H * 0.17), 150, 340)        # 斜边区高度（边线长度仍 >200px）
    cross = clamp(round(H * 0.05), 44, 64)           # 条纹短边
    hcap = clamp(round(H * 0.09), 80, 128)           # 横条纹最大长度（p=16 时 ≥5 周期）
    gray_h = clamp(round(H * 0.055), 44, 100)        # 灰阶块高度

    L = {
        "version": 1,
        "created": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
        "canvas": {"w": W, "h": H, "dpr": dpr,
                   "css_w": round(W / dpr), "css_h": round(H / dpr)},
        "background": BG,
        "ppi": None, "ppi_line": None,
        "fiducials": [],
        "regions": {"edge": None, "stripes": [], "gray": [], "color": [], "repeat": []},
        "notes": ("坐标单位 = 图像像素（1:1 显示时即屏幕设备像素）。"
                  "regions 内 x,y 为左上角。fiducials 为同心三方块(黑-白-黑)。"
                  "stripes.orientation: vertical=竖条(周期沿X)，horizontal=横条(周期沿Y)。")
    }

    # 定位标记（四角，内缩）
    for cid, x, y in [("tl", FID_INSET, FID_INSET),
                      ("tr", W - FID_INSET - F, FID_INSET),
                      ("bl", FID_INSET, H - FID_INSET - F),
                      ("br", W - FID_INSET - F, H - FID_INSET - F)]:
        L["fiducials"].append({"id": cid, "x": x, "y": y, "size": F})

    # 重复图案组：中心 + 四角 + 四边中点
    cx, cy = round((W - RS) / 2), round((H - RS) / 2)
    for cid, x, y in [("center", cx, cy),
                      ("tl", REP_INSET, REP_INSET),
                      ("tr", W - RS - REP_INSET, REP_INSET),
                      ("bl", REP_INSET, H - RS - REP_INSET),
                      ("br", W - RS - REP_INSET, H - RS - REP_INSET),
                      ("top", cx, REP_INSET), ("bottom", cx, H - RS - REP_INSET),
                      ("left", REP_INSET, cy), ("right", W - RS - REP_INSET, cy)]:
        L["regions"]["repeat"].append({"id": cid, "x": x, "y": y, "w": RS, "h": RS, "size": RS})

    # PPI 标尺：放在顶部"重复图案下缘 ↔ 定位标记上缘"的空隙带里，不占布局槽位
    band_top, band_bot = REP_INSET + RS, FID_INSET
    y_line = (band_top + band_bot) // 2
    L["ppi_line"] = {"x1": W // 2 - ruler_len // 2, "y1": y_line,
                     "x2": W // 2 - ruler_len // 2 + ruler_len, "y2": y_line,
                     "dev_len": ruler_len, "css_len": ruler_len / dpr}

    # 中央安全区（避开定位标记与正中重复图案副本）
    x0 = y0 = FID_INSET + F + GAP
    x1, y1 = W - x0, H - y0
    innerW, innerH = max(80, x1 - x0), max(80, y1 - y0)

    cy_mid = round(H / 2)
    topH = int(cy_mid - RS / 2 - 14 - y0)
    botY = int(cy_mid + RS / 2 + 14)
    botH = y1 - botY
    if topH > 90 and botH > 90:
        boxes = [{"x": x0, "y": y0, "w": innerW, "h": topH},
                 {"x": x0, "y": botY, "w": innerW, "h": botH}]
    else:
        boxes = [{"x": x0, "y": y0, "w": innerW, "h": innerH}]

    P = {"bi": 0, "cx": 0, "cy": 0, "rowH": 0}

    def place(w, h):
        while P["bi"] < len(boxes):
            b = boxes[P["bi"]]
            if w > b["w"]:
                P["bi"] += 1; P["cx"] = P["cy"] = P["rowH"] = 0; continue
            if P["cx"] + w > b["w"]:
                P["cx"] = 0; P["cy"] += P["rowH"] + GAP; P["rowH"] = 0
            if P["cy"] + h > b["h"]:
                P["bi"] += 1; P["cx"] = P["cy"] = P["rowH"] = 0; continue
            r = {"x": int(b["x"] + P["cx"]), "y": int(b["y"] + P["cy"]),
                 "w": int(w), "h": int(h)}
            P["cx"] += w + GAP
            P["rowH"] = max(P["rowH"], h)
            return r
        return None

    overflow = []

    # 1) 斜边区（ISO 12233，倾斜 5°）
    w_edge = min(max(240, round(innerW * 0.62)), innerW)
    r = place(w_edge, edge_h)
    if r:
        r["angle_deg"] = 5.0
        L["regions"]["edge"] = r
    else:
        overflow.append("edge")

    # 2) 多周期条纹组（竖条：周期沿X；横条：周期沿Y）
    lenOf = lambda p: max(72, min(p * 8, hcap))
    totalW = sum(lenOf(p) for p in PERIODS) + GAP2 * (len(PERIODS) - 1)
    if totalW <= innerW:
        r = place(totalW, cross)
        if r:
            sx = r["x"]
            for p in PERIODS:
                pw = lenOf(p)
                L["regions"]["stripes"].append({"id": f"sv_p{p}", "x": sx, "y": r["y"],
                                                "w": pw, "h": cross, "period": p,
                                                "orientation": "vertical"})
                sx += pw + GAP2
        else:
            overflow.append("stripes-vertical")
    else:
        idx = 0
        while idx < len(PERIODS):
            rowW, n = 0, 0
            while (idx + n < len(PERIODS) and
                   rowW + lenOf(PERIODS[idx + n]) + (GAP2 if n else 0) <= innerW):
                rowW += lenOf(PERIODS[idx + n]) + (GAP2 if n else 0)
                n += 1
            if n == 0:
                overflow.append("stripes-vertical"); break
            r = place(rowW, cross)
            if not r:
                overflow.append("stripes-vertical"); break
            sx = r["x"]
            for i in range(n):
                p = PERIODS[idx + i]; pw = lenOf(p)
                L["regions"]["stripes"].append({"id": f"sv_p{p}", "x": sx, "y": r["y"],
                                                "w": pw, "h": cross, "period": p,
                                                "orientation": "vertical"})
                sx += pw + GAP2
            idx += n
    colW = 64
    totalH = max(lenOf(p) for p in PERIODS)
    r = place(min(len(PERIODS) * colW + GAP2 * (len(PERIODS) - 1), innerW), totalH)
    if r:
        sx = r["x"]
        for p in PERIODS:
            L["regions"]["stripes"].append({"id": f"sh_p{p}", "x": sx, "y": r["y"],
                                            "w": colW, "h": lenOf(p), "period": p,
                                            "orientation": "horizontal"})
            sx += colW + GAP2
    else:
        overflow.append("stripes-horizontal")

    # 3) 灰阶级梯（32 级）
    gap4 = 4
    step = clamp((innerW - gap4 * (GRAY_STEPS - 1)) // GRAY_STEPS, 16, 48)
    totalW = step * GRAY_STEPS + gap4 * (GRAY_STEPS - 1)
    r = place(totalW, gray_h)
    if r:
        for i in range(GRAY_STEPS):
            v = round(i * 255 / (GRAY_STEPS - 1))
            L["regions"]["gray"].append({"id": f"g{i}", "x": r["x"] + i * (step + gap4),
                                         "y": r["y"], "w": step, "h": gray_h, "value": v})
    else:
        overflow.append("gray")

    # 4) 色块阵列（24 个已知 sRGB，优先单行以简化 CCM 径向校正）
    gapc = 10
    pw = clamp((innerW + gapc) // len(COLORS) - gapc, 36, 96)
    if pw >= 36:
        cols, rows = len(COLORS), 1
    else:                                   # 极窄屏幕退化为两行
        cols = len(COLORS) // 2
        pw = clamp((innerW + gapc) // cols - gapc, 36, 96)
        rows = -(-len(COLORS) // cols)
    totalW = cols * pw + (cols - 1) * gapc
    totalH = rows * pw + (rows - 1) * gapc
    r = place(totalW, totalH)
    if r:
        for i, c in enumerate(COLORS):
            L["regions"]["color"].append({"id": f"c{i}", "name": COLOR_NAMES[i],
                                          "x": r["x"] + (i % cols) * (pw + gapc),
                                          "y": r["y"] + (i // cols) * (pw + gapc),
                                          "w": pw, "h": pw, "rgb": c})
    else:
        overflow.append("color")

    L["overflow"] = overflow
    L["overlaps"] = check_overlap(L)
    return L


def _rects_intersect(a, b):
    return not (a["x"] + a["w"] <= b["x"] or b["x"] + b["w"] <= a["x"] or
                a["y"] + a["h"] <= b["y"] or b["y"] + b["h"] <= a["y"])


def check_overlap(L):
    """布局自检：任何两个测量区域都不允许重叠（旧项目曾栽在静默重叠上）。"""
    items = []
    for f in L["fiducials"]:
        items.append((f"fid_{f['id']}", {"x": f["x"], "y": f["y"],
                                         "w": f["size"], "h": f["size"]}))
    for r in L["regions"]["repeat"]:
        items.append((f"repeat_{r['id']}", r))
    if L["regions"]["edge"]:
        items.append(("edge", L["regions"]["edge"]))
    for s in L["regions"]["stripes"]:
        items.append((s["id"], s))
    for g in L["regions"]["gray"]:
        items.append((g["id"], g))
    for c in L["regions"]["color"]:
        items.append((c["id"], c))
    if L["ppi_line"]:
        pl = L["ppi_line"]
        items.append(("ppi_ruler", {"x": pl["x1"] - 24, "y": pl["y1"] - 8,
                                    "w": pl["dev_len"] + 48, "h": 16}))
    bad = []
    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            if _rects_intersect(items[i][1], items[j][1]):
                bad.append(f"{items[i][0]} x {items[j][0]}")
    return bad


# --------------------------------------------------------------------------
# 渲染（与 make_synthetic_test.render_screen 同一套绘制约定）
# --------------------------------------------------------------------------
def render(L):
    W, H = L["canvas"]["w"], L["canvas"]["h"]
    img = np.full((H, W, 3), L["background"], dtype=np.uint8)

    # 斜边（上白下黑硬边，无抗锯齿——模拟屏幕像素孔径）
    e = L["regions"]["edge"]
    if e:
        tan = math.tan(math.radians(e["angle_deg"]))
        midY, midX = e["y"] + e["h"] / 2.0, e["x"] + e["w"] / 2.0
        for x in range(e["x"], e["x"] + e["w"]):
            yc = int(round(midY + tan * (x - midX)))
            yc = max(e["y"] + 1, min(e["y"] + e["h"] - 1, yc))
            img[e["y"]:yc, x] = 255
            img[yc:e["y"] + e["h"], x] = 0
        cv2.rectangle(img, (e["x"] + 1, e["y"] + 1),
                      (e["x"] + e["w"] - 2, e["y"] + e["h"] - 2), (255, 0, 0), 2)

    # 条纹
    for s in L["regions"]["stripes"]:
        x, y, w, h, p = s["x"], s["y"], s["w"], s["h"], s["period"]
        if s["orientation"] == "vertical":
            idx = np.arange(w) // p
            row = np.where((idx % 2) == 0, 255, 0).astype(np.uint8)
            img[y:y + h, x:x + w] = np.repeat(row[None, :], h, axis=0)[:, :, None]
        else:
            idy = np.arange(h) // p
            col = np.where((idy % 2) == 0, 255, 0).astype(np.uint8)
            img[y:y + h, x:x + w] = np.repeat(col[:, None], w, axis=1)[:, :, None]
        cv2.rectangle(img, (x, y), (x + w - 1, y + h - 1), (255, 0, 0), 1)

    # 灰阶 / 色块
    for g in L["regions"]["gray"]:
        img[g["y"]:g["y"] + g["h"], g["x"]:g["x"] + g["w"]] = g["value"]
    for c in L["regions"]["color"]:
        img[c["y"]:c["y"] + c["h"], c["x"]:c["x"] + c["w"]] = c["rgb"]

    # 物理标尺（白线 + 端点刻度，位于顶部空隙带）
    pl = L["ppi_line"]
    if pl:
        cv2.line(img, (pl["x1"], pl["y1"]), (pl["x2"], pl["y2"]), (255, 255, 255), 3)
        for xx in (pl["x1"], pl["x2"]):
            cv2.line(img, (xx, pl["y1"] - 8), (xx, pl["y1"] + 8), (255, 255, 255), 3)

    # 重复图案（左上中灰 / 右上 2px 条纹 / 左下黑 / 右下白）
    for r in L["regions"]["repeat"]:
        q = r["w"] // 2
        img[r["y"]:r["y"] + q, r["x"]:r["x"] + q] = 128
        idx = np.arange(q) // 2
        row = np.where((idx % 2) == 0, 255, 0).astype(np.uint8)
        img[r["y"]:r["y"] + q, r["x"] + q:r["x"] + q + q] = \
            np.repeat(row[None, :], q, axis=0)[:, :, None]
        img[r["y"] + q:r["y"] + r["h"], r["x"]:r["x"] + q] = 0
        img[r["y"] + q:r["y"] + r["h"], r["x"] + q:r["x"] + r["w"]] = 255
        cv2.rectangle(img, (r["x"], r["y"]), (r["x"] + r["w"] - 1, r["y"] + r["h"] - 1),
                      (255, 0, 0), 1)

    # 定位标记（同心三方块，最上层）
    for f in L["fiducials"]:
        cxf, cyf = f["x"] + f["size"] / 2.0, f["y"] + f["size"] / 2.0
        for size, col in ((f["size"], 0), (f["size"] * 0.62, 255), (f["size"] * 0.28, 0)):
            s2 = int(round(size))
            xa = int(round(cxf - s2 / 2.0)); ya = int(round(cyf - s2 / 2.0))
            img[ya:ya + s2, xa:xa + s2] = col
    return img


# --------------------------------------------------------------------------
def detect_screen():
    """Windows 下自动检测主屏设备分辨率与 dpr（失败则返回 None）。"""
    try:
        import ctypes
        try:
            ctypes.windll.shcore.SetProcessDpiAwareness(2)
        except Exception:
            pass
        w = ctypes.windll.user32.GetSystemMetrics(0)
        h = ctypes.windll.user32.GetSystemMetrics(1)
        try:
            dpr = ctypes.windll.user32.GetDpiForSystem() / 96.0
        except Exception:
            dpr = 1.0
        return int(w), int(h), float(dpr)
    except Exception:
        return None


def imwrite_any(path, rgb):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    ok, buf = cv2.imencode(os.path.splitext(path)[1] or ".png",
                           cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))
    if not ok:
        raise IOError(f"无法写出图片: {path}")
    buf.tofile(path)


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    ap = argparse.ArgumentParser(description="生成标定测试卡 PNG + layout.json（严格同源）")
    ap.add_argument("--width", type=int, default=None, help="图像宽（默认自动检测主屏）")
    ap.add_argument("--height", type=int, default=None, help="图像高（默认自动检测主屏）")
    ap.add_argument("--dpr", type=float, default=None, help="设备像素比（默认自动检测）")
    ap.add_argument("--outdir", default="charts", help="输出目录")
    ap.add_argument("--ruler-len", type=int, default=800, help="PPI 标尺长度（像素）")
    ap.add_argument("--name", default=None, help="输出文件名前缀（默认 chart_<W>x<H>）")
    args = ap.parse_args()

    scr = detect_screen()
    if args.width and args.height:
        W, H = args.width, args.height
    elif scr:
        W, H = scr[0], scr[1]
    else:
        W, H = 1600, 1240
    dpr = args.dpr if args.dpr else (scr[2] if scr else 1.0)

    L = build_layout(W, H, dpr, args.ruler_len)
    img = render(L)

    os.makedirs(args.outdir, exist_ok=True)
    name = args.name or f"chart_{W}x{H}"
    png_path = os.path.join(args.outdir, name + ".png")
    json_path = os.path.join(args.outdir, name + ".layout.json")
    imwrite_any(png_path, img)
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(L, f, ensure_ascii=False, indent=2)

    # 额外写一份固定名字的 chart.png，让 view_chart.html 无 ?img= 参数也能直接命中
    import shutil
    fixed_png = os.path.join(args.outdir, "chart.png")
    shutil.copyfile(png_path, fixed_png)
    print(f"[生成] {fixed_png}  (固定名，供 view_chart.html 默认加载)")

    reg = L["regions"]
    print(f"[生成] {png_path}  ({W}x{H}, dpr={dpr})")
    print(f"[生成] {json_path}")
    print(f"区域：斜边={1 if reg['edge'] else 0} 条纹={len(reg['stripes'])} "
          f"灰阶={len(reg['gray'])} 色块={len(reg['color'])} 重复={len(reg['repeat'])} "
          f"定位标记={len(L['fiducials'])} 标尺={'有' if L['ppi_line'] else '无'}")
    if L["overflow"]:
        print(f"!! 放不下的区域：{', '.join(L['overflow'])} —— 请增大图像尺寸")
    if L["overlaps"]:
        print(f"!! 检测到区域重叠：{', '.join(L['overlaps'])} —— 请修复布局")
        return 1
    print("布局自检通过：无区域重叠。")
    print(f"下一步：浏览器打开 view_chart.html?img={png_path.replace(os.sep, '/')}，按 F 全屏。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
