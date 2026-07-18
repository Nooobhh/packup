import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { AmapRestProvider } from "@/lib/map/amap-rest";
import type { MapProvider } from "@/lib/map/types";
import { BUDGETS } from "@/lib/pipeline/budgets";
import { nearestClusterOrder, planItemFromPoi, recommendLegTransport } from "@/lib/pipeline/plan";
import {
  addEmptyDay,
  addItemToDay,
  appendItemsToPool,
  dayAt,
  findItem,
  moveDayItemToDay,
  moveDayItemToPool,
  movePoolItemToDay,
  planItemKey,
  removeDayToPool,
  removePoolItem,
  reorderItemsByIds,
  setDayTheme
} from "@/lib/pipeline/plan-edit";
import {
  GroundedPoiSchema,
  parseTripPlan,
  TransportModeSchema,
  TransportPrefsSchema,
  TripPlanSchema,
  type LngLat,
  type PlanDay,
  type PlanItem,
  type TripPlan,
  type TransportMode,
  type TransportPrefs
} from "@/lib/pipeline/types";

const PatchSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("reorder"), day: z.number().int().positive(), orderedIds: z.array(z.string()).min(1) }),
  z.object({ op: z.literal("set-transport"), day: z.number().int().positive(), segmentIndex: z.number().int().nonnegative(), mode: TransportModeSchema }),
  z.object({
    op: z.literal("add-item"),
    day: z.number().int().positive(),
    index: z.number().int().nonnegative().optional(),
    poolItemId: z.string().optional(),
    poi: GroundedPoiSchema.optional()
  }),
  z.object({ op: z.literal("pool-add"), poi: GroundedPoiSchema }),
  z.object({ op: z.literal("pool-remove"), poolItemId: z.string().min(1) }),
  z.object({ op: z.literal("remove-item"), day: z.number().int().positive(), itemId: z.string().min(1) }),
  z.object({
    op: z.literal("move-item"),
    fromDay: z.number().int().positive(),
    toDay: z.number().int().positive(),
    itemId: z.string().min(1),
    toIndex: z.number().int().nonnegative().optional()
  }),
  z.object({
    op: z.literal("update-item"),
    day: z.number().int().positive(),
    itemId: z.string().min(1),
    set: z.object({
      note: z.string().optional(),
      startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      durationMin: z.number().int().positive().optional()
    })
  }),
  z.object({ op: z.literal("add-day"), theme: z.string().optional() }),
  z.object({ op: z.literal("remove-day"), day: z.number().int().positive() }),
  z.object({ op: z.literal("set-day-theme"), day: z.number().int().positive(), theme: z.string() }),
  z.object({ op: z.literal("optimize-day"), day: z.number().int().positive() }),
  z.object({ op: z.literal("set-transport-prefs"), shortKm: z.number().positive(), shortMode: TransportModeSchema, longMode: TransportModeSchema }),
  z.object({ op: z.literal("recalc-transport"), day: z.number().int().positive().optional() })
]);

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const file = path.join(tripDir(id), "40-plan.json");
  if (!(await exists(file))) return Response.json({ error: "Trip plan not ready" }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const patch = PatchSchema.safeParse(body);
  if (!patch.success) return Response.json({ error: "Invalid patch", issues: patch.error.issues }, { status: 400 });

  const originalRaw = await readFile(file, "utf8");
  const plan = parseTripPlan(JSON.parse(originalRaw));
  await (globalThis as typeof globalThis & { __packupPatchAfterReadForTest?: (file: string) => Promise<void> | void }).__packupPatchAfterReadForTest?.(file);
  const map = getMap();
  const fallbackTransport = await readInputTransport(id);

  try {
    switch (patch.data.op) {
      case "reorder":
        await applyReorder(dayAt(plan, patch.data.day).items, patch.data.orderedIds, map, plan.transportPrefs, fallbackTransport);
        break;
      case "set-transport":
        await applySetTransport(dayAt(plan, patch.data.day).items, patch.data.segmentIndex, patch.data.mode, map);
        break;
      case "add-item":
        await applyAddItem(plan, patch.data, map, fallbackTransport);
        break;
      case "pool-add":
        applyPoolAdd(plan, patch.data.poi);
        break;
      case "pool-remove":
        removePoolItem(plan, patch.data.poolItemId);
        break;
      case "remove-item":
        await applyRemoveItem(plan, patch.data.day, patch.data.itemId, map, fallbackTransport);
        break;
      case "move-item":
        await applyMoveItem(plan, patch.data.fromDay, patch.data.toDay, patch.data.itemId, patch.data.toIndex, map, fallbackTransport);
        break;
      case "update-item":
        applyUpdateItem(plan, patch.data.day, patch.data.itemId, patch.data.set);
        break;
      case "add-day":
        addEmptyDay(plan, patch.data.theme);
        break;
      case "remove-day":
        applyRemoveDay(plan, patch.data.day);
        break;
      case "set-day-theme":
        applySetDayTheme(plan, patch.data.day, patch.data.theme);
        break;
      case "optimize-day":
        await applyOptimizeDay(plan, patch.data.day, map, fallbackTransport);
        break;
      case "set-transport-prefs":
        plan.transportPrefs = TransportPrefsSchema.parse({
          shortKm: patch.data.shortKm,
          shortMode: patch.data.shortMode,
          longMode: patch.data.longMode
        });
        break;
      case "recalc-transport":
        await applyRecalcTransport(plan, patch.data.day, map, fallbackTransport);
        break;
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }

  const parsed = TripPlanSchema.parse(plan);
  if (!(await isUnchanged(file, originalRaw))) {
    return Response.json({ error: "行程已被更新,请刷新后重试" }, { status: 409 });
  }
  await writeFile(file, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  return Response.json(parsed);
}

function applyPoolAdd(plan: TripPlan, poi: z.infer<typeof GroundedPoiSchema>) {
  const item = planItemFromPoi(poi, "morning", poi.id ?? poi.amapId ?? poi.name);
  appendItemsToPool(plan, [item]);
}

async function applyAddItem(
  plan: TripPlan,
  patch: { day: number; index?: number; poolItemId?: string; poi?: z.infer<typeof GroundedPoiSchema> },
  map: Pick<MapProvider, "route">,
  fallbackTransport: TransportMode
) {
  if (Boolean(patch.poolItemId) === Boolean(patch.poi)) throw new Error("poolItemId 或 poi 必须且只能提供一个");
  const result = patch.poolItemId
    ? movePoolItemToDay(plan, patch.poolItemId, patch.day, patch.index)
    : addItemToDay(
        plan,
        planItemFromPoi(
          patch.poi!,
          "morning",
          patch.poi!.id ?? patch.poi!.amapId ?? patch.poi!.name
        ),
        patch.day,
        patch.index
      );
  await recomputeInsertion(result.day, result.index, 1, map, plan.transportPrefs, fallbackTransport);
}

async function applyRemoveItem(plan: TripPlan, dayNumber: number, itemIdToRemove: string, map: Pick<MapProvider, "route">, fallbackTransport: TransportMode) {
  const { day, index } = moveDayItemToPool(plan, dayNumber, itemIdToRemove);
  await recomputeRemoval(day, index, map, plan.transportPrefs, fallbackTransport);
}

async function applyMoveItem(
  plan: TripPlan,
  fromDayNumber: number,
  toDayNumber: number,
  itemIdToMove: string,
  toIndex: number | undefined,
  map: Pick<MapProvider, "route">,
  fallbackTransport: TransportMode
) {
  const { fromDay, toDay, fromIndex, index } = moveDayItemToDay(plan, fromDayNumber, toDayNumber, itemIdToMove, toIndex);
  await recomputeRemoval(fromDay, fromIndex, map, plan.transportPrefs, fallbackTransport);
  await recomputeInsertion(toDay, index, 1, map, plan.transportPrefs, fallbackTransport);
}

function applyUpdateItem(plan: TripPlan, dayNumber: number, target: string, set: { note?: string; startTime?: string; durationMin?: number }) {
  if (Object.keys(set).length === 0) throw new Error("set 至少提供一个字段");
  const day = dayAt(plan, dayNumber);
  const found = findItem(day.items, target);
  if (!found) throw new Error("itemId 不存在");
  Object.assign(found.item, set);
}

function applyRemoveDay(plan: TripPlan, dayNumber: number) {
  removeDayToPool(plan, dayNumber);
}

function applySetDayTheme(plan: TripPlan, dayNumber: number, theme: string) {
  setDayTheme(plan, dayNumber, theme);
}

async function applyOptimizeDay(plan: TripPlan, dayNumber: number, map: Pick<MapProvider, "route">, fallbackTransport: TransportMode) {
  const day = dayAt(plan, dayNumber);
  const oldPair = adjacentPairMap(day.items);
  const reordered = nearestClusterOrder(day.items).flatMap((group) => group.items);
  day.items.splice(0, day.items.length, ...reordered);
  await fillDayWithPairReuse(day, oldPair, map, plan.transportPrefs, fallbackTransport);
}

async function applyRecalcTransport(plan: TripPlan, dayNumber: number | undefined, map: Pick<MapProvider, "route">, fallbackTransport: TransportMode) {
  const days = dayNumber ? [dayAt(plan, dayNumber)] : plan.days;
  const deadline = Date.now() + BUDGETS.planRoutesMs;
  let timedOut = false;
  for (const day of days) {
    for (let i = 0; i < day.items.length - 1; i++) {
      if (Date.now() >= deadline) {
        timedOut = true;
        break;
      }
      day.items[i].transportToNext = undefined;
      await recommendAt(day, i, map, plan.transportPrefs, deadline, fallbackTransport);
    }
    if (day.items.length > 0) day.items.at(-1)!.transportToNext = undefined;
    if (timedOut) break;
  }
  if (timedOut) plan.warnings.push("交通重算超时,剩余路段保留原值");
}

async function applyReorder(items: PlanItem[], orderedIds: string[], map: Pick<MapProvider, "route">, prefs?: TransportPrefs, fallbackTransport: TransportMode = "public") {
  const oldPair = adjacentPairMap(items);
  reorderItemsByIds(items, orderedIds);
  await fillDayWithPairReuse({ items }, oldPair, map, prefs, fallbackTransport);
}

async function applySetTransport(items: PlanItem[], index: number, mode: TransportMode, map: Pick<MapProvider, "route">) {
  if (index < 0 || index >= items.length - 1) throw new Error("segmentIndex 越界");
  const from = itemLocation(items[index]);
  const to = itemLocation(items[index + 1]);
  if (!from || !to) throw new Error("segment location missing");
  const route = await map.route(from, to, mode);
  items[index].transportToNext = { ...route, mode };
}

async function fillDayWithPairReuse(
  day: Pick<PlanDay, "items">,
  oldPair: Map<string, PlanItem["transportToNext"]>,
  map: Pick<MapProvider, "route">,
  prefs?: TransportPrefs,
  fallbackTransport: TransportMode = "public"
) {
  for (let i = 0; i < day.items.length; i++) day.items[i].transportToNext = undefined;
  for (let i = 0; i < day.items.length - 1; i++) {
    const key = pairKey(day.items[i], day.items[i + 1]);
    if (oldPair.has(key)) day.items[i].transportToNext = oldPair.get(key);
    else await recommendAt(day, i, map, prefs, Number.POSITIVE_INFINITY, fallbackTransport);
  }
}

async function recomputeInsertion(day: PlanDay, index: number, groupLength: number, map: Pick<MapProvider, "route">, prefs: TransportPrefs | undefined, fallbackTransport: TransportMode) {
  if (index > 0) await recommendAt(day, index - 1, map, prefs, Number.POSITIVE_INFINITY, fallbackTransport);
  await recommendAt(day, index + groupLength - 1, map, prefs, Number.POSITIVE_INFINITY, fallbackTransport);
}

async function recomputeRemoval(day: PlanDay, removedIndex: number, map: Pick<MapProvider, "route">, prefs: TransportPrefs | undefined, fallbackTransport: TransportMode) {
  if (removedIndex > 0) await recommendAt(day, removedIndex - 1, map, prefs, Number.POSITIVE_INFINITY, fallbackTransport);
  if (day.items.length > 0) day.items.at(-1)!.transportToNext = undefined;
}

async function recommendAt(
  day: Pick<PlanDay, "items">,
  index: number,
  map: Pick<MapProvider, "route">,
  prefs?: TransportPrefs,
  deadline = Number.POSITIVE_INFINITY,
  fallbackTransport: TransportMode = "public"
) {
  if (index < 0 || index >= day.items.length - 1) {
    if (day.items[index]) day.items[index].transportToNext = undefined;
    return;
  }
  day.items[index].transportToNext = undefined;
  try {
    const route = await recommendLegTransport(day.items[index], day.items[index + 1], { transport: fallbackTransport }, map, deadline, prefs);
    if (route) day.items[index].transportToNext = route;
  } catch {
    day.items[index].transportToNext = undefined;
  }
}

function adjacentPairMap(items: PlanItem[]) {
  const oldPair = new Map<string, PlanItem["transportToNext"]>();
  for (let i = 0; i < items.length - 1; i++) oldPair.set(pairKey(items[i], items[i + 1]), items[i].transportToNext);
  return oldPair;
}

function pairKey(from: PlanItem, to: PlanItem) {
  return `${planItemKey(from)}->${planItemKey(to)}`;
}

function itemLocation(item: PlanItem): LngLat | undefined {
  return item.location ?? item.poi?.location;
}

function getMap(): Pick<MapProvider, "route"> {
  return ((globalThis as typeof globalThis & { __packupPatchMapForTest?: Pick<MapProvider, "route"> }).__packupPatchMapForTest ?? new AmapRestProvider()) as Pick<MapProvider, "route">;
}

async function readInputTransport(id: string): Promise<TransportMode> {
  try {
    const raw = await readFile(path.join(tripDir(id), "00-input.json"), "utf8");
    const parsed = JSON.parse(raw) as { transport?: unknown };
    const transport = TransportModeSchema.safeParse(parsed.transport);
    return transport.success ? transport.data : "public";
  } catch {
    return "public";
  }
}

function tripDir(id: string) {
  return path.join(process.env.PACKUP_DATA_DIR ?? path.join(process.cwd(), "data/trips"), id);
}

async function exists(file: string) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function isUnchanged(file: string, originalRaw: string) {
  try {
    return (await readFile(file, "utf8")) === originalRaw;
  } catch {
    return false;
  }
}
