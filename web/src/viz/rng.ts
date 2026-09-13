// 可种子化 RNG（mulberry32），保证可视化与仿真可复现。
import type { Rng } from "../core/channelSim.ts";

export function mulberry32(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
