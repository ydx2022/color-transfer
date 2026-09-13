// 锚点定位 + 旋转自适应（纯 TS、零 DOM）。
// 帧布局：三主锚（左上/右上/左下）为白底黑心方块；缺右下角 → 由两邻边外推。
// 真机网页端存帧为「躺倒竖图」，先判旋转再把图像转正，几何退化为 0°。
import type { RGBAImage, Anchor } from "./types.ts";
import { luminance, rotateCW } from "./geometry.ts";

const WHITE_T = 235; // 锚点白底阈值（近 255）

// 连通域（4 邻域）找白色锚点。锚点 = 白底 + 居中暗方块；据此与「白底数据格」区分。
export function detectAnchors(img: RGBAImage): Anchor[] {
  const { width: w, height: h, data: d } = img;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (luminance(d[o], d[o + 1], d[o + 2]) > WHITE_T) mask[i] = 1;
  }
  const seen = new Uint8Array(w * h);
  const comps: Anchor[] = [];
  const stack: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (!mask[idx] || seen[idx]) continue;
      let cx = 0;
      let cy = 0;
      let area = 0;
      let minx = x;
      let maxx = x;
      let miny = y;
      let maxy = y;
      stack.length = 0;
      stack.push(idx);
      seen[idx] = 1;
      while (stack.length) {
        const p = stack.pop()!;
        const px = p % w;
        const py = (p / w) | 0;
        cx += px;
        cy += py;
        area++;
        if (px < minx) minx = px;
        if (px > maxx) maxx = px;
        if (py < miny) miny = py;
        if (py > maxy) maxy = py;
        if (px > 0 && mask[p - 1] && !seen[p - 1]) {
          seen[p - 1] = 1;
          stack.push(p - 1);
        }
        if (px < w - 1 && mask[p + 1] && !seen[p + 1]) {
          seen[p + 1] = 1;
          stack.push(p + 1);
        }
        if (py > 0 && mask[p - w] && !seen[p - w]) {
          seen[p - w] = 1;
          stack.push(p - w);
        }
        if (py < h - 1 && mask[p + w] && !seen[p + w]) {
          seen[p + w] = 1;
          stack.push(p + w);
        }
      }
      comps.push({ cx: cx / area, cy: cy / area, area, minx, maxx, miny, maxy } as Anchor & { minx: number; maxx: number; miny: number; maxy: number });
    }
  }
  if (comps.length === 0) return [];
  const top = comps[0].area;
  const anchors: Anchor[] = [];
  for (const c of comps) {
    if (c.area < top * 0.08) continue; // 滤掉小噪点
    const cc = c as Anchor & { minx: number; maxx: number; miny: number; maxy: number };
    const scaleEst = Math.sqrt(cc.area);
    const hs = Math.max(2, Math.floor(scaleEst * 0.3));
    const mx = Math.round((cc.minx + cc.maxx) / 2);
    const my = Math.round((cc.miny + cc.maxy) / 2);
    let dark = 0;
    let tot = 0;
    for (let yy = my - hs; yy <= my + hs; yy++) {
      for (let xx = mx - hs; xx <= mx + hs; xx++) {
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const o = (yy * w + xx) * 4;
        if (luminance(d[o], d[o + 1], d[o + 2]) < 100) dark++;
        tot++;
      }
    }
    if (tot > 0 && dark / tot > 0.5) anchors.push({ cx: cc.cx, cy: cc.cy, area: cc.area }); // 居中暗方块 → 真锚点
    if (anchors.length >= 3) break;
  }
  return anchors;
}

// 由 3 个锚点判定旋转角（0/90/180/270，顺时针为正）。
export function determineRotation(anchors: Anchor[]): number {
  if (anchors.length < 3) return 0;
  const [a, b, c] = anchors;
  // 找直角顶点（两向量夹角≈90°）
  const ang = (p: Anchor, q: Anchor, r: Anchor) => {
    const v1x = q.cx - p.cx;
    const v1y = q.cy - p.cy;
    const v2x = r.cx - p.cx;
    const v2y = r.cy - p.cy;
    const dot = v1x * v2x + v1y * v2y;
    const m1 = Math.hypot(v1x, v1y);
    const m2 = Math.hypot(v2x, v2y);
    return Math.acos(Math.max(-1, Math.min(1, dot / (m1 * m2 || 1))));
  };
  const aa = ang(a, b, c);
  const ab = ang(b, a, c);
  const ac = ang(c, a, b);
  const PI2 = Math.PI / 2;
  let common: Anchor;
  let o1: Anchor;
  let o2: Anchor;
  if (Math.abs(aa - PI2) < Math.abs(ab - PI2) && Math.abs(aa - PI2) < Math.abs(ac - PI2)) {
    common = a;
    o1 = b;
    o2 = c;
  } else if (Math.abs(ab - PI2) < Math.abs(ac - PI2)) {
    common = b;
    o1 = a;
    o2 = c;
  } else {
    common = c;
    o1 = a;
    o2 = b;
  }
  const minX = Math.min(o1.cx, o2.cx);
  const maxX = Math.max(o1.cx, o2.cx);
  const minY = Math.min(o1.cy, o2.cy);
  const maxY = Math.max(o1.cy, o2.cy);
  if (common.cx <= minX && common.cy <= minY) return 0; // 内容在 TL
  if (common.cx >= maxX && common.cy <= minY) return 90; // 内容在 TR
  if (common.cx >= maxX && common.cy >= maxY) return 180; // 内容在 BR
  return 270; // 内容在 BL
}

// 把图像按检测到的旋转转正（逆时针 -rotation）。
export function uprightImage(img: RGBAImage, rotation: number): RGBAImage {
  // 内容顺时针旋转了 rotation，则用顺时针 rotateCW 抵消：(4 - rotation/90) % 4 次
  return rotateCW(img, (4 - rotation / 90) % 4);
}

// 由（已转正的）3 锚点推算 4 图像角点：TL/TR/BL 来自锚点，BR 由两邻边外推。
export function cornersFromAnchors(anchors: Anchor[]): { TL: [number, number]; TR: [number, number]; BL: [number, number]; BR: [number, number] } {
  const sorted = anchors.slice().sort((p, q) => p.cx - q.cx || p.cy - q.cy);
  // 规格：TL=最小 x（且小 y）、TR=最大 x、BL=最大 y（且小 x）
  const byX = anchors.slice().sort((p, q) => p.cx - q.cx);
  const left = byX.slice(0, 2).sort((p, q) => p.cy - q.cy); // 两小 x 中按 y 排：TL, BL
  const right = byX.slice(2).sort((p, q) => p.cy - q.cy); // 余下为 TR（上）
  const TL = [left[0].cx, left[0].cy] as [number, number];
  const BL = [left[1].cx, left[1].cy] as [number, number];
  const TR = [right[0].cx, right[0].cy] as [number, number];
  const BR: [number, number] = [TL[0] + (TR[0] - TL[0]) + (BL[0] - TL[0]), TL[1] + (TR[1] - TL[1]) + (BL[1] - TL[1])];
  void sorted;
  return { TL, TR, BL, BR };
}
