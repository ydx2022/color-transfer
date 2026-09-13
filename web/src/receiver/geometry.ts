// 几何工具（纯 TS、零 DOM）：双线性采样、8 参数单应（DLT）、90° 整数旋转、格内采样。
import type { RGBAImage } from "./types.ts";

export function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// 双线性采样单像素（越界用边缘像素 clamp），返回 [r,g,b,a]
export function sampleBilinear(img: RGBAImage, x: number, y: number): [number, number, number, number] {
  const w = img.width;
  const h = img.height;
  const x0 = Math.max(0, Math.min(w - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(h - 1, Math.floor(y)));
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, x - x0));
  const fy = Math.max(0, Math.min(1, y - y0));
  const i00 = (y0 * w + x0) * 4;
  const i10 = (y0 * w + x1) * 4;
  const i01 = (y1 * w + x0) * 4;
  const i11 = (y1 * w + x1) * 4;
  const d = img.data;
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    const v00 = d[i00 + c];
    const v10 = d[i10 + c];
    const v01 = d[i01 + c];
    const v11 = d[i11 + c];
    const top = v00 + (v10 - v00) * fx;
    const bot = v01 + (v11 - v01) * fx;
    out[c] = top + (bot - top) * fy;
  }
  return out;
}

// 解 8x8 线性系统（高斯消元，部分主元）。A: number[n*n] 行主序，b: number[n]
function solveLinear(A: number[], b: number[], n: number): number[] {
  const M = A.slice();
  const x = b.slice();
  for (let col = 0; col < n; col++) {
    let piv = col;
    let best = Math.abs(M[col * n + col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(M[r * n + col]);
      if (v > best) {
        best = v;
        piv = r;
      }
    }
    if (piv !== col) {
      for (let k = col; k < n; k++) {
        const t = M[col * n + k];
        M[col * n + k] = M[piv * n + k];
        M[piv * n + k] = t;
      }
      const tb = x[col];
      x[col] = x[piv];
      x[piv] = tb;
    }
    const d = M[col * n + col] || 1e-9;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r * n + col] / d;
      if (f === 0) continue;
      for (let k = col; k < n; k++) M[r * n + k] -= f * M[col * n + k];
      x[r] -= f * x[col];
    }
  }
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) out[i] = x[i] / (M[i * n + i] || 1e-9);
  return out;
}

// 单应 H 映射网格坐标 (X,Y) -> 图像 (x,y)，h8=1。src/dst 各 4 点。
export function solveHomography(src: [number, number][], dst: [number, number][]): number[] {
  const A: number[] = new Array(64).fill(0);
  const b = new Array(8).fill(0);
  for (let i = 0; i < 4; i++) {
    const [X, Y] = src[i];
    const [x, y] = dst[i];
    const r = i * 2;
    A[r * 8 + 0] = X;
    A[r * 8 + 1] = Y;
    A[r * 8 + 2] = 1;
    A[r * 8 + 6] = -x * X;
    A[r * 8 + 7] = -x * Y;
    b[r] = x;
    const r2 = r + 1;
    A[r2 * 8 + 3] = X;
    A[r2 * 8 + 4] = Y;
    A[r2 * 8 + 5] = 1;
    A[r2 * 8 + 6] = -y * X;
    A[r2 * 8 + 7] = -y * Y;
    b[r2] = y;
  }
  return solveLinear(A, b, 8);
}

export function applyHomography(H: number[], X: number, Y: number): [number, number] {
  const denom = H[6] * X + H[7] * Y + 1;
  return [(H[0] * X + H[1] * Y + H[2]) / denom, (H[3] * X + H[4] * Y + H[5]) / denom];
}

// 把图像按 90° 整数倍顺时针旋转，返回新 RGBAImage（无插值，适合校正「躺倒竖图」）
export function rotateCW(img: RGBAImage, times: number): RGBAImage {
  const t = ((times % 4) + 4) % 4;
  if (t === 0) return { width: img.width, height: img.height, data: img.data.slice() };
  const swap = t % 2 === 1;
  const W = swap ? img.height : img.width;
  const Hh = swap ? img.width : img.height;
  const out = new Uint8ClampedArray(W * Hh * 4);
  const { width: w, height: h, data: d } = img;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      let dx = x;
      let dy = y;
      if (t === 1) {
        dx = h - 1 - y;
        dy = x;
      } else if (t === 2) {
        dx = w - 1 - x;
        dy = h - 1 - y;
      } else {
        dx = y;
        dy = w - 1 - x;
      }
      const o = (dy * W + dx) * 4;
      out[o] = d[s];
      out[o + 1] = d[s + 1];
      out[o + 2] = d[s + 2];
      out[o + 3] = d[s + 3];
    }
  }
  return { width: W, height: Hh, data: out };
}

// 采样某格内部 M×M 点（覆盖中心约 84% 区域，避开锚点/出血边），返回 RGB Float32（0..255）。
export function sampleCellRegion(
  img: RGBAImage,
  H: number[],
  gx: number,
  gy: number,
  M: number,
  margin = 0.47
): Float32Array {
  const buf = new Float32Array(M * M * 3);
  const lo = 0.5 - margin;
  const hi = 0.5 + margin;
  for (let j = 0; j < M; j++) {
    for (let i = 0; i < M; i++) {
      const u = lo + ((hi - lo) * i) / (M - 1);
      const v = lo + ((hi - lo) * j) / (M - 1);
      const [px, py] = applyHomography(H, gx - 0.5 + u, gy - 0.5 + v);
      const [r, g, b] = sampleBilinear(img, px, py);
      const o = (j * M + i) * 3;
      buf[o] = r;
      buf[o + 1] = g;
      buf[o + 2] = b;
    }
  }
  return buf;
}
