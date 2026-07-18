import type { PlanDay, PlanItem, TripPlan } from "./types";

export function clonePlan(plan: TripPlan): TripPlan {
  return JSON.parse(JSON.stringify(plan)) as TripPlan;
}

export function dayAt(plan: TripPlan, dayNumber: number) {
  const day = plan.days[dayNumber - 1];
  if (!day) throw new Error("day 越界");
  return day;
}

export function groupAdjacent(items: PlanItem[]) {
  const groups: Array<{ id: string; index: number; items: PlanItem[] }> = [];
  const seen = new Set<string>();
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const id = planItemKey(item);
    const last = groups.at(-1);
    if (last?.id === id) {
      last.items.push(item);
      continue;
    }
    if (seen.has(id)) throw new Error("同一 clusterKey 存在非相邻分段,请先重新生成行程");
    seen.add(id);
    groups.push({ id, index, items: [item] });
  }
  return groups;
}

export function findGroup(items: PlanItem[], target: string) {
  for (const group of groupAdjacent(items)) {
    if (group.id === target || group.items.some((item) => rawItemId(item) === target)) return group;
  }
  return undefined;
}

export function takeGroupWithIndex(items: PlanItem[], target: string) {
  const group = findGroup(items, target);
  if (!group) throw new Error("itemId 不存在");
  return { group: items.splice(group.index, group.items.length), index: group.index };
}

export function snapInsertionIndex(items: PlanItem[], index: number | undefined) {
  const resolved = insertionIndex(items, index);
  for (const group of groupAdjacent(items)) {
    if (group.items.length > 1 && resolved > group.index && resolved < group.index + group.items.length) {
      return group.index + group.items.length;
    }
  }
  return resolved;
}

export function insertGroupAtBoundary(items: PlanItem[], group: PlanItem[], index: number | undefined) {
  const snapped = snapInsertionIndex(items, index);
  items.splice(snapped, 0, ...group);
  return snapped;
}

export function addItemToDay(plan: TripPlan, item: PlanItem, dayNumber: number, index: number | undefined) {
  const day = dayAt(plan, dayNumber);
  const insertedIndex = insertGroupAtBoundary(day.items, [item], index);
  return { day, group: [item], index: insertedIndex };
}

export function movePoolGroupToDay(plan: TripPlan, poolItemId: string, dayNumber: number, index: number | undefined) {
  const day = dayAt(plan, dayNumber);
  const { group } = takeGroupWithIndex(plan.pool, poolItemId);
  const insertedIndex = insertGroupAtBoundary(day.items, group, index);
  return { day, group, index: insertedIndex };
}

export function moveDayGroupToPool(plan: TripPlan, dayNumber: number, itemId: string) {
  const day = dayAt(plan, dayNumber);
  const { group, index } = takeGroupWithIndex(day.items, itemId);
  clearForPool(group);
  plan.pool.push(...group);
  return { day, group, index };
}

export function moveDayGroupToDay(plan: TripPlan, fromDayNumber: number, toDayNumber: number, itemId: string, toIndex: number | undefined) {
  const fromDay = dayAt(plan, fromDayNumber);
  const toDay = dayAt(plan, toDayNumber);
  const { group, index: fromIndex } = takeGroupWithIndex(fromDay.items, itemId);
  const adjustedIndex = fromDay === toDay && toIndex !== undefined && toIndex > fromIndex ? Math.max(fromIndex, toIndex - group.length) : toIndex;
  const index = insertGroupAtBoundary(toDay.items, group, adjustedIndex);
  return { fromDay, toDay, group, fromIndex, index };
}

export function reorderDayGroups(plan: TripPlan, dayNumber: number, orderedIds: string[]) {
  const day = dayAt(plan, dayNumber);
  reorderItemsByGroupIds(day.items, orderedIds);
  return day;
}

export function reorderItemsByGroupIds(items: PlanItem[], orderedIds: string[]) {
  const groups = groupAdjacent(items);
  const byId = new Map(groups.map((group) => [group.id, group.items]));
  if (!sameMembers(orderedIds, Array.from(byId.keys()))) throw new Error("orderedIds 与当天 items 集合不一致");
  items.splice(0, items.length, ...orderedIds.flatMap((id) => byId.get(id)!));
}

export function appendItemsToPool(plan: TripPlan, items: PlanItem[]) {
  clearForPool(items);
  plan.pool.push(...items);
}

/** 待安排池的显式删除:唯一的永久删除入口,已排程地点必须先移回池 */
export function removePoolGroup(plan: TripPlan, poolItemId: string) {
  const { group, index } = takeGroupWithIndex(plan.pool, poolItemId);
  return { group, index };
}

export function removeDayToPool(plan: TripPlan, dayNumber: number) {
  if (plan.days.length <= 1) throw new Error("至少保留一天");
  const index = dayNumber - 1;
  const [removed] = plan.days.splice(index, 1);
  if (!removed) throw new Error("day 越界");
  appendItemsToPool(plan, removed.items);
  reindexDays(plan.days);
  return removed;
}

export function addEmptyDay(plan: TripPlan, theme?: string) {
  plan.days.push({ index: plan.days.length + 1, theme, items: [] });
}

export function setDayTheme(plan: TripPlan, dayNumber: number, theme: string) {
  const day = dayAt(plan, dayNumber);
  if (theme.trim() === "") delete day.theme;
  else day.theme = theme;
}

export function clearForPool(items: PlanItem[]) {
  for (const item of items) {
    delete item.slot;
    delete item.transportToNext;
  }
}

export function planItemKey(item: PlanItem) {
  return item.clusterKey ?? rawItemId(item);
}

export function rawItemId(item: PlanItem) {
  return item.poiId ?? item.id ?? item.name ?? "";
}

function insertionIndex(items: PlanItem[], index: number | undefined) {
  const resolved = index ?? items.length;
  if (resolved < 0 || resolved > items.length) throw new Error("index 越界");
  return resolved;
}

function reindexDays(days: PlanDay[]) {
  days.forEach((day, index) => {
    day.index = index + 1;
  });
}

function sameMembers(a: string[], b: string[]) {
  return a.length === b.length && a.every((id) => b.includes(id)) && b.every((id) => a.includes(id));
}
