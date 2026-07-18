import { describe, expect, it } from "vitest";
import {
  moveDayItemToDay,
  moveDayItemToPool,
  movePoolItemToDay,
  removePoolItem,
  reorderDayItems
} from "./plan-edit";
import type { PlanItem, TripPlan } from "./types";

describe("plan-edit shared structural operations", () => {
  it("moves one pool item into the requested item index", () => {
    const plan = samplePlan();

    const result = movePoolItemToDay(plan, "pool-a", 1, 2);

    expect(result.index).toBe(2);
    expect(plan.days[0].items.map((item) => item.uid)).toEqual(["a", "hotel-out", "pool-a", "x", "hotel-back"]);
    expect(plan.pool.map((item) => item.uid)).toEqual(["pool-b"]);
    expect(itemUids(plan)).toEqual(["a", "hotel-back", "hotel-out", "pool-a", "pool-b", "x"]);
  });

  it("moves only one of two adjacent instances of the same POI to the pool", () => {
    const plan = samplePlan({ adjacentHotels: true });

    const removed = moveDayItemToPool(plan, 1, "hotel-out");

    expect(removed.item.uid).toBe("hotel-out");
    expect(plan.days[0].items.map((item) => item.uid)).toEqual(["a", "hotel-back", "x"]);
    expect(plan.pool.map((item) => item.uid)).toEqual(["pool-a", "pool-b", "hotel-out"]);
  });

  it("edits non-adjacent instances of the same POI without cluster segment errors", () => {
    const plan = samplePlan();

    const moved = moveDayItemToDay(plan, 1, 2, "hotel-back", 0);

    expect(moved.item.uid).toBe("hotel-back");
    expect(plan.days[0].items.map((item) => item.uid)).toEqual(["a", "hotel-out", "x"]);
    expect(plan.days[1].items.map((item) => item.uid)).toEqual(["hotel-back"]);
    expect(itemUids(plan)).toEqual(["a", "hotel-back", "hotel-out", "pool-a", "pool-b", "x"]);
  });

  it("permanently removes only the selected pool instance", () => {
    const plan = samplePlan();
    plan.pool = [hotel("pool-hotel-1"), hotel("pool-hotel-2")];

    removePoolItem(plan, "pool-hotel-1");

    expect(plan.pool.map((item) => item.uid)).toEqual(["pool-hotel-2"]);
  });

  it("reorders by instance uid without changing the item multiset", () => {
    const plan = samplePlan();
    const initial = itemUids(plan);

    reorderDayItems(plan, 1, ["hotel-back", "x", "hotel-out", "a"]);

    expect(plan.days[0].items.map((item) => item.uid)).toEqual(["hotel-back", "x", "hotel-out", "a"]);
    expect(itemUids(plan)).toEqual(initial);
  });
});

function samplePlan({ adjacentHotels = false }: { adjacentHotels?: boolean } = {}): TripPlan {
  const out = hotel("hotel-out");
  const back = hotel("hotel-back");
  return {
    days: [
      { index: 1, items: adjacentHotels ? [item("a"), out, back, item("x")] : [item("a"), out, item("x"), back] },
      { index: 2, items: [] }
    ],
    pool: [item("pool-a"), item("pool-b")],
    filtered: [],
    warnings: []
  };
}

function hotel(uid: string): PlanItem {
  return { ...item(uid), id: "hotel-poi", poiId: "hotel-poi", name: "同一家酒店", clusterKey: "hotel-poi" };
}

function item(uid: string): PlanItem {
  return { uid, id: uid, poiId: uid, name: uid, durationMin: 60, location: { lng: 121, lat: 31 } };
}

function itemUids(plan: TripPlan) {
  return [...plan.days.flatMap((day) => day.items), ...plan.pool].map((item) => item.uid).sort();
}
