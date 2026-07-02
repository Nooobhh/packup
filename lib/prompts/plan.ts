import type { FilteredItem, GroundedPoi, TripInput, TripPlan } from "@/lib/pipeline/types";

export type PlanViolationDetail = {
  day: number | string;
  metric: "day-total-min" | "segment-transport-min" | "backtrack-ratio";
  measured: number;
  threshold: number;
  segmentIndex?: number;
  message: string;
};

export function buildPlanPrompt(args: {
  grounded: GroundedPoi[];
  upstreamFiltered: FilteredItem[];
  input: TripInput;
  distanceMatrix: unknown;
  routeSamples: unknown;
  validationError?: string;
  violations?: PlanViolationDetail[];
  previousPlan?: TripPlan;
}) {
  return [
    `目的地: ${args.input.destination}`,
    `交通偏好: ${args.input.transport ?? "public"}`,
    renderDaysInput(args.input),
    renderPaceInput(args.input),
    renderDailyThemes(args.input),
    renderStartDate(args.input),
    "pace 数量映射: packed 5-7 / moderate 3-5 / relaxed 2-3 每日 POI。",
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
    args.previousPlan ? `上一版 TripPlan: ${JSON.stringify(compactPlan(args.previousPlan))}` : "",
    args.violations?.length ? `结构化违规明细: ${JSON.stringify(args.violations)}` : "",
    args.violations?.length ? "修复指令: 保留未违规天/段,仅重排违规部分。" : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function renderDaysInput(input: TripInput) {
  if (!input.days) return "days=缺省; 指令=按内容量推荐天数,cap 15,并写 daysDecision";
  const flex = input.days.flex ?? 0;
  if (flex > 0) {
    return `days.base=${input.days.base}; days.flex=${flex}; 实际天数范围 ${Math.max(1, input.days.base - flex)}-${input.days.base + flex}`;
  }
  return `days.base=${input.days.base}; days.flex=0; 固定天数=${input.days.base}`;
}

function renderPaceInput(input: TripInput) {
  const pace = input.pace ?? "moderate";
  const ranges = { packed: "packed 5-7", moderate: "moderate 3-5", relaxed: "relaxed 2-3" };
  return `pace=${pace}; selectedRange=${ranges[pace]}`;
}

function renderDailyThemes(input: TripInput) {
  if (!input.days) return "dailyThemes: days 缺省,不可指定逐日主题";
  return Array.from({ length: input.days.base }, (_, index) => {
    const theme = input.dailyThemes?.[index] || "无主题";
    return `Day ${index + 1}: 主题=${theme}`;
  }).join("\n");
}

function renderStartDate(input: TripInput) {
  if (!input.startDate || !input.days) return "startDate=未提供";
  return [
    `startDate=${input.startDate}`,
    ...Array.from({ length: input.days.base }, (_, index) => {
      const date = addDays(input.startDate!, index);
      return `Day ${index + 1}: 日期=${date} ${weekdayZh(date)}`;
    })
  ].join("\n");
}

function addDays(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekdayZh(isoDate: string) {
  const names = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  return names[new Date(`${isoDate}T00:00:00.000Z`).getUTCDay()];
}

function compactPlan(plan: TripPlan) {
  return {
    days: plan.days.map((day) => ({
      index: day.index ?? day.day,
      items: day.items.map((item) => ({
        name: item.name ?? item.poi?.name,
        startTime: item.startTime,
        durationMin: item.durationMin,
        transportToNext: item.transportToNext
      }))
    }))
  };
}
