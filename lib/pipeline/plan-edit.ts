import type { PlanDay, PlanItem, TripPlan } from "./types";

export function clonePlan(plan: TripPlan): TripPlan {
  return JSON.parse(JSON.stringify(plan)) as TripPlan;
}

export function dayAt(plan: TripPlan, dayNumber: number) {
  const day = plan.days[dayNumber - 1];
  if (!day) throw new Error("day 越界");
  return day;
}

export function findItem(items: PlanItem[], target: string) {
  const index = items.findIndex((item) => planItemKey(item) === target);
  return index < 0 ? undefined : { item: items[index], index };
}

export function takeItemWithIndex(items: PlanItem[], target: string) {
  const found = findItem(items, target);
  if (!found) throw new Error("itemId 不存在");
  return { item: items.splice(found.index, 1)[0], index: found.index };
}

export function insertItem(items: PlanItem[], item: PlanItem, index: number | undefined) {
  const resolved = insertionIndex(items, index);
  items.splice(resolved, 0, item);
  return resolved;
}

export function addItemToDay(plan: TripPlan, item: PlanItem, dayNumber: number, index: number | undefined) {
  const day = dayAt(plan, dayNumber);
  const insertedIndex = insertItem(day.items, item, index);
  return { day, item, index: insertedIndex };
}

export function movePoolItemToDay(plan: TripPlan, poolItemId: string, dayNumber: number, index: number | undefined) {
  const day = dayAt(plan, dayNumber);
  const { item } = takeItemWithIndex(plan.pool, poolItemId);
  const insertedIndex = insertItem(day.items, item, index);
  return { day, item, index: insertedIndex };
}

export function moveDayItemToPool(plan: TripPlan, dayNumber: number, itemId: string) {
  const day = dayAt(plan, dayNumber);
  const { item, index } = takeItemWithIndex(day.items, itemId);
  clearForPool([item]);
  plan.pool.push(item);
  return { day, item, index };
}

export function moveDayItemToDay(plan: TripPlan, fromDayNumber: number, toDayNumber: number, itemId: string, toIndex: number | undefined) {
  const fromDay = dayAt(plan, fromDayNumber);
  const toDay = dayAt(plan, toDayNumber);
  const { item, index: fromIndex } = takeItemWithIndex(fromDay.items, itemId);
  const adjustedIndex = fromDay === toDay && toIndex !== undefined && toIndex > fromIndex ? Math.max(fromIndex, toIndex - 1) : toIndex;
  const index = insertItem(toDay.items, item, adjustedIndex);
  return { fromDay, toDay, item, fromIndex, index };
}

export function reorderDayItems(plan: TripPlan, dayNumber: number, orderedIds: string[]) {
  const day = dayAt(plan, dayNumber);
  reorderItemsByIds(day.items, orderedIds);
  return day;
}

export function reorderItemsByIds(items: PlanItem[], orderedIds: string[]) {
  const byId = new Map(items.map((item) => [planItemKey(item), item]));
  if (!sameMembers(orderedIds, Array.from(byId.keys()))) throw new Error("orderedIds 与当天 items 集合不一致");
  items.splice(0, items.length, ...orderedIds.map((id) => byId.get(id)!));
}

export function appendItemsToPool(plan: TripPlan, items: PlanItem[]) {
  clearForPool(items);
  plan.pool.push(...items);
}

/** 待安排池的显式删除:唯一的永久删除入口,已排程地点必须先移回池 */
export function removePoolItem(plan: TripPlan, poolItemId: string) {
  return takeItemWithIndex(plan.pool, poolItemId);
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
  return item.uid ?? rawItemId(item);
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
