// 信道质量评估（纯 TS、零 DOM）：由实测标定推算可解码档位，并给出 getChannelQuality()。
// 依据：d_min = max(T_c/2, 3σ_PSF, 3/ρ)，d_rec = ceil(d_min × 1.5 安全系数)。
import type { ChannelModel, ProfileName } from "../shared/types.ts";
import { loadChannelModel } from "./calibration.ts";

export function estimateDRec(model: ChannelModel): number {
  const dMin = Math.max(model.tC / 2, 3 * model.sigmaPsf, 3 / model.rho);
  return Math.ceil(dMin * 1.5);
}

// 由信道模型给出推荐档位
export function getChannelQuality(model: ChannelModel): ProfileName {
  const d = estimateDRec(model);
  if (d >= 13) return "safe";
  if (d >= 7) return "balanced";
  return "fast";
}

// 便捷：直接传标定组名（native / web_auto / web_locked）
export function getChannelQualityFromGroup(group: string): ProfileName {
  return getChannelQuality(loadChannelModel(group));
}
