import type { MapProvider } from "@/lib/map/types";
import { runForStage } from "@/lib/llm/router";
import { buildPlanPrompt, type PlanPromptPoi, type PlanViolationDetail } from "@/lib/prompts/plan";
import { BUDGETS } from "./budgets";
import { backtrackRatio, clusterByDistance, haversineKm } from "./geo";
import type { FilteredItem, GroundedPoi, LngLat, PlanDay, PlanItem, Slot, TransportPrefs, TripInput, TripPlan } from "./types";
import { FilteredItemSchema, TripPlanSchema } from "./types";

const SLOT_ORDER: Slot[] = ["morning", "afternoon", "evening"];
const DEFAULT_DURATION: Record<string, number> = {
  sight: 90,
  food: 60,
  shop: 45,
  stay: 30,
  experience: 120,
  other: 60
};

type PlannerOutput = {
  days: Array<{ theme?: string; slots: Record<Slot, string[]> }>;
  daysDecision?: TripPlan["daysDecision"];
};

export async function runPlan(
  grounded: GroundedPoi[],
  upstreamFiltered: FilteredItem[],
  input: TripInput,
  map: MapProvider
): Promise<TripPlan> {
  const { kept, budgetFiltered } = budgetPois(grounded, input);
  const preFiltered = [...upstreamFiltered, ...budgetFiltered];
  const clusters = clusterByDistance(kept.map((poi) => ({ id: poiKey(poi), location: poi.location })));
  const clusterGroups = groupByCluster(kept, clusters);
  const context = buildContext(clusterGroups);

  let warnings: string[] = [];
  let planner: PlannerOutput | undefined;
  try {
    planner = await callPlanner(context.slimPois, input, context.matrix);
  } catch {
    warnings.push("LLM 分天失败,已按地理就近自动分配");
  }

  let plan = planner ? rehydratePlannerOutput(planner, kept, clusters, clusterGroups) : fallbackFromGrounded(kept, input, clusters, clusterGroups);
  if (planner && allDaysEmpty(plan) && kept.length > 0) {
    plan = fallbackFromGrounded(kept, input, clusters, clusterGroups);
    warnings.push("LLM 分天失败,已按地理就近自动分配");
  }

  for (const day of plan.days) orderDaySlots(day);
  plan = ensureDaysDecision(plan, input);
  plan = enforceFlexibleDayRange(plan, input);
  plan.filtered = [...preFiltered, ...plan.filtered];
  plan.warnings = [...warnings, ...plan.warnings];

  await fillAdjacentRoutes(plan, input, map);
  const violations = findViolations(plan);
  if (violations.length > 0) {
    plan = await fallbackPlan(plan, input, map);
  }
  addWarnings(plan, input);
  return TripPlanSchema.parse(plan);
}

function budgetPois(grounded: GroundedPoi[], input: TripInput): { kept: GroundedPoi[]; budgetFiltered: FilteredItem[] } {
  const perDayMax = input.pace === "packed" ? 7 : input.pace === "relaxed" ? 3 : 5;
  const days = input.days ? input.days.base + (input.days.flex ?? 0) : 4;
  const budget = Math.ceil(perDayMax * days * 1.5);
  if (grounded.length <= budget) return { kept: grounded, budgetFiltered: [] };

  const score = (p: GroundedPoi) => (p.verified ? 4 : 0) + (p.timeHint ? 2 : 0) + (p.reason ? 1 : 0);
  const ranked = [...grounded].map((poi, index) => ({ poi, index, score: score(poi) })).sort((a, b) => b.score - a.score || a.index - b.index);
  const kept = ranked.slice(0, budget).sort((a, b) => a.index - b.index).map((item) => item.poi);
  const budgetFiltered = ranked.slice(budget).map((item) =>
    FilteredItemSchema.parse({
      name: item.poi.name,
      sourceNoteId: item.poi.sourceNoteId,
      stage: "plan",
      reason: `候选 POI 超出 ${days} 天行程容量,优先级较低未纳入排程`,
      why: `候选 POI 超出 ${days} 天行程容量,优先级较低未纳入排程`
    })
  );
  return { kept, budgetFiltered };
}

function buildContext(clusterGroups: Map<string, GroundedPoi[]>) {
  const representatives = Array.from(clusterGroups, ([id, members]) => ({ id, members, location: firstLocation(members) }));
  const matrix = representatives
    .filter((item): item is typeof item & { location: LngLat } => Boolean(item.location))
    .map((item) => ({
      id: item.id,
      name: item.members.map((member) => member.name).join(" + "),
      near: representatives
        .filter((other): other is typeof other & { location: LngLat } => other !== item && Boolean(other.location))
        .map((other) => ({ id: other.id, name: other.members.map((member) => member.name).join(" + "), km: Number(haversineKm(item.location, other.location).toFixed(2)) }))
        .sort((a, b) => a.km - b.km)
        .slice(0, 5)
    }));
  const slimPois: PlanPromptPoi[] = representatives.map(({ id, members }) => ({
    id,
    name: members.map((member) => member.name).join(" + "),
    type: members[0]?.type,
    verified: members.every((member) => member.verified),
    members: members.map((member) => member.name),
    suggestedDuration: members.find((member) => member.suggestedDuration)?.suggestedDuration,
    reason: members.map((member) => member.reason).join(" / ").slice(0, 100)
  }));
  return { matrix, slimPois };
}

async function callPlanner(slimPois: PlanPromptPoi[], input: TripInput, distanceMatrix: unknown): Promise<PlannerOutput> {
  const raw = await runForStage("plan", {
    prompt: buildPlanPrompt({ slimPois, input, distanceMatrix }),
    jsonSchema: planJsonSchema,
    timeoutMs: BUDGETS.planLlmMs
  });
  const parsed = JSON.parse(raw) as PlannerOutput;
  if (!Array.isArray(parsed.days)) throw new Error("planner days missing");
  return {
    days: parsed.days.map((day) => ({
      theme: day.theme,
      slots: {
        morning: Array.isArray(day.slots?.morning) ? day.slots.morning : [],
        afternoon: Array.isArray(day.slots?.afternoon) ? day.slots.afternoon : [],
        evening: Array.isArray(day.slots?.evening) ? day.slots.evening : []
      }
    })),
    daysDecision: parsed.daysDecision
  };
}

function rehydratePlannerOutput(
  planner: PlannerOutput,
  grounded: GroundedPoi[],
  clusters: Map<string, string>,
  clusterGroups: Map<string, GroundedPoi[]>
): TripPlan {
  const byId = new Map<string, GroundedPoi>();
  for (const poi of grounded) {
    byId.set(poiKey(poi), poi);
    if (poi.amapId) byId.set(poi.amapId, poi);
    byId.set(poi.name, poi);
  }
  const warnings = new Set<string>();
  const used = new Set<string>();
  const days = planner.days.map((day, dayIndex): PlanDay => {
    const items: PlanItem[] = [];
    for (const slot of SLOT_ORDER) {
      for (const ref of day.slots[slot] ?? []) {
        const members = clusterGroups.get(ref) ?? (byId.get(ref) ? clusterGroups.get(clusters.get(byId.get(ref)!.id ?? byId.get(ref)!.amapId ?? byId.get(ref)!.name) ?? "") : undefined);
        if (!members) {
          warnings.add(`排程输出包含未经核实的 id 已剔除: ${ref}`);
          continue;
        }
        for (const poi of members) {
          const key = poiKey(poi);
          if (used.has(key)) continue;
          used.add(key);
          items.push(planItemFromPoi(poi, slot, clusters.get(key) ?? key));
        }
      }
    }
    return { index: dayIndex + 1, theme: day.theme, items };
  });
  return { days, pool: [], filtered: [], warnings: Array.from(warnings), daysDecision: planner.daysDecision };
}

function fallbackFromGrounded(
  grounded: GroundedPoi[],
  input: TripInput,
  clusters: Map<string, string>,
  clusterGroups: Map<string, GroundedPoi[]>
): TripPlan {
  const dayCount = Math.max(1, input.days?.base ?? Math.min(15, Math.max(1, Math.ceil(clusterGroups.size / 5))));
  const orderedGroups = nearestGroupOrder(Array.from(clusterGroups.entries()));
  const days: PlanDay[] = Array.from({ length: dayCount }, (_, index) => ({ index: index + 1, items: [] }));
  orderedGroups.forEach(([clusterKey, members], groupIndex) => {
    const day = days[groupIndex % dayCount];
    const slot = SLOT_ORDER[Math.min(2, Math.floor(day.items.length / 2))];
    for (const poi of members) {
      const key = poiKey(poi);
      day.items.push(planItemFromPoi(poi, slot, clusters.get(key) ?? clusterKey));
    }
  });
  if (grounded.length > 0 && days.every((day) => day.items.length === 0)) {
    const first = grounded[0];
    const key = poiKey(first);
    days[0].items.push(planItemFromPoi(first, "morning", clusters.get(key) ?? key));
  }
  return { days, pool: [], filtered: [], warnings: [] };
}

export function planItemFromPoi(poi: GroundedPoi, slot: Slot, clusterKey: string): PlanItem {
  return {
    id: poi.id ?? poi.amapId ?? poi.name,
    poiId: poi.id ?? poi.amapId ?? poi.name,
    poi,
    name: poi.name,
    type: poi.type,
    slot,
    clusterKey,
    durationMin: durationForPoi(poi),
    address: poi.address,
    openHours: poi.openHours,
    verified: poi.verified,
    location: poi.location,
    reason: poi.reason
  };
}

function durationForPoi(poi: GroundedPoi) {
  const text = poi.suggestedDuration ?? "";
  const hours = text.match(/(\d+(?:\.\d+)?)\s*(小时|h)/i);
  if (hours) return Math.round(Number(hours[1]) * 60);
  const minutes = text.match(/(\d+)\s*(分钟|min)/i);
  if (minutes) return Number(minutes[1]);
  return DEFAULT_DURATION[poi.type] ?? DEFAULT_DURATION.other;
}

function orderDaySlots(day: PlanDay) {
  const ordered: PlanItem[] = [];
  for (const slot of SLOT_ORDER) {
    const items = day.items.filter((item) => item.slot === slot);
    ordered.push(...nearestClusterOrder(items, ordered.at(-1)).flatMap((group) => group.items));
  }
  day.items = ordered;
}

async function fillAdjacentRoutes(plan: TripPlan, input: TripInput, map: MapProvider) {
  const deadline = Date.now() + BUDGETS.planRoutesMs;
  for (const day of plan.days) {
    for (const item of day.items) item.transportToNext = undefined;
    for (let i = 0; i < day.items.length - 1; i++) {
      const route = await recommendLegTransport(day.items[i], day.items[i + 1], input, map, deadline);
      if (route) day.items[i].transportToNext = route;
    }
  }
}

export async function recommendLegTransport(
  fromItem: PlanItem,
  toItem: PlanItem,
  input: Pick<TripInput, "transport">,
  map: Pick<MapProvider, "route">,
  deadline = Number.POSITIVE_INFINITY,
  prefs?: TransportPrefs
) {
  const from = itemLocation(fromItem);
  const to = itemLocation(toItem);
  if (!from || !to) return undefined;
  const directKm = haversineKm(from, to);
  if (fromItem.clusterKey && fromItem.clusterKey === toItem.clusterKey) {
    return { mode: "walk" as const, durationMin: Math.min(5, Math.max(1, Math.round((directKm / 5) * 60))), distanceKm: directKm };
  }
  if (Date.now() >= deadline) return estimateWalk(directKm);
  const preferred = prefs ? (directKm < prefs.shortKm ? prefs.shortMode : prefs.longMode) : directKm < 0.8 ? "walk" : input.transport ?? "public";
  let route = await map.route(from, to, preferred);
  let mode = preferred;
  if (preferred === "public" && route.durationMin > 90 && Date.now() < deadline) {
    const drive = await map.route(from, to, "drive");
    if (drive.durationMin < route.durationMin) {
      route = drive;
      mode = "drive";
    }
  }
  return { ...route, mode };
}

function findViolations(plan: TripPlan) {
  const violations: PlanViolationDetail[] = [];
  for (const day of plan.days) {
    const label = day.index ?? day.day ?? "?";
    const total = day.items.reduce((sum, item) => sum + item.durationMin + (item.transportToNext?.durationMin ?? 0), 0);
    if (total > 720) {
      violations.push({ day: label, metric: "day-total-min", measured: total, threshold: 720, message: `第 ${label} 天超载 ${total}min` });
    }
    day.items.forEach((item, index) => {
      const measured = item.transportToNext?.durationMin ?? 0;
      if (measured > 90) {
        violations.push({ day: label, segmentIndex: index + 1, metric: "segment-transport-min", measured, threshold: 90, message: `第 ${label} 天第 ${index + 1} 段交通 ${measured}min 超过90min` });
      }
    });
    const points = day.items.map(itemLocation).filter(Boolean) as LngLat[];
    const ratio = backtrackRatio(points);
    if (ratio > 1.5) {
      violations.push({ day: label, metric: "backtrack-ratio", measured: Number(ratio.toFixed(2)), threshold: 1.5, message: `第 ${label} 天折返比 ${ratio.toFixed(2)}` });
    }
  }
  return violations;
}

async function fallbackPlan(plan: TripPlan, input: TripInput, map: MapProvider) {
  const warnings = new Set(plan.warnings);
  for (const day of plan.days) {
    const points = day.items.map(itemLocation).filter(Boolean) as LngLat[];
    if (backtrackRatio(points) > 1.5) {
      day.items = nearestClusterOrder(day.items).flatMap((group) => group.items);
      warnings.add("兜底: 已按最近邻重排折返日程");
    }
    await fillAdjacentRoutes({ ...plan, days: [day] }, input, map);
    while (findDayViolations(day).length > 0 && day.items.length > 0) {
      const removeIndex = lowestPriorityIndex(day.items);
      const [removed] = day.items.splice(removeIndex, 1);
      plan.filtered.push(FilteredItemSchema.parse({ name: itemName(removed), sourceNoteId: removed.poi?.sourceNoteId, stage: "plan", reason: "超载兜底裁剪" }));
      warnings.add("兜底: 超载日程已裁剪 POI");
      await fillAdjacentRoutes({ ...plan, days: [day] }, input, map);
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

function nearestItemOrder(items: PlanItem[], start?: PlanItem) {
  if (items.length < 2) return items;
  const ordered: PlanItem[] = [];
  const remaining = [...items];
  let current = start ?? remaining.shift()!;
  if (!start) ordered.push(current);
  while (remaining.length) {
    const currentLocation = itemLocation(current);
    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const next = itemLocation(remaining[i]);
      const distance = currentLocation && next ? haversineKm(currentLocation, next) : Number.MAX_SAFE_INTEGER;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    current = remaining.splice(bestIndex, 1)[0];
    ordered.push(current);
  }
  return ordered;
}

export function nearestClusterOrder(items: PlanItem[], start?: PlanItem) {
  const groups = clusterItemGroups(items);
  if (groups.length < 2) return groups;
  const ordered: Array<{ key: string; items: PlanItem[] }> = [];
  const remaining = [...groups];
  let current = start;
  if (!current) {
    const first = remaining.shift()!;
    ordered.push(first);
    current = first.items.at(-1);
  }
  while (remaining.length) {
    const currentLocation = current ? itemLocation(current) : undefined;
    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const next = remaining[i].items.find((item) => itemLocation(item));
      const nextLocation = next ? itemLocation(next) : undefined;
      const distance = currentLocation && nextLocation ? haversineKm(currentLocation, nextLocation) : Number.MAX_SAFE_INTEGER;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    const group = remaining.splice(bestIndex, 1)[0];
    ordered.push(group);
    current = group.items.at(-1);
  }
  return ordered;
}

function clusterItemGroups(items: PlanItem[]) {
  const groups: Array<{ key: string; items: PlanItem[] }> = [];
  const byKey = new Map<string, PlanItem[]>();
  for (const item of items) {
    const key = item.clusterKey ?? itemId(item);
    const group = byKey.get(key);
    if (group) group.push(item);
    else {
      const next = [item];
      byKey.set(key, next);
      groups.push({ key, items: next });
    }
  }
  return groups;
}

function nearestGroupOrder(groups: Array<[string, GroundedPoi[]]>) {
  if (groups.length < 2) return groups;
  const ordered = [groups[0]];
  const remaining = groups.slice(1);
  while (remaining.length) {
    const current = firstLocation(ordered.at(-1)![1]);
    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const next = firstLocation(remaining[i][1]);
      const distance = current && next ? haversineKm(current, next) : Number.MAX_SAFE_INTEGER;
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
  if (plan.days.some((day) => day.items.some((item) => (item.verified ?? item.poi?.verified) === false))) warnings.add("未验证 POI 参与排程");
  if (plan.days.some((day) => day.items.some((item) => !(item.openHours ?? item.poi?.openHours)))) warnings.add("部分 POI openHours 缺失");
  if (input.dailyThemes && input.dailyThemes.length !== plan.days.length) warnings.add("主题数与实际天数不一致");
  plan.warnings = Array.from(warnings);
}

function groupByCluster(grounded: GroundedPoi[], clusters: Map<string, string>) {
  const groups = new Map<string, GroundedPoi[]>();
  for (const poi of grounded) {
    const key = poiKey(poi);
    const clusterKey = clusters.get(key) ?? key;
    groups.set(clusterKey, [...(groups.get(clusterKey) ?? []), poi]);
  }
  return groups;
}

function firstLocation(items: GroundedPoi[]) {
  return items.find((item) => item.location)?.location;
}

function itemLocation(item: PlanItem): LngLat | undefined {
  return item.location ?? item.poi?.location;
}

function itemName(item: PlanItem) {
  return item.name ?? item.poi?.name ?? item.poiId ?? "未命名 POI";
}

function itemId(item: PlanItem) {
  return item.poiId ?? item.id ?? item.name ?? itemName(item);
}

function poiKey(poi: GroundedPoi) {
  return poi.id ?? poi.amapId ?? poi.name;
}

function allDaysEmpty(plan: TripPlan) {
  return plan.days.every((day) => day.items.length === 0);
}

function estimateWalk(distanceKm: number) {
  return { mode: "walk" as const, durationMin: Math.max(5, Math.round(((distanceKm * 1.3) / 5) * 60)), distanceKm: distanceKm * 1.3 };
}

const planJsonSchema = {
  type: "object",
  required: ["days"],
  properties: {
    days: {
      type: "array",
      items: {
        type: "object",
        properties: {
          theme: { type: "string" },
          slots: {
            type: "object",
            properties: {
              morning: { type: "array", items: { type: "string" } },
              afternoon: { type: "array", items: { type: "string" } },
              evening: { type: "array", items: { type: "string" } }
            }
          }
        }
      }
    },
    daysDecision: {}
  }
};
