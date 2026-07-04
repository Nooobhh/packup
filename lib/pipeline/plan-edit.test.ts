import { describe, expect, it } from "vitest";
import {
  moveDayGroupToDay,
  moveDayGroupToPool,
  movePoolGroupToDay,
  reorderDayGroups,
  snapInsertionIndex
} from "./plan-edit";
import type { PlanItem, TripPlan } from "./types";

describe("plan-edit shared structural operations", () => {
  it("moves a pool group into a day and snaps insertion indexes to cluster boundaries", () => {
    const plan = samplePlan();

    const result = movePoolGroupToDay(plan, "pool-cluster", 1, 2);

    expect(result.index).toBe(3);
    expect(plan.days[0].items.map((item) => item.id)).toEqual(["a", "b1", "b2", "p1", "p2", "c"]);
    expect(plan.pool.map((item) => item.id)).toEqual(["loose"]);
    expect(itemIds(plan)).toEqual(["a", "b1", "b2", "c", "d", "loose", "p1", "p2"]);
  });

  it("moves day groups to pool and across days without changing the item multiset", () => {
    const plan = samplePlan();
    const initial = itemIds(plan);

    const removed = moveDayGroupToPool(plan, 1, "cluster-b");
    const moved = moveDayGroupToDay(plan, 2, 1, "d", 1);

    expect(removed.group.map((item) => item.id)).toEqual(["b1", "b2"]);
    expect(moved.index).toBe(1);
    expect(plan.days[0].items.map((item) => item.id)).toEqual(["a", "d", "c"]);
    expect(plan.pool.map((item) => item.id)).toEqual(["loose", "p1", "p2", "b1", "b2"]);
    expect(itemIds(plan)).toEqual(initial);
  });

  it("reorders days by adjacent cluster groups", () => {
    const plan = samplePlan();

    reorderDayGroups(plan, 1, ["c", "cluster-b", "a"]);

    expect(plan.days[0].items.map((item) => item.id)).toEqual(["c", "b1", "b2", "a"]);
  });

  it("snaps only indexes inside a multi-item cluster", () => {
    const items = samplePlan().days[0].items;

    expect(snapInsertionIndex(items, 0)).toBe(0);
    expect(snapInsertionIndex(items, 2)).toBe(3);
    expect(snapInsertionIndex(items, 3)).toBe(3);
    expect(snapInsertionIndex(items, undefined)).toBe(4);
  });
});

function samplePlan(): TripPlan {
  return {
    days: [
      { index: 1, items: [item("a"), { ...item("b1"), clusterKey: "cluster-b" }, { ...item("b2"), clusterKey: "cluster-b" }, item("c")] },
      { index: 2, items: [item("d")] }
    ],
    pool: [item("loose"), { ...item("p1"), clusterKey: "pool-cluster" }, { ...item("p2"), clusterKey: "pool-cluster" }],
    filtered: [],
    warnings: []
  };
}

function item(id: string): PlanItem {
  return { id, poiId: id, name: id, durationMin: 60, location: { lng: 121, lat: 31 } };
}

function itemIds(plan: TripPlan) {
  return [...plan.days.flatMap((day) => day.items), ...plan.pool].map((item) => item.id).sort();
}
