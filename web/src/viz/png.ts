// 纯 TS PNG 编码器（RGBA，无外部依赖，使用 Node zlib deflate）。用于可视化产出 PNG。
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface Canvas {
  width: number;
  height: number;
  data: Uint8Array; // RGBA, length = width*height*4
}

export function createCanvas(width: number, height: number): Canvas {
  const data = new Uint8Array(width * height * 4);
  data.fill(0); // 默认黑色、alpha=0；调用方通常整帧重绘
  return { width, height, data };
}

export function setPx(c: Canvas, x: number, y: number, r: number, g: number, b: number, a = 255): void {
  if (x < 0 || y < 0 || x >= c.width || y >= c.height) return;
  const i = (y * c.width + x) * 4;
  c.data[i] = r;
  c.data[i + 1] = g;
  c.data[i + 2] = b;
  c.data[i + 3] = a;
}

export function fillRect(c: Canvas, x: number, y: number, w: number, h: number, r: number, g: number, b: number, a = 255): void {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) setPx(c, xx, yy, r, g, b, a);
  }
}

// 抗锯齿混合单点（用于散点/连线端点）
export function blendPx(c: Canvas, x: number, y: number, r: number, g: number, b: number, a: number): void {
  if (x < 0 || y < 0 || x >= c.width || y >= c.height) return;
  const i = (y * c.width + x) * 4;
  const ia = a / 255;
  c.data[i] = Math.round(c.data[i] * (1 - ia) + r * ia);
  c.data[i + 1] = Math.round(c.data[i + 1] * (1 - ia) + g * ia);
  c.data[i + 2] = Math.round(c.data[i + 2] * (1 - ia) + b * ia);
  c.data[i + 3] = 255;
}

// 画水平/垂直直线（Bresenham）
export function drawLine(c: Canvas, x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number, a = 255): void {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    setPx(c, x0, y0, r, g, b, a);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

// ——— PNG 编码 ———
const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const cd = Buffer.concat([t, Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(new Uint8Array(cd)), 0);
  return Buffer.concat([len, cd, crc]);
}

export function savePng(path: string, c: Canvas): void {
  const { width, height, data } = c;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  // 每行前加 filter byte 0
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    const srcStart = y * width * 4;
    const dstStart = y * (width * 4 + 1) + 1;
    for (let x = 0; x < width * 4; x++) raw[dstStart + x] = data[srcStart + x];
  }
  const idat = deflateSync(raw, { level: 9 });
  const png = Buffer.concat([sig, chunk("IHDR", new Uint8Array(ihdr)), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))]);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png);
}
