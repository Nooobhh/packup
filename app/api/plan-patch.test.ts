import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH } from "./trips/[id]/plan/route";

let dataRoot: string;
const oldEnv = process.env.PACKUP_DATA_DIR;

beforeEach(async () => {
  dataRoot = await mkdtemp(path.join(os.tmpdir(), "api-plan-patch-"));
  process.env.PACKUP_DATA_DIR = dataRoot;
});

afterEach(async () => {
  process.env.PACKUP_DATA_DIR = oldEnv;
  (globalThis as typeof globalThis & { __packupPatchMapForTest?: unknown }).__packupPatchMapForTest = undefined;
  (globalThis as typeof globalThis & { __packupPatchAfterReadForTest?: unknown }).__packupPatchAfterReadForTest = undefined;
  await rm(dataRoot, { recursive: true, force: true });
});

describe("PATCH /api/trips/[id]/plan canvas ops", () => {
  it("adds from pool, removes to pool, moves across days, edits item fields, and edits days/themes", async () => {
    await writePlan("trip-ops", basePlan());
    const route = vi.fn().mockResolvedValue({ durationMin: 9, distanceKm: 1.2 });
    setPatchMap(route);

    let res = await patch("trip-ops", { op: "add-item", day: 1, index: 1, poolItemId: "pool-1" });
    expect(res.status).toBe(200);
    let plan = await res.json();
    expect(plan.days[0].items.map((item: Item) => item.id)).toEqual(["p1", "pool-1", "p2", "p3"]);
    expect(plan.pool.map((item: Item) => item.id)).toEqual(["pool-2"]);
    expect(route).toHaveBeenCalledTimes(2);

    res = await patch("trip-ops", { op: "remove-item", day: 1, itemId: "pool-1" });
    expect(res.status).toBe(200);
    plan = await res.json();
    expect(plan.days[0].items.map((item: Item) => item.id)).toEqual(["p1", "p2", "p3"]);
    expect(plan.pool.map((item: Item) => item.id)).toEqual(["pool-2", "pool-1"]);
    expect(plan.pool.at(-1).transportToNext).toBeUndefined();

    res = await patch("trip-ops", { op: "move-item", fromDay: 1, toDay: 2, itemId: "p2", toIndex: 0 });
    expect(res.status).toBe(200);
    plan = await res.json();
    expect(plan.days[0].items.map((item: Item) => item.id)).toEqual(["p1", "p3"]);
    expect(plan.days[1].items.map((item: Item) => item.id)).toEqual(["p2", "d2"]);

    res = await patch("trip-ops", { op: "update-item", day: 2, itemId: "p2", set: { note: "updated", startTime: "10:30", durationMin: 75 } });
    expect(res.status).toBe(200);
    plan = await res.json();
    expect(plan.days[1].items[0]).toMatchObject({ note: "updated", startTime: "10:30", durationMin: 75 });

    res = await patch("trip-ops", { op: "add-day", theme: "新增" });
    expect(res.status).toBe(200);
    plan = await res.json();
    expect(plan.days.at(-1)).toMatchObject({ index: 3, theme: "新增", items: [] });

    res = await patch("trip-ops", { op: "set-day-theme", day: 3, theme: "" });
    expect(res.status).toBe(200);
    plan = await res.json();
    expect(plan.days[2].theme).toBeUndefined();

    res = await patch("trip-ops", { op: "remove-day", day: 2 });
    expect(res.status).toBe(200);
    plan = await res.json();
    expect(plan.days.map((day: { index: number }) => day.index)).toEqual([1, 2]);
    expect(plan.pool.map((item: Item) => item.id)).toEqual(["pool-2", "pool-1", "p2", "d2"]);
    expect(await readPlan("trip-ops")).toEqual(plan);
  });

  it("adds a searched POI as the only growth path and supports route failure as partial success", async () => {
    await writePlan("trip-poi", basePlan());
    const route = vi.fn().mockRejectedValue(new Error("route down"));
    setPatchMap(route);

    const res = await patch("trip-poi", {
      op: "add-item",
      day: 1,
      index: 1,
      poi: groundedPoi("manual-1", "手动点", 121.01)
    });
    const plan = await res.json();

    expect(res.status).toBe(200);
    expect(plan.days[0].items[1]).toMatchObject({ id: "manual-1", poiId: "manual-1", name: "手动点" });
    expect(plan.days[0].items[0].transportToNext).toBeUndefined();
    expect(plan.days[0].items[1].transportToNext).toBeUndefined();
  });

  it("recomputes only affected structure segments and preserves untouched segment objects", async () => {
    await writePlan("trip-routes", basePlan());
    const route = vi.fn().mockResolvedValue({ durationMin: 11, distanceKm: 1.3 });
    setPatchMap(route);
    const before = await readPlan("trip-routes");
    const untouched = before.days[0].items[0].transportToNext;

    let res = await patch("trip-routes", { op: "add-item", day: 1, poolItemId: "pool-1" });
    expect(res.status).toBe(200);
    expect(route).toHaveBeenCalledTimes(1);
    expect((await readPlan("trip-routes")).days[0].items[0].transportToNext).toEqual(untouched);

    route.mockClear();
    await patch("trip-routes", { op: "remove-item", day: 1, itemId: "p2" });
    expect(route).toHaveBeenCalledTimes(1);
  });

  it("preserves item multiset across non-growth structure operations", async () => {
    await writePlan("trip-conserve", basePlan());
    setPatchMap(vi.fn().mockResolvedValue({ durationMin: 5, distanceKm: 1 }));
    const initial = multiset(await readPlan("trip-conserve"));

    await patch("trip-conserve", { op: "add-item", day: 1, poolItemId: "pool-1" });
    await patch("trip-conserve", { op: "remove-item", day: 1, itemId: "p1" });
    await patch("trip-conserve", { op: "move-item", fromDay: 1, toDay: 2, itemId: "p2" });
    await patch("trip-conserve", { op: "remove-day", day: 2 });

    expect(multiset(await readPlan("trip-conserve"))).toEqual(initial);
  });

  it("moves only the selected item to the pool when adjacent items share a cluster", async () => {
    await writePlan("trip-cluster-remove", clusteredPlan());
    setPatchMap(vi.fn().mockResolvedValue({ durationMin: 5, distanceKm: 1 }));
    const initial = multiset(await readPlan("trip-cluster-remove"));

    const res = await patch("trip-cluster-remove", { op: "remove-item", day: 1, itemId: "g2a" });
    const plan = await res.json();

    expect(res.status).toBe(200);
    expect(plan.days[0].items.map((entry: Item) => entry.id)).toEqual(["g1", "g2b", "x", "y"]);
    expect(plan.pool.map((entry: Item) => entry.id)).toEqual(["p0", "pca", "pcb", "g2a"]);
    expect(multiset(plan)).toEqual(initial);
    expect(await readPlan("trip-cluster-remove")).toEqual(plan);
  });

  it("moves only the selected item across days when adjacent items share a cluster", async () => {
    await writePlan("trip-cluster-move", clusteredPlan());
    setPatchMap(vi.fn().mockResolvedValue({ durationMin: 5, distanceKm: 1 }));
    const initial = multiset(await readPlan("trip-cluster-move"));

    const res = await patch("trip-cluster-move", { op: "move-item", fromDay: 1, toDay: 2, itemId: "g2a", toIndex: 0 });
    const plan = await res.json();

    expect(res.status).toBe(200);
    expect(plan.days[0].items.map((entry: Item) => entry.id)).toEqual(["g1", "g2b", "x", "y"]);
    expect(plan.days[1].items.map((entry: Item) => entry.id)).toEqual(["g2a", "d2"]);
    expect(multiset(plan)).toEqual(initial);
    expect(await readPlan("trip-cluster-move")).toEqual(plan);
  });

  it("adds only the selected pool item to a day when adjacent pool items share a cluster", async () => {
    await writePlan("trip-cluster-add", clusteredPlan());
    setPatchMap(vi.fn().mockResolvedValue({ durationMin: 5, distanceKm: 1 }));
    const initial = multiset(await readPlan("trip-cluster-add"));

    const res = await patch("trip-cluster-add", { op: "add-item", day: 1, index: 1, poolItemId: "pca" });
    const plan = await res.json();

    expect(res.status).toBe(200);
    expect(plan.days[0].items.map((entry: Item) => entry.id)).toEqual(["g1", "pca", "g2a", "g2b", "x", "y"]);
    expect(plan.pool.map((entry: Item) => entry.id)).toEqual(["p0", "pcb"]);
    expect(multiset(plan)).toEqual(initial);
    expect(await readPlan("trip-cluster-add")).toEqual(plan);
  });

  it("adds a searched POI to the pool without route calls as an allowed growth path", async () => {
    await writePlan("trip-pool-add", basePlan());
    const route = vi.fn().mockResolvedValue({ durationMin: 5, distanceKm: 1 });
    setPatchMap(route);
    const initial = multiset(await readPlan("trip-pool-add"));

    const res = await patch("trip-pool-add", { op: "pool-add", poi: groundedPoi("manual-pool", "入池点", 121.09) });
    const plan = await res.json();

    expect(res.status).toBe(200);
    expect(route).not.toHaveBeenCalled();
    expect(plan.pool.at(-1)).toMatchObject({ id: "manual-pool", poiId: "manual-pool", name: "入池点" });
    expect(plan.pool.at(-1).slot).toBeUndefined();
    expect(plan.pool.at(-1).transportToNext).toBeUndefined();
    expect(multiset(plan)).toEqual([...initial, "manual-pool"].sort());
    expect(await readPlan("trip-pool-add")).toEqual(plan);
  });

  it("removes one pool item permanently as the only deletion path and rejects unknown ids", async () => {
    await writePlan("trip-pool-remove", clusteredPlan());
    const route = vi.fn().mockResolvedValue({ durationMin: 5, distanceKm: 1 });
    setPatchMap(route);
    const initial = multiset(await readPlan("trip-pool-remove"));

    const res = await patch("trip-pool-remove", { op: "pool-remove", poolItemId: "pca" });
    const plan = await res.json();

    expect(res.status).toBe(200);
    expect(route).not.toHaveBeenCalled();
    expect(plan.pool.map((entry: Item) => entry.id)).toEqual(["p0", "pcb"]);
    expect(multiset(plan)).toEqual(initial.filter((id) => id !== "pca"));
    expect(await readPlan("trip-pool-remove")).toEqual(plan);

    const bad = await patch("trip-pool-remove", { op: "pool-remove", poolItemId: "nope" });
    expect(bad.status).toBe(400);
    expect(await readPlan("trip-pool-remove")).toEqual(plan);
  });

  it("inserts add-item and move-item at exact item indexes inside shared clusters", async () => {
    await writePlan("trip-snap-add", clusteredPlan());
    setPatchMap(vi.fn().mockResolvedValue({ durationMin: 5, distanceKm: 1 }));

    let initial = multiset(await readPlan("trip-snap-add"));
    let res = await patch("trip-snap-add", { op: "add-item", day: 1, index: 2, poolItemId: "pca" });
    let plan = await res.json();

    expect(res.status).toBe(200);
    expect(plan.days[0].items.map((entry: Item) => entry.id)).toEqual(["g1", "g2a", "pca", "g2b", "x", "y"]);
    expect(multiset(plan)).toEqual(initial);

    await writePlan("trip-snap-move", clusteredPlan());
    initial = multiset(await readPlan("trip-snap-move"));
    res = await patch("trip-snap-move", { op: "move-item", fromDay: 2, toDay: 1, itemId: "d2", toIndex: 2 });
    plan = await res.json();

    expect(res.status).toBe(200);
    expect(plan.days[0].items.map((entry: Item) => entry.id)).toEqual(["g1", "g2a", "d2", "g2b", "x", "y"]);
    expect(multiset(plan)).toEqual(initial);
  });

  it("uses trip input transport as edit-time fallback when prefs are absent", async () => {
    await writeInput("trip-input-transport", "drive");
    await writePlan("trip-input-transport", basePlan());
    const route = vi.fn().mockResolvedValue({ durationMin: 5, distanceKm: 1 });
    setPatchMap(route);

    const res = await patch("trip-input-transport", { op: "add-item", day: 1, poolItemId: "pool-1" });

    expect(res.status).toBe(200);
    expect(route).toHaveBeenCalledWith(expect.anything(), expect.anything(), "drive");
  });

  it("rejects bad boundaries without writing and keeps 409 protection for new ops", async () => {
    await writePlan("trip-bad", basePlan());
    setPatchMap(vi.fn().mockResolvedValue({ durationMin: 5, distanceKm: 1 }));
    const original = await readFile(planFile("trip-bad"), "utf8");

    for (const body of [
      { op: "add-item", day: 9, poolItemId: "pool-1" },
      { op: "add-item", day: 1, poolItemId: "missing" },
      { op: "remove-item", day: 1, itemId: "missing" },
      { op: "update-item", day: 1, itemId: "p1", set: {} }
    ]) {
      const res = await patch("trip-bad", body);
      expect(res.status).toBe(400);
    }
    expect(await readFile(planFile("trip-bad"), "utf8")).toBe(original);

    await writePlan("trip-single-day", { days: [{ index: 1, items: [item("only", 121)] }], pool: [], filtered: [], warnings: [] });
    expect((await patch("trip-single-day", { op: "remove-day", day: 1 })).status).toBe(400);

    (globalThis as typeof globalThis & { __packupPatchAfterReadForTest?: unknown }).__packupPatchAfterReadForTest = async (file: string) => {
      await writeFile(file, JSON.stringify({ days: [{ index: 1, items: [item("fresh", 121)] }], filtered: [], warnings: [] }), "utf8");
    };
    const conflict = await patch("trip-bad", { op: "add-day" });
    expect(conflict.status).toBe(409);
  });

  it("optimizes days idempotently, writes prefs, recalculates current prefs, and accepts bike transport", async () => {
    await writePlan("trip-traffic", basePlan({ order: ["p1", "p3", "p2"] }));
    const route = vi.fn(async (_from, _to, mode) => ({ durationMin: mode === "bike" ? 4 : 7, distanceKm: 1 }));
    setPatchMap(route);

    let res = await patch("trip-traffic", { op: "optimize-day", day: 1 });
    let plan = await res.json();
    expect(res.status).toBe(200);
    expect(plan.days[0].items.map((item: Item) => item.id)).toEqual(["p1", "p2", "p3"]);
    const callsAfterFirstOptimize = route.mock.calls.length;

    res = await patch("trip-traffic", { op: "optimize-day", day: 1 });
    expect(res.status).toBe(200);
    expect(route.mock.calls.length).toBe(callsAfterFirstOptimize);

    route.mockClear();
    res = await patch("trip-traffic", { op: "set-transport-prefs", shortKm: 2, shortMode: "bike", longMode: "drive" });
    plan = await res.json();
    expect(plan.transportPrefs).toEqual({ shortKm: 2, shortMode: "bike", longMode: "drive" });
    expect(route).not.toHaveBeenCalled();

    res = await patch("trip-traffic", { op: "recalc-transport", day: 1 });
    expect(res.status).toBe(200);
    expect(route).toHaveBeenCalledTimes(2);
    expect(route.mock.calls.every((call) => call[2] === "bike")).toBe(true);

    route.mockClear();
    res = await patch("trip-traffic", { op: "set-transport", day: 1, segmentIndex: 0, mode: "bike" });
    expect(res.status).toBe(200);
    expect(route).toHaveBeenCalledWith(expect.anything(), expect.anything(), "bike");
  });
});

type Item = { uid: string; id: string; poiId?: string; transportToNext?: unknown };

async function patch(id: string, body: unknown) {
  return PATCH(new Request("http://test", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
}

function setPatchMap(route: ReturnType<typeof vi.fn>) {
  (globalThis as typeof globalThis & { __packupPatchMapForTest?: unknown }).__packupPatchMapForTest = { route };
}

function basePlan(opts: { order?: string[] } = {}) {
  const items = Object.fromEntries(["p1", "p2", "p3", "d2", "pool-1", "pool-2"].map((id, index) => [id, item(id, 121 + index * 0.01)]));
  return {
    days: [
      { index: 1, items: (opts.order ?? ["p1", "p2", "p3"]).map((id) => items[id]) },
      { index: 2, items: [items.d2] }
    ],
    pool: [items["pool-1"], items["pool-2"]].map((entry) => ({ ...entry, transportToNext: undefined })),
    filtered: [],
    warnings: []
  };
}

function clusteredPlan() {
  const entries = {
    g1: item("g1", 121),
    g2a: { ...item("g2a", 121.01), clusterKey: "cluster-k" },
    g2b: { ...item("g2b", 121.011), clusterKey: "cluster-k" },
    x: item("x", 121.02),
    y: item("y", 121.03),
    d2: item("d2", 121.04),
    p0: item("p0", 121.05),
    pca: { ...item("pca", 121.06), clusterKey: "pool-cluster" },
    pcb: { ...item("pcb", 121.061), clusterKey: "pool-cluster" }
  };
  return {
    days: [
      { index: 1, items: [entries.g1, entries.g2a, entries.g2b, entries.x, entries.y] },
      { index: 2, items: [entries.d2] }
    ],
    pool: [entries.p0, entries.pca, entries.pcb].map((entry) => ({ ...entry, slot: undefined, transportToNext: undefined })),
    filtered: [],
    warnings: []
  };
}

function item(id: string, lng: number) {
  return {
    uid: id,
    id,
    poiId: id,
    name: id,
    type: "sight",
    durationMin: 60,
    location: { lng, lat: 31 },
    transportToNext: id === "p3" || id === "d2" ? undefined : { mode: "public", durationMin: 10, distanceKm: 1 }
  };
}

function groundedPoi(id: string, name: string, lng: number) {
  return {
    id,
    name,
    type: "sight",
    reason: "手动添加",
    sourceNoteId: "manual",
    sourceType: "manual",
    verified: true,
    amapId: id,
    location: { lng, lat: 31 },
    address: `${name} addr`
  };
}

async function writePlan(id: string, plan: unknown) {
  await mkdir(path.join(dataRoot, id), { recursive: true });
  await writeFile(planFile(id), JSON.stringify(plan, null, 2), "utf8");
}

async function writeInput(id: string, transport: string) {
  await mkdir(path.join(dataRoot, id), { recursive: true });
  await writeFile(path.join(dataRoot, id, "00-input.json"), JSON.stringify({ id, links: [], destination: "上海", transport, pace: "moderate" }), "utf8");
}

async function readPlan(id: string) {
  return JSON.parse(await readFile(planFile(id), "utf8"));
}

function planFile(id: string) {
  return path.join(dataRoot, id, "40-plan.json");
}

function multiset(plan: { days: Array<{ items: Item[] }>; pool: Item[] }) {
  return [...plan.days.flatMap((day) => day.items), ...plan.pool].map((entry) => entry.id).sort();
}
