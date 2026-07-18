import type { GroundedPoi, PlanItem, TransportMode, TransportPrefs, TripPlan } from "@/lib/pipeline/types";
import {
  addEmptyDay,
  addItemToDay,
  appendItemsToPool,
  clonePlan,
  dayAt,
  findGroup,
  moveDayGroupToDay,
  moveDayGroupToPool,
  movePoolGroupToDay,
  removeDayToPool,
  removePoolGroup,
  reorderDayGroups,
  setDayTheme
} from "@/lib/pipeline/plan-edit";

export type WorkbenchIntent =
  | { type: "place-pool-item"; poolItemId: string; day: number; index?: number }
  | { type: "remove-pool-item"; poolItemId: string }
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
        const { day, index, group } = movePoolGroupToDay(optimisticPlan, intent.poolItemId, intent.day, intent.index);
        clearAffectedTransports(day.items, index, group.length);
        return { optimisticPlan, patchBody: { op: "add-item", day: intent.day, index: intent.index, poolItemId: intent.poolItemId } };
      }
      case "remove-pool-item": {
        removePoolGroup(optimisticPlan, intent.poolItemId);
        return { optimisticPlan, patchBody: { op: "pool-remove", poolItemId: intent.poolItemId } };
      }
      case "add-poi-to-day": {
        const item = itemFromPoi(intent.poi);
        const result = addItemToDay(optimisticPlan, item, intent.day, intent.index);
        clearAffectedTransports(result.day.items, result.index, 1);
        return { optimisticPlan, patchBody: { op: "add-item", day: intent.day, index: intent.index, poi: intent.poi } };
      }
      case "add-poi-to-pool": {
        const item = itemFromPoi(intent.poi);
        appendItemsToPool(optimisticPlan, [item]);
        return { optimisticPlan, patchBody: { op: "pool-add", poi: intent.poi } };
      }
      case "reorder-day": {
        const day = reorderDayGroups(optimisticPlan, intent.day, intent.orderedGroupIds);
        day.items.forEach((item) => {
          item.transportToNext = undefined;
        });
        return { optimisticPlan, patchBody: { op: "reorder", day: intent.day, orderedIds: intent.orderedGroupIds } };
      }
      case "move-day-item": {
        const { fromDay, toDay, group, fromIndex, index } = moveDayGroupToDay(optimisticPlan, intent.fromDay, intent.toDay, intent.itemId, intent.toIndex);
        clearAffectedTransports(fromDay.items, Math.max(0, fromIndex - 1), 1);
        clearAffectedTransports(toDay.items, index, group.length);
        return { optimisticPlan, patchBody: { op: "move-item", fromDay: intent.fromDay, toDay: intent.toDay, itemId: intent.itemId, toIndex: intent.toIndex } };
      }
      case "return-item-to-pool": {
        moveDayGroupToPool(optimisticPlan, intent.day, intent.itemId);
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
        addEmptyDay(optimisticPlan, intent.theme);
        return { optimisticPlan, patchBody: { op: "add-day", theme: intent.theme } };
      case "remove-day": {
        removeDayToPool(optimisticPlan, intent.day);
        return { optimisticPlan, patchBody: { op: "remove-day", day: intent.day } };
      }
      case "set-day-theme": {
        setDayTheme(optimisticPlan, intent.day, intent.theme);
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

function clearAffectedTransports(items: PlanItem[], index: number, groupLength: number) {
  const indexes = [index - 1, index + groupLength - 1];
  for (const segmentIndex of indexes) {
    if (items[segmentIndex]) items[segmentIndex].transportToNext = undefined;
  }
  if (items.at(-1)) items.at(-1)!.transportToNext = undefined;
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
