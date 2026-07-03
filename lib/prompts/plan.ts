import type { TripInput } from "@/lib/pipeline/types";

export type PlanViolationDetail = {
  day: number | string;
  metric: "day-total-min" | "segment-transport-min" | "backtrack-ratio";
  measured: number;
  threshold: number;
  segmentIndex?: number;
  message: string;
};

export type PlanPromptPoi = {
  id: string;
  name: string;
  type?: string;
  verified?: boolean;
  members?: string[];
  suggestedDuration?: string;
  reason?: string;
};

export function buildPlanPrompt(args: { slimPois: PlanPromptPoi[]; input: TripInput; distanceMatrix: unknown }) {
  return [
    `目的地: ${args.input.destination}`,
    `days: ${args.input.days ? `固定 ${args.input.days.base} 天` : "缺省,请推荐天数,cap 15"}`,
    `preferences: ${JSON.stringify(args.input.preferences ?? [])}`,
    "请只按 id 引用 POI,不要输出地点详情。",
    "输出 JSON: {days:[{theme?,slots:{morning:[poiId],afternoon:[poiId],evening:[poiId]}}],daysDecision?}",
    "slot 容量: morning<=2, afternoon<=3, evening<=2; cluster 组合点算 1 个。",
    "候选 POI:",
    JSON.stringify(args.slimPois),
    "近邻表:",
    JSON.stringify(args.distanceMatrix)
  ].join("\n");
}
