import type { GroundedPoi, PlanItem, TransportMode, TransportPrefs, TripPlan } from "@/lib/pipeline/types";

export type WorkbenchIntent =
  | { type: "place-pool-item"; poolItemId: string; day: number; index?: number }
  | { type: "add-poi-to-pool"; poi: GroundedPoi }
  | { type: "add-poi-to-day"; poi: GroundedPoi; day: number; index?: number }
  | { type: "reorder-day"; day: number; orderedGroupIds: string[] }
  | { type: "move-day-item"; fromDay: number; toDay: number; itemId: string; toIndex?: number }
  | { type: "return-item-to-pool"; day: number; itemId: string }
  | { type: "edit-item"; day: number; itemId: string; set: { note?: string; startTime?: string; durationMin?: number } }
  | { type: "add-day"; theme?: string }
  | { type: "remove-day"; day: number }
  | { type: "set-day-theme"; day: number; theme: string }
  | { type: "set-transport"; day: number; segmentIndex: number; mode: TransportMode }
  | { type: "set-transport-prefs"; prefs: TransportPrefs }
  | { type: "optimize-day"; day: number }
  | { type: "recalc-transport"; day?: number };

export function applyIntent(plan: TripPlan, intent: WorkbenchIntent): { optimisticPlan: TripPlan; patchBody: object } | { error: string } {
  const optimisticPlan = clonePlan(plan);
  try {
    switch (intent.type) {
      case "place-pool-item": {
        const day = dayAt(optimisticPlan, intent.day);
        const index = insertionIndex(day.items, intent.index);
        const group = takeGroup(optimisticPlan.pool, intent.poolItemId);
        day.items.splice(index, 0, ...group);
        clearAffectedTransports(day.items, index, group.length);
        return { optimisticPlan, patchBody: { op: "add-item", day: intent.day, index: intent.index, poolItemId: intent.poolItemId } };
      }
      case "add-poi-to-day": {
        const day = dayAt(optimisticPlan, intent.day);
        const index = insertionIndex(day.items, intent.index);
        const item = itemFromPoi(intent.poi);
        day.items.splice(index, 0, item);
        clearAffectedTransports(day.items, index, 1);
        return { optimisticPlan, patchBody: { op: "add-item", day: intent.day, index: intent.index, poi: intent.poi } };
      }
      case "add-poi-to-pool": {
        const item = itemFromPoi(intent.poi);
        clearForPool([item]);
        optimisticPlan.pool.push(item);
        return { optimisticPlan, patchBody: { op: "pool-add", poi: intent.poi } };
      }
      case "reorder-day": {
        const day = dayAt(optimisticPlan, intent.day);
        const groups = groupAdjacent(day.items);
        const byId = new Map(groups.map((group) => [group.id, group.items]));
        if (!sameMembers(intent.orderedGroupIds, Array.from(byId.keys()))) throw new Error("orderedGroupIds 与当天分组不一致");
        day.items = intent.orderedGroupIds.flatMap((id) => byId.get(id)!);
        day.items.forEach((item) => {
          item.transportToNext = undefined;
        });
        return { optimisticPlan, patchBody: { op: "reorder", day: intent.day, orderedIds: intent.orderedGroupIds } };
      }
      case "move-day-item": {
        const fromDay = dayAt(optimisticPlan, intent.fromDay);
        const group = takeGroup(fromDay.items, intent.itemId);
        clearAffectedTransports(fromDay.items, Math.max(0, findPreviousIndex(fromDay.items, group)), 1);
        const toDay = dayAt(optimisticPlan, intent.toDay);
        const index = insertionIndex(toDay.items, intent.toIndex);
        toDay.items.splice(index, 0, ...group);
        clearAffectedTransports(toDay.items, index, group.length);
        return { optimisticPlan, patchBody: { op: "move-item", fromDay: intent.fromDay, toDay: intent.toDay, itemId: intent.itemId, toIndex: intent.toIndex } };
      }
      case "return-item-to-pool": {
        const day = dayAt(optimisticPlan, intent.day);
        const group = takeGroup(day.items, intent.itemId);
        clearForPool(group);
        optimisticPlan.pool.push(...group);
        return { optimisticPlan, patchBody: { op: "remove-item", day: intent.day, itemId: intent.itemId } };
      }
      case "edit-item": {
        if (Object.keys(intent.set).length === 0) throw new Error("set 至少提供一个字段");
        const group = findGroup(dayAt(optimisticPlan, intent.day).items, intent.itemId);
        if (!group) throw new Error("itemId 不存在");
        group.items.forEach((item) => Object.assign(item, intent.set));
        return { optimisticPlan, patchBody: { op: "update-item", day: intent.day, itemId: intent.itemId, set: intent.set } };
      }
      case "add-day":
        optimisticPlan.days.push({ index: optimisticPlan.days.length + 1, theme: intent.theme, items: [] });
        return { optimisticPlan, patchBody: { op: "add-day", theme: intent.theme } };
      case "remove-day": {
        if (optimisticPlan.days.length <= 1) throw new Error("至少保留一天");
        const index = intent.day - 1;
        const [removed] = optimisticPlan.days.splice(index, 1);
        if (!removed) throw new Error("day 越界");
        clearForPool(removed.items);
        optimisticPlan.pool.push(...removed.items);
        optimisticPlan.days.forEach((day, dayIndex) => {
          day.index = dayIndex + 1;
        });
        return { optimisticPlan, patchBody: { op: "remove-day", day: intent.day } };
      }
      case "set-day-theme": {
        const day = dayAt(optimisticPlan, intent.day);
        if (intent.theme.trim() === "") delete day.theme;
        else day.theme = intent.theme;
        return { optimisticPlan, patchBody: { op: "set-day-theme", day: intent.day, theme: intent.theme } };
      }
      case "set-transport": {
        const day = dayAt(optimisticPlan, intent.day);
        if (intent.segmentIndex < 0 || intent.segmentIndex >= day.items.length - 1) throw new Error("segmentIndex 越界");
        const current = day.items[intent.segmentIndex].transportToNext;
        if (current) day.items[intent.segmentIndex].transportToNext = { ...current, mode: intent.mode };
        return { optimisticPlan, patchBody: { op: "set-transport", day: intent.day, segmentIndex: intent.segmentIndex, mode: intent.mode } };
      }
      case "set-transport-prefs":
        optimisticPlan.transportPrefs = intent.prefs;
        return { optimisticPlan, patchBody: { op: "set-transport-prefs", ...intent.prefs } };
      case "optimize-day":
        dayAt(optimisticPlan, intent.day);
        return { optimisticPlan, patchBody: { op: "optimize-day", day: intent.day } };
      case "recalc-transport":
        if (intent.day !== undefined) {
          dayAt(optimisticPlan, intent.day);
          return { optimisticPlan, patchBody: { op: "recalc-transport", day: intent.day } };
        }
        return { optimisticPlan, patchBody: { op: "recalc-transport" } };
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function clonePlan(plan: TripPlan): TripPlan {
  return JSON.parse(JSON.stringify(plan)) as TripPlan;
}

function dayAt(plan: TripPlan, dayNumber: number) {
  const day = plan.days[dayNumber - 1];
  if (!day) throw new Error("day 越界");
  return day;
}

function insertionIndex(items: PlanItem[], index: number | undefined) {
  const resolved = index ?? items.length;
  if (resolved < 0 || resolved > items.length) throw new Error("index 越界");
  return resolved;
}

function takeGroup(items: PlanItem[], target: string) {
  const group = findGroup(items, target);
  if (!group) throw new Error("itemId 不存在");
  return items.splice(group.index, group.items.length);
}

function findGroup(items: PlanItem[], target: string) {
  let index = 0;
  for (const group of groupAdjacent(items)) {
    if (group.id === target || group.items.some((item) => rawItemId(item) === target)) return { ...group, index };
    index += group.items.length;
  }
  return undefined;
}

function groupAdjacent(items: PlanItem[]) {
  const groups: Array<{ id: string; items: PlanItem[] }> = [];
  for (const item of items) {
    const id = item.clusterKey ?? rawItemId(item);
    const last = groups.at(-1);
    if (last && item.clusterKey && last.id === item.clusterKey) last.items.push(item);
    else groups.push({ id, items: [item] });
  }
  return groups;
}

function rawItemId(item: PlanItem) {
  return item.poiId ?? item.id ?? item.name ?? "";
}

function sameMembers(a: string[], b: string[]) {
  return a.length === b.length && a.every((id) => b.includes(id)) && b.every((id) => a.includes(id));
}

function clearForPool(items: PlanItem[]) {
  for (const item of items) {
    delete item.slot;
    delete item.transportToNext;
  }
}

function clearAffectedTransports(items: PlanItem[], index: number, groupLength: number) {
  const indexes = [index - 1, index + groupLength - 1];
  for (const segmentIndex of indexes) {
    if (items[segmentIndex]) items[segmentIndex].transportToNext = undefined;
  }
  if (items.at(-1)) items.at(-1)!.transportToNext = undefined;
}

function findPreviousIndex(items: PlanItem[], group: PlanItem[]) {
  const firstId = rawItemId(group[0]);
  const index = items.findIndex((item) => rawItemId(item) === firstId);
  return index - 1;
}

function itemFromPoi(poi: GroundedPoi): PlanItem {
  const id = poi.id ?? poi.amapId ?? poi.name;
  return {
    id,
    poiId: id,
    poi,
    name: poi.name,
    type: poi.type,
    clusterKey: id,
    durationMin: 60,
    address: poi.address,
    openHours: poi.openHours,
    verified: poi.verified,
    location: poi.location,
    reason: poi.reason
  };
}
