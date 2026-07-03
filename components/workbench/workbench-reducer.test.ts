import { describe, expect, it } from "vitest";
import { applyIntent } from "./workbench-reducer";
import type { TripPlan } from "@/lib/pipeline/types";

describe("applyIntent", () => {
  it("maps pool, day reorder, cross-day, pool return, edit, day, transport, prefs, and optimize intents to patch bodies", () => {
    const plan = samplePlan();

    const placed = mustApply(applyIntent(plan, { type: "place-pool-item", poolItemId: "pool-1", day: 1, index: 1 }));
    expect(placed.optimisticPlan.days[0].items.map((item) => item.id)).toEqual(["a", "pool-1", "b"]);
    expect(placed.optimisticPlan.pool).toEqual([]);
    expect(placed.patchBody).toEqual({ op: "add-item", poolItemId: "pool-1", day: 1, index: 1 });

    const reordered = mustApply(applyIntent(plan, { type: "reorder-day", day: 1, orderedGroupIds: ["b", "a"] }));
    expect(reordered.optimisticPlan.days[0].items.map((item) => item.id)).toEqual(["b", "a"]);
    expect(reordered.patchBody).toEqual({ op: "reorder", day: 1, orderedIds: ["b", "a"] });

    const moved = mustApply(applyIntent(plan, { type: "move-day-item", fromDay: 1, toDay: 2, itemId: "b", toIndex: 0 }));
    expect(moved.optimisticPlan.days.map((day) => day.items.map((item) => item.id))).toEqual([["a"], ["b", "c"]]);
    expect(moved.patchBody).toEqual({ op: "move-item", fromDay: 1, toDay: 2, itemId: "b", toIndex: 0 });

    const returned = mustApply(applyIntent(plan, { type: "return-item-to-pool", day: 1, itemId: "a" }));
    expect(returned.optimisticPlan.days[0].items.map((item) => item.id)).toEqual(["b"]);
    expect(returned.optimisticPlan.pool.map((item) => item.id)).toEqual(["pool-1", "a"]);
    expect(returned.patchBody).toEqual({ op: "remove-item", day: 1, itemId: "a" });

    const edited = mustApply(applyIntent(plan, { type: "edit-item", day: 1, itemId: "a", set: { note: "n", startTime: "09:30", durationMin: 45 } }));
    expect(edited.optimisticPlan.days[0].items[0]).toMatchObject({ id: "a", note: "n", startTime: "09:30", durationMin: 45 });
    expect(edited.patchBody).toEqual({ op: "update-item", day: 1, itemId: "a", set: { note: "n", startTime: "09:30", durationMin: 45 } });

    const addedDay = mustApply(applyIntent(plan, { type: "add-day", theme: "新 day" }));
    expect(addedDay.optimisticPlan.days.at(-1)).toEqual({ index: 3, theme: "新 day", items: [] });
    expect(addedDay.patchBody).toEqual({ op: "add-day", theme: "新 day" });

    const themed = mustApply(applyIntent(plan, { type: "set-day-theme", day: 1, theme: "主题" }));
    expect(themed.optimisticPlan.days[0].theme).toBe("主题");
    expect(themed.patchBody).toEqual({ op: "set-day-theme", day: 1, theme: "主题" });

    expect(mustApply(applyIntent(plan, { type: "set-transport", day: 1, segmentIndex: 0, mode: "bike" })).patchBody).toEqual({ op: "set-transport", day: 1, segmentIndex: 0, mode: "bike" });
    expect(mustApply(applyIntent(plan, { type: "set-transport-prefs", prefs: { shortKm: 2, shortMode: "bike", longMode: "drive" } })).patchBody).toEqual({
      op: "set-transport-prefs",
      shortKm: 2,
      shortMode: "bike",
      longMode: "drive"
    });
    expect(mustApply(applyIntent(plan, { type: "optimize-day", day: 1 })).patchBody).toEqual({ op: "optimize-day", day: 1 });
    expect(mustApply(applyIntent(plan, { type: "recalc-transport" })).patchBody).toEqual({ op: "recalc-transport" });
  });

  it("maps searched POIs to pool-add and treats it as an allowed growth path", () => {
    const plan = samplePlan();
    const result = mustApply(applyIntent(plan, { type: "add-poi-to-pool", poi: groundedPoi("manual-pool") }));

    expect(result.optimisticPlan.pool.map((item) => item.id)).toEqual(["pool-1", "manual-pool"]);
    expect(result.optimisticPlan.pool.at(-1)?.slot).toBeUndefined();
    expect(result.optimisticPlan.pool.at(-1)?.transportToNext).toBeUndefined();
    expect(result.patchBody).toEqual({ op: "pool-add", poi: groundedPoi("manual-pool") });
    expect(itemIds(result.optimisticPlan)).toEqual([...itemIds(plan), "manual-pool"].sort());
  });

  it("keeps indexed pool and day drop targets in patch bodies and optimistic order", () => {
    const plan = samplePlan();

    const placed = mustApply(applyIntent(plan, { type: "place-pool-item", poolItemId: "pool-1", day: 1, index: 0 }));
    expect(placed.optimisticPlan.days[0].items.map((item) => item.id)).toEqual(["pool-1", "a", "b"]);
    expect(placed.patchBody).toEqual({ op: "add-item", poolItemId: "pool-1", day: 1, index: 0 });

    const moved = mustApply(applyIntent(plan, { type: "move-day-item", fromDay: 1, toDay: 2, itemId: "a", toIndex: 1 }));
    expect(moved.optimisticPlan.days.map((day) => day.items.map((item) => item.id))).toEqual([["b"], ["c", "a"]]);
    expect(moved.patchBody).toEqual({ op: "move-item", fromDay: 1, toDay: 2, itemId: "a", toIndex: 1 });

    const reordered = mustApply(applyIntent(plan, { type: "reorder-day", day: 1, orderedGroupIds: ["b", "a"] }));
    expect(reordered.optimisticPlan.days[0].items.map((item) => item.id)).toEqual(["b", "a"]);
    expect(reordered.patchBody).toEqual({ op: "reorder", day: 1, orderedIds: ["b", "a"] });
  });

  it("moves adjacent cluster groups as a unit", () => {
    const plan = samplePlan();
    plan.days[0].items[0].clusterKey = "cluster";
    plan.days[0].items[1].clusterKey = "cluster";

    const result = applyIntent(plan, { type: "return-item-to-pool", day: 1, itemId: "cluster" });

    expect("optimisticPlan" in result && result.optimisticPlan.pool.map((item) => item.id)).toEqual(["pool-1", "a", "b"]);
  });

  it("preserves the item multiset for legal non-growth intent sequences and does not mutate input", () => {
    const plan = samplePlan();
    const before = JSON.stringify(plan);
    const initialIds = itemIds(plan);
    const intents = [
      { type: "place-pool-item", poolItemId: "pool-1", day: 1, index: 1 },
      { type: "move-day-item", fromDay: 1, toDay: 2, itemId: "b", toIndex: 1 },
      { type: "return-item-to-pool", day: 2, itemId: "b" },
      { type: "remove-day", day: 2 }
    ] as const;

    let current = plan;
    for (const intent of intents) {
      const result = applyIntent(current, intent);
      if ("error" in result) throw new Error(result.error);
      current = result.optimisticPlan;
    }

    expect(itemIds(current)).toEqual(initialIds);
    expect(JSON.stringify(plan)).toBe(before);
  });

  it("returns errors for invalid intents", () => {
    expect(applyIntent(samplePlan(), { type: "place-pool-item", poolItemId: "missing", day: 1 })).toHaveProperty("error");
    expect(applyIntent(samplePlan(), { type: "remove-day", day: 9 })).toHaveProperty("error");
    expect(applyIntent({ ...samplePlan(), days: [{ index: 1, items: [] }] }, { type: "remove-day", day: 1 })).toHaveProperty("error");
  });
});

function samplePlan(): TripPlan {
  return {
    days: [
      { index: 1, items: [item("a"), item("b")] },
      { index: 2, items: [item("c")] }
    ],
    pool: [item("pool-1")],
    filtered: [],
    warnings: []
  };
}

function item(id: string) {
  return { id, poiId: id, name: id, durationMin: 60, location: { lng: 121, lat: 31 } };
}

function groundedPoi(id: string) {
  return {
    id,
    name: id,
    type: "sight",
    reason: "手动添加",
    sourceNoteId: "manual",
    sourceType: "manual",
    verified: true,
    amapId: id,
    location: { lng: 121, lat: 31 },
    address: `${id} addr`
  } as const;
}

function itemIds(plan: TripPlan) {
  return [...plan.days.flatMap((day) => day.items), ...plan.pool].map((item) => item.id).sort();
}

function mustApply(result: ReturnType<typeof applyIntent>) {
  if ("error" in result) throw new Error(result.error);
  return result;
}
