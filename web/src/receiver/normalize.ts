// 局部增益归一化（纯 TS、零 DOM）。
// 用密集校准格（已知红/绿两色，parity 0/1）估计每格增益；再双线性插值到数据格，
// 抵消实测的非径向亮度梯度与全局/局部曝光差异。这是「真解校准格→应用到邻近数据格」的实装。

export interface CalibSample {
  c: number;
  r: number;
  measured: [number, number, number]; // 0..1
  expected: [number, number, number]; // 0..1（来自调色板 + parity）
}

// 由校准格样本拟合一个规则网格上的增益场，并对任意 (c,r) 双线性插值出增益 [gr,gg,gb]。
export class GainField {
  private cols = 0;
  private rows = 0;
  private grid: ([number, number, number] | null)[] = []; // 每格增益（null=无校准格）

  fit(samples: CalibSample[], cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    this.grid = new Array(cols * rows).fill(null);
    for (const s of samples) {
      const g: [number, number, number] = [
        s.measured[0] / (s.expected[0] || 1e-6),
        s.measured[1] / (s.expected[1] || 1e-6),
        s.measured[2] / (s.expected[2] || 1e-6)
      ];
      this.grid[s.r * cols + s.c] = g;
    }
  }

  // 双线性插值增益；若邻域无校准格则回退 1（不校正）。
  gainAt(c: number, r: number): [number, number, number] {
    if (this.cols === 0) return [1, 1, 1];
    const pts: [number, number][] = [
      [Math.floor(c), Math.floor(r)],
      [Math.floor(c) + 1, Math.floor(r)],
      [Math.floor(c), Math.floor(r) + 1],
      [Math.floor(c) + 1, Math.floor(r) + 1]
    ];
    const wx = c - Math.floor(c);
    const wy = r - Math.floor(r);
    let acc: [number, number, number] = [0, 0, 0];
    let wsum = 0;
    const wts = [(1 - wx) * (1 - wy), wx * (1 - wy), (1 - wx) * wy, wx * wy];
    for (let i = 0; i < 4; i++) {
      const [pc, pr] = pts[i];
      if (pc < 0 || pr < 0 || pc >= this.cols || pr >= this.rows) continue;
      const g = this.grid[pr * this.cols + pc];
      if (!g) continue;
      const w = wts[i];
      acc[0] += g[0] * w;
      acc[1] += g[1] * w;
      acc[2] += g[2] * w;
      wsum += w;
    }
    if (wsum < 1e-6) return [1, 1, 1];
    return [acc[0] / wsum, acc[1] / wsum, acc[2] / wsum];
  }
}
