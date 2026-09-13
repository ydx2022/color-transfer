// SVG 折线图（用于颜色位宽 vs BER / 净吞吐 曲线）。SVG 原生支持文字标注，比手绘 PNG 字体更清晰。
export interface Series {
  name: string;
  color: string;
  xs: number[];
  ys: number[];
}

export interface ChartOpts {
  title: string;
  xlabel: string;
  ylabel: string;
  series: Series[];
  ylog?: boolean;
  width?: number;
  height?: number;
}

function fmt(v: number): string {
  if (!isFinite(v)) return "0";
  if (v === 0) return "0";
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 1) return v.toFixed(2);
  return v.toExponential(1);
}

export function lineChartSvg(o: ChartOpts): string {
  const W = o.width ?? 640;
  const H = o.height ?? 420;
  const ml = 64;
  const mr = 20;
  const mt = 48;
  const mb = 56;
  const pw = W - ml - mr;
  const ph = H - mt - mb;

  // 数据范围
  let xmin = Infinity,
    xmax = -Infinity,
    ymin = Infinity,
    ymax = -Infinity;
  for (const s of o.series) {
    for (const x of s.xs) {
      if (x < xmin) xmin = x;
      if (x > xmax) xmax = x;
    }
    for (const y of s.ys) {
      const yy = o.ylog ? Math.max(1e-6, y) : y;
      if (yy < ymin) ymin = yy;
      if (yy > ymax) ymax = yy;
    }
  }
  if (!isFinite(xmin)) {
    xmin = 0;
    xmax = 1;
  }
  if (!isFinite(ymin)) {
    ymin = 0;
    ymax = 1;
  }
  if (o.ylog) {
    ymin = Math.min(ymin, 1e-4);
    ymax = Math.max(ymax, 1);
  } else {
    ymin = Math.min(ymin, 0);
  }
  const xr = xmax - xmin || 1;
  const yr = ymax - ymin || 1;

  const xOf = (x: number) => ml + ((x - xmin) / xr) * pw;
  const yOf = (y: number) => {
    if (o.ylog) {
      const ly = Math.log10(Math.max(1e-6, y));
      const lymin = Math.log10(ymin);
      const lymax = Math.log10(ymax);
      return mt + ph - ((ly - lymin) / (lymax - lymin)) * ph;
    }
    return mt + ph - ((y - ymin) / yr) * ph;
  };

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="PingFang SC, sans-serif">`);
  parts.push(`<rect width="${W}" height="${H}" fill="#0B0F1A"/>`);
  parts.push(`<text x="${W / 2}" y="26" fill="#E5E7EB" font-size="18" text-anchor="middle">${o.title}</text>`);

  // 坐标轴
  parts.push(`<line x1="${ml}" y1="${mt}" x2="${ml}" y2="${mt + ph}" stroke="#64748B"/>`);
  parts.push(`<line x1="${ml}" y1="${mt + ph}" x2="${ml + pw}" y2="${mt + ph}" stroke="#64748B"/>`);

  // x 刻度（整数位宽）
  for (let x = Math.ceil(xmin); x <= Math.floor(xmax); x++) {
    const px = xOf(x);
    parts.push(`<line x1="${px}" y1="${mt + ph}" x2="${px}" y2="${mt + ph + 4}" stroke="#64748B"/>`);
    parts.push(`<text x="${px}" y="${mt + ph + 18}" fill="#9CA3AF" font-size="12" text-anchor="middle">${x}</text>`);
  }
  // y 刻度
  const yticks = 5;
  for (let i = 0; i <= yticks; i++) {
    const yy = o.ylog ? ymin * Math.pow(ymax / ymin, i / yticks) : ymin + (yr * i) / yticks;
    const py = yOf(yy);
    parts.push(`<line x1="${ml - 4}" y1="${py}" x2="${ml}" y2="${py}" stroke="#64748B"/>`);
    parts.push(`<text x="${ml - 8}" y="${py + 4}" fill="#9CA3AF" font-size="12" text-anchor="end">${fmt(yy)}</text>`);
  }

  // 轴标题
  parts.push(`<text x="${ml + pw / 2}" y="${H - 14}" fill="#9CA3AF" font-size="13" text-anchor="middle">${o.xlabel}</text>`);
  parts.push(
    `<text x="16" y="${mt + ph / 2}" fill="#9CA3AF" font-size="13" text-anchor="middle" transform="rotate(-90 16 ${mt + ph / 2})">${o.ylabel}</text>`
  );

  // 折线
  for (const s of o.series) {
    const pts = s.xs.map((x, i) => `${xOf(x).toFixed(1)},${yOf(s.ys[i]).toFixed(1)}`).join(" ");
    parts.push(`<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2.5"/>`);
    for (let i = 0; i < s.xs.length; i++) {
      parts.push(`<circle cx="${xOf(s.xs[i]).toFixed(1)}" cy="${yOf(s.ys[i]).toFixed(1)}" r="3" fill="${s.color}"/>`);
    }
  }

  // 图例
  let lx = ml + 8;
  const ly = mt + 6;
  for (const s of o.series) {
    parts.push(`<line x1="${lx}" y1="${ly}" x2="${lx + 18}" y2="${ly}" stroke="${s.color}" stroke-width="2.5"/>`);
    parts.push(`<text x="${lx + 22}" y="${ly + 4}" fill="#E5E7EB" font-size="12">${s.name}</text>`);
    lx += 22 + s.name.length * 8 + 16;
  }

  parts.push(`</svg>`);
  return parts.join("\n");
}
