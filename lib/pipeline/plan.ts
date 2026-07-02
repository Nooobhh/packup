import type { LLMRunner } from "@/lib/llm/types";
import type { MapProvider } from "@/lib/map/types";
import { buildPlanPrompt, type PlanViolationDetail } from "@/lib/prompts/plan";
import { backtrackRatio, haversineKm, nearestNeighborEdges } from "./geo";
import type { FilteredItem, GroundedPoi, LngLat, PlanDay, PlanItem, TripInput, TripPlan } from "./types";
import { FilteredItemSchema, TripPlanSchema } from "./types";

export async function runPlan(
  grounded: GroundedPoi[],
  upstreamFiltered: FilteredItem[],
  input: TripInput,
  llm: LLMRunner,
  map: MapProvider
): Promise<TripPlan> {
  const context = await buildContext(grounded, input, map);
  let plan = await callPlanner(grounded, upstreamFiltered, input, llm, context);
  plan = ensureDaysDecision(plan, input);
  plan = enforceFlexibleDayRange(plan, input);
  await fillAdjacentRoutes(plan, input, map);

  let violations = findViolations(plan);
  for (let repair = 0; violations.length > 0 && repair < 2; repair++) {
    const previousPlan = plan;
    plan = await callPlanner(grounded, upstreamFiltered, input, llm, context, undefined, violations, previousPlan);
    plan = ensureDaysDecision(enforceFlexibleDayRange(plan, input), input);
    await fillAdjacentRoutes(plan, input, map);
    violations = findViolations(plan);
  }

  if (violations.length > 0) {
    plan = await fallbackPlan(plan, input, map);
  }

  plan.filtered = [...upstreamFiltered, ...plan.filtered];
  addWarnings(plan, input);
  return TripPlanSchema.parse(plan);
}

async function buildContext(grounded: GroundedPoi[], input: TripInput, map: MapProvider) {
  const withLocations = grounded
    .filter((poi) => poi.verified && poi.location)
    .map((poi, index) => ({ id: poi.amapId ?? poi.id ?? `${poi.name}-${index}`, location: poi.location as LngLat, poi }));
  // 全量两两矩阵会撑爆排程 prompt(43 POI ≈ 900 对),LLM 只需要「谁和谁近」:
  // 每 POI 给 k=5 近邻(name + km),体积砍一个数量级。
  const matrix = withLocations.map((item) => ({
    name: item.poi.name,
    near: withLocations
      .filter((other) => other !== item)
      .map((other) => ({ name: other.poi.name, km: Number(haversineKm(item.location, other.location).toFixed(2)) }))
      .sort((a, b) => a.km - b.km)
      .slice(0, 5)
  }));
  const byId = new Map(withLocations.map((item) => [item.id, item]));
  const routeSamples = [];
  for (const edge of nearestNeighborEdges(withLocations, 2).slice(0, 15)) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) continue;
    const route = await map.route(from.location, to.location, input.transport ?? "public");
    routeSamples.push({ from: from.poi.name, to: to.poi.name, ...route });
  }
  return { matrix, routeSamples };
}

async function callPlanner(
  grounded: GroundedPoi[],
  upstreamFiltered: FilteredItem[],
  input: TripInput,
  llm: LLMRunner,
  context: { matrix: unknown; routeSamples: unknown },
  validationError?: string,
  violations?: PlanViolationDetail[],
  previousPlan?: TripPlan
): Promise<TripPlan> {
  let lastError = validationError;
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await llm.run({
      prompt: buildPlanPrompt({
        grounded,
        upstreamFiltered,
        input,
        distanceMatrix: context.matrix,
        routeSamples: context.routeSamples,
        validationError: lastError,
        violations,
        previousPlan
      }),
      jsonSchema: planJsonSchema,
      timeoutMs: 600_000
    });
    try {
      return rehydratePlanItems(TripPlanSchema.parse(JSON.parse(raw)), grounded);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt === 1) throw error;
    }
  }
  throw new Error("unreachable planner retry state");
}

function rehydratePlanItems(plan: TripPlan, grounded: GroundedPoi[]) {
  const byAmapId = new Map(grounded.filter((poi) => poi.amapId).map((poi) => [poi.amapId as string, poi]));
  const byName = new Map(grounded.map((poi) => [poi.name, poi]));
  const warnings = new Set(plan.warnings);

  for (const day of plan.days) {
    const kept: PlanItem[] = [];
    for (const item of day.items) {
      const amapId = item.poiId ?? item.poi?.amapId;
      const name = item.name ?? item.poi?.name;
      const source = (amapId ? byAmapId.get(amapId) : undefined) ?? (name ? byName.get(name) : undefined);
      if (!source) {
        warnings.add(`排程输出包含未经核实的条目已剔除: ${itemName(item)}`);
        continue;
      }
      kept.push({
        ...item,
        poiId: source.amapId ?? source.id ?? item.poiId,
        poi: source,
        name: source.name,
        type: source.type,
        address: source.address,
        openHours: source.openHours,
        verified: source.verified,
        location: source.location,
        reason: source.reason
      });
    }
    day.items = kept;
  }

  plan.warnings = Array.from(warnings);
  return plan;
}

async function fillAdjacentRoutes(plan: TripPlan, input: TripInput, map: MapProvider) {
  for (const day of plan.days) {
    for (const item of day.items) item.transportToNext = undefined;
    for (let i = 0; i < day.items.length - 1; i++) {
      const from = itemLocation(day.items[i]);
      const to = itemLocation(day.items[i + 1]);
      if (!from || !to) continue;
      const route = await map.route(from, to, input.transport ?? "public");
      day.items[i].transportToNext = { ...route, mode: input.transport ?? "public" };
    }
  }
}

function findViolations(plan: TripPlan) {
  const violations: PlanViolationDetail[] = [];
  for (const day of plan.days) {
    const label = day.index ?? day.day ?? "?";
    const total = day.items.reduce((sum, item) => sum + item.durationMin + (item.transportToNext?.durationMin ?? 0), 0);
    if (total > 720) {
      violations.push({
        day: label,
        metric: "day-total-min",
        measured: total,
        threshold: 720,
        message: `第 ${label} 天超载 ${total}min`
      });
    }
    day.items.forEach((item, index) => {
      const measured = item.transportToNext?.durationMin ?? 0;
      if (measured > 90) {
        violations.push({
          day: label,
          segmentIndex: index + 1,
          metric: "segment-transport-min",
          measured,
          threshold: 90,
          message: `第 ${label} 天第 ${index + 1} 段交通 ${measured}min 超过90min`
        });
      }
    });
    const points = day.items.map(itemLocation).filter(Boolean) as LngLat[];
    const ratio = backtrackRatio(points);
    if (ratio > 1.5) {
      violations.push({
        day: label,
        metric: "backtrack-ratio",
        measured: Number(ratio.toFixed(2)),
        threshold: 1.5,
        message: `第 ${label} 天折返比 ${ratio.toFixed(2)}`
      });
    }
  }
  return violations;
}

async function fallbackPlan(plan: TripPlan, input: TripInput, map: MapProvider) {
  const warnings = new Set(plan.warnings);
  for (const day of plan.days) {
    const points = day.items.map(itemLocation).filter(Boolean) as LngLat[];
    if (backtrackRatio(points) > 1.5) {
      day.items = nearestItemOrder(day.items);
      warnings.add("兜底: 已按最近邻重排折返日程");
    }
  }
  await fillAdjacentRoutes(plan, input, map);

  for (const day of plan.days) {
    while (findDayViolations(day).length > 0 && day.items.length > 0) {
      const removeIndex = lowestPriorityIndex(day.items);
      const [removed] = day.items.splice(removeIndex, 1);
      plan.filtered.push(
        FilteredItemSchema.parse({
          name: itemName(removed),
          sourceNoteId: removed.poi?.sourceNoteId,
          stage: "plan",
          reason: "超载兜底裁剪"
        })
      );
      warnings.add("兜底: 超载日程已裁剪 POI");
      await fillAdjacentRoutes(plan, input, map);
    }
  }
  plan.warnings = Array.from(warnings);
  return plan;
}

function findDayViolations(day: PlanDay) {
  const total = day.items.reduce((sum, item) => sum + item.durationMin + (item.transportToNext?.durationMin ?? 0), 0);
  const points = day.items.map(itemLocation).filter(Boolean) as LngLat[];
  return [
    total > 720 ? "overload" : "",
    day.items.some((item) => (item.transportToNext?.durationMin ?? 0) > 90) ? "long-segment" : "",
    backtrackRatio(points) > 1.5 ? "backtrack" : ""
  ].filter(Boolean);
}

function nearestItemOrder(items: PlanItem[]) {
  if (items.length < 3) return items;
  const ordered = [items[0]];
  const remaining = items.slice(1);
  while (remaining.length) {
    const current = itemLocation(ordered[ordered.length - 1]);
    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const next = itemLocation(remaining[i]);
      const distance = current && next ? Math.hypot(current.lng - next.lng, current.lat - next.lat) : Number.MAX_SAFE_INTEGER;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    ordered.push(remaining.splice(bestIndex, 1)[0]);
  }
  return ordered;
}

function lowestPriorityIndex(items: PlanItem[]) {
  let best = 0;
  let bestScore = Infinity;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const verified = item.verified ?? item.poi?.verified ?? true;
    const hasTimeHint = Boolean(item.poi?.timeHint);
    const score = (verified ? 10 : 0) + (hasTimeHint ? 5 : 0) - i / 100;
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

function ensureDaysDecision(plan: TripPlan, input: TripInput) {
  if (!input.days && !plan.daysDecision) {
    plan.daysDecision = { actualDays: plan.days.length, reason: `按内容量与 ${input.pace ?? "moderate"} 节奏推荐 ${plan.days.length} 天` };
  }
  if (input.days && (input.days.flex ?? 0) > 0 && !plan.daysDecision) {
    plan.daysDecision = {
      requested: `base ${input.days.base} flex ${input.days.flex ?? 0}`,
      actualDays: plan.days.length,
      reason: "在浮动范围内按 POI 容量选择"
    };
  }
  return plan;
}

function enforceFlexibleDayRange(plan: TripPlan, input: TripInput) {
  if (!input.days) return plan;
  const min = Math.max(1, input.days.base - (input.days.flex ?? 0));
  const max = input.days.base + (input.days.flex ?? 0);
  while (plan.days.length < min) plan.days.push({ index: plan.days.length + 1, items: [] });
  if (plan.days.length > max) {
    const removed = plan.days.splice(max);
    for (const day of removed) {
      for (const item of day.items) {
        plan.filtered.push(FilteredItemSchema.parse({ name: itemName(item), stage: "plan", reason: "浮动天数范围外裁剪" }));
      }
    }
  }
  return plan;
}

function addWarnings(plan: TripPlan, input: TripInput) {
  const warnings = new Set(plan.warnings);
  if (plan.days.some((day) => day.items.some((item) => (item.verified ?? item.poi?.verified) === false))) {
    warnings.add("未验证 POI 参与排程");
  }
  if (plan.days.some((day) => day.items.some((item) => !(item.openHours ?? item.poi?.openHours)))) {
    warnings.add("部分 POI openHours 缺失");
  }
  if (input.dailyThemes && input.dailyThemes.length !== plan.days.length) {
    warnings.add("主题数与实际天数不一致");
  }
  plan.warnings = Array.from(warnings);
}

function itemLocation(item: PlanItem): LngLat | undefined {
  return item.location ?? item.poi?.location;
}

function itemName(item: PlanItem) {
  return item.name ?? item.poi?.name ?? item.poiId ?? "未命名 POI";
}

const planJsonSchema = {
  type: "object",
  required: ["days", "filtered", "warnings"],
  properties: {
    days: {
      type: "array",
      items: {
        type: "object",
        required: ["items"],
        properties: {
          index: { type: "number" },
          day: { type: "number" },
          date: { type: "string" },
          theme: { type: "string" },
          items: {
            type: "array",
            items: {
              type: "object",
              required: ["name", "startTime", "durationMin"],
              properties: {
                name: { type: "string" },
                startTime: { type: "string" },
                durationMin: { type: "number" }
              }
            }
          }
        }
      }
    },
    filtered: { type: "array" },
    warnings: { type: "array" },
    daysDecision: {}
  }
};
