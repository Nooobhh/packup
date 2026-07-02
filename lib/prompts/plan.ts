import type { FilteredItem, GroundedPoi, TripInput } from "@/lib/pipeline/types";

export function buildPlanPrompt(args: {
  grounded: GroundedPoi[];
  upstreamFiltered: FilteredItem[];
  input: TripInput;
  distanceMatrix: unknown;
  routeSamples: unknown;
  validationError?: string;
  violations?: string[];
}) {
  return [
    `目的地: ${args.input.destination}`,
    `交通偏好: ${args.input.transport ?? "public"}`,
    `pace 数量映射: packed 5-7 / moderate 3-5 / relaxed 2-3 每日 POI。`,
    "裁决章程三层优先级: 1. 客观事实(营业时间、距离、耗时)不可违反; 2. 用户显式输入(dailyThemes 硬约束、transport、pace)优先; 3. 笔记建议(reason/timeHint)填补空隙。",
    "每日窗口 09:00-21:00, 总游览+交通不得超过 12h, 单段交通不得超过 90min。",
    "固定天数照排; 浮动 base±flex 选择最优并写 daysDecision; 缺省按内容量和 pace 推荐 cap 15 并写 daysDecision。",
    "dailyThemes 硬约束: 指定主题当天 POI 类型必须贴合, 多余忽略、缺失无主题并写 warning。",
    "非平凡取舍必须写 PlanItem.note; 容量装不下的 POI 输出 filtered(stage='plan')。",
    "距离矩阵为直线距离 ×1.4 折算参考:",
    JSON.stringify(args.distanceMatrix),
    "候选边真实路线样本:",
    JSON.stringify(args.routeSamples),
    `已过滤上游内容: ${JSON.stringify(args.upstreamFiltered)}`,
    `可排 POI: ${JSON.stringify(args.grounded)}`,
    args.validationError ? `上次输出未通过校验: ${args.validationError}` : "",
    args.violations?.length ? `上次行程违规,请局部重排: ${args.violations.join("; ")}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}
