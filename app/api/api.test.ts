import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./generate/route";
import { GET } from "./trips/[id]/route";
import { GET as GET_CANDIDATES } from "./trips/[id]/candidates/route";
import { PATCH as PATCH_PLAN } from "./trips/[id]/plan/route";
import { POST as POST_SELECTION } from "./trips/[id]/selection/route";
import type { StageEvent } from "@/lib/pipeline/types";

let dataRoot: string;
const oldEnv = process.env.PACKUP_DATA_DIR;

beforeEach(async () => {
  dataRoot = await mkdtemp(path.join(os.tmpdir(), "api-"));
  process.env.PACKUP_DATA_DIR = dataRoot;
});

afterEach(async () => {
  process.env.PACKUP_DATA_DIR = oldEnv;
  (globalThis as typeof globalThis & { __packupGeneratePipelineForTest?: unknown }).__packupGeneratePipelineForTest = undefined;
  (globalThis as typeof globalThis & { __packupPatchMapForTest?: unknown }).__packupPatchMapForTest = undefined;
  (globalThis as typeof globalThis & { __packupPatchAfterReadForTest?: unknown }).__packupPatchAfterReadForTest = undefined;
  await rm(dataRoot, { recursive: true, force: true });
});

describe("POST /api/generate", () => {
  it("returns 400 for invalid input", async () => {
    const res = await POST(new Request("http://test/api/generate", { method: "POST", body: JSON.stringify({ links: [] }) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty("error");
  });

  it("streams stage events and a final await-selection event with tripId", async () => {
    (globalThis as typeof globalThis & { __packupGeneratePipelineForTest?: unknown }).__packupGeneratePipelineForTest = async (_input: unknown, _deps: unknown, opts: { onEvent?: (event: StageEvent) => void }) => {
      opts.onEvent?.({ stage: "fetch", status: "start", at: "2026-07-02T00:00:00.000Z" });
      return { tripId: "trip-api" };
    };
    const res = await POST(
      new Request("http://test/api/generate", {
        method: "POST",
        body: JSON.stringify({ id: "trip-api", links: ["https://xhslink.com/1"], destination: "上海" })
      })
    );
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(text.trim().split("\n\n")[0]).toContain('"tripId":"trip-api"');
    expect(text).toContain('"stage":"fetch"');
    expect(text).toContain('"status":"await-selection"');
    expect(text).toContain('"tripId":"trip-api"');
  });

  it("parses query input and stops at await-selection", async () => {
    const calls: unknown[] = [];
    (globalThis as typeof globalThis & { __packupGeneratePipelineForTest?: unknown }).__packupGeneratePipelineForTest = async (input: unknown, _deps: unknown, opts: { toStage?: string; onEvent?: (event: StageEvent) => void }) => {
      calls.push({ input, toStage: opts.toStage });
      opts.onEvent?.({ stage: "ground", status: "done", at: "2026-07-03T00:00:00.000Z" });
      return { tripId: "trip-query" };
    };
    const res = await POST(new Request("http://test/api/generate", { method: "POST", body: JSON.stringify({ query: "杭州3天旅游攻略", links: ["u"] }) }));
    const text = await res.text();

    expect(calls[0]).toMatchObject({ input: { destination: "杭州", days: { base: 3 }, query: "杭州3天旅游攻略" }, toStage: "ground" });
    expect(text.trim().endsWith('data: {"stage":"ground","status":"await-selection","tripId":"trip-query"}')).toBe(true);
  });

  it("returns 400 when query cannot be parsed", async () => {
    const res = await POST(new Request("http://test/api/generate", { method: "POST", body: JSON.stringify({ query: "帮我规划一个超级好玩的假期行程", links: ["u"] }) }));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("无法识别目的地");
  });
});

describe("GET /api/trips/[id]/candidates", () => {
  it("returns grounded candidates and filtered items or readiness errors", async () => {
    await writeTrip("trip-candidates", {
      input: { id: "trip-candidates", links: ["u"], destination: "上海", transport: "public", pace: "moderate" },
      notes: [],
      pois: { pois: [], filtered: [{ name: "广告", stage: "extract", reason: "广告" }] },
      grounded: { grounded: [{ id: "p1", name: "外滩", type: "sight", reason: "好看", sourceNoteId: "n1", sourceType: "text", verified: true }], filtered: [] },
      plan: { days: [{ index: 1, items: [] }], filtered: [], warnings: [] }
    });

    const ok = await GET_CANDIDATES(new Request("http://test"), { params: Promise.resolve({ id: "trip-candidates" }) });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ grounded: [expect.objectContaining({ id: "p1" })], filtered: [expect.objectContaining({ name: "广告" })] });
    expect((await GET_CANDIDATES(new Request("http://test"), { params: Promise.resolve({ id: "missing" }) })).status).toBe(404);

    const dir = path.join(dataRoot, "trip-not-ready");
    await mkdir(dir, { recursive: true });
    expect((await GET_CANDIDATES(new Request("http://test"), { params: Promise.resolve({ id: "trip-not-ready" }) })).status).toBe(409);
  });
});

describe("POST /api/trips/[id]/selection", () => {
  it("writes selection and resumes plan, rejecting empty selections", async () => {
    await mkdir(path.join(dataRoot, "trip-select"), { recursive: true });
    const calls: unknown[] = [];
    (globalThis as typeof globalThis & { __packupGeneratePipelineForTest?: unknown }).__packupGeneratePipelineForTest = async (_input: unknown, _deps: unknown, opts: unknown) => {
      calls.push(opts);
      return { tripId: "trip-select" };
    };

    const bad = await POST_SELECTION(new Request("http://test", { method: "POST", body: JSON.stringify({ selectedPoiIds: [], selectedAt: "x" }) }), { params: Promise.resolve({ id: "trip-select" }) });
    expect(bad.status).toBe(400);

    const ok = await POST_SELECTION(new Request("http://test", { method: "POST", body: JSON.stringify({ selectedPoiIds: ["p1"], selectedAt: "2026-07-03T00:00:00.000Z" }) }), { params: Promise.resolve({ id: "trip-select" }) });
    expect(ok.status).toBe(200);
    expect(await readFile(path.join(dataRoot, "trip-select", "25-selection.json"), "utf8")).toContain("p1");
    expect(calls[0]).toMatchObject({ fromStage: "plan", force: false });
  });
});

describe("PATCH /api/trips/[id]/plan", () => {
  it("reorders with pair-diff route recomputation and preserves unchanged order", async () => {
    await writePatchTrip("trip-patch");
    const route = vi.fn().mockResolvedValue({ durationMin: 10, distanceKm: 1 });
    (globalThis as typeof globalThis & { __packupPatchMapForTest?: unknown }).__packupPatchMapForTest = { route };

    const unchanged = await PATCH_PLAN(new Request("http://test", { method: "PATCH", body: JSON.stringify({ op: "reorder", day: 1, orderedIds: ["p1", "p2", "p3", "p4"] }) }), { params: Promise.resolve({ id: "trip-patch" }) });
    expect(unchanged.status).toBe(200);
    expect(route).toHaveBeenCalledTimes(0);

    const swapped = await PATCH_PLAN(new Request("http://test", { method: "PATCH", body: JSON.stringify({ op: "reorder", day: 1, orderedIds: ["p1", "p3", "p2", "p4"] }) }), { params: Promise.resolve({ id: "trip-patch" }) });
    expect(swapped.status).toBe(200);
    expect(route).toHaveBeenCalledTimes(3);
  });

  it("recomputes one segment for set-transport and rejects incomplete reorder without rewriting", async () => {
    await writePatchTrip("trip-patch-2");
    const route = vi.fn().mockResolvedValue({ durationMin: 10, distanceKm: 1 });
    (globalThis as typeof globalThis & { __packupPatchMapForTest?: unknown }).__packupPatchMapForTest = { route };

    const bad = await PATCH_PLAN(new Request("http://test", { method: "PATCH", body: JSON.stringify({ op: "reorder", day: 1, orderedIds: ["p1", "p2"] }) }), { params: Promise.resolve({ id: "trip-patch-2" }) });
    expect(bad.status).toBe(400);
    expect(JSON.parse(await readFile(path.join(dataRoot, "trip-patch-2", "40-plan.json"), "utf8")).days[0].items).toHaveLength(4);

    const ok = await PATCH_PLAN(new Request("http://test", { method: "PATCH", body: JSON.stringify({ op: "set-transport", day: 1, segmentIndex: 1, mode: "drive" }) }), { params: Promise.resolve({ id: "trip-patch-2" }) });
    expect(ok.status).toBe(200);
    expect(route).toHaveBeenCalledTimes(1);
  });

  it("uses drive when recomputed public transport is over 90 minutes and drive is faster", async () => {
    await writePatchTrip("trip-patch-drive");
    const route = vi.fn(async (_from, _to, mode) => (mode === "drive" ? { durationMin: 35, distanceKm: 5 } : { durationMin: 95, distanceKm: 5 }));
    (globalThis as typeof globalThis & { __packupPatchMapForTest?: unknown }).__packupPatchMapForTest = { route };

    const res = await PATCH_PLAN(new Request("http://test", { method: "PATCH", body: JSON.stringify({ op: "reorder", day: 1, orderedIds: ["p1", "p3", "p2", "p4"] }) }), { params: Promise.resolve({ id: "trip-patch-drive" }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(route).toHaveBeenCalledWith(expect.anything(), expect.anything(), "public");
    expect(route).toHaveBeenCalledWith(expect.anything(), expect.anything(), "drive");
    expect(json.days[0].items.some((item: { transportToNext?: { mode?: string } }) => item.transportToNext?.mode === "drive")).toBe(true);
  });

  it("does not lose items when stored plan has non-adjacent duplicate cluster keys", async () => {
    await writeDiscontinuousClusterTrip("trip-patch-cluster");
    const route = vi.fn().mockResolvedValue({ durationMin: 10, distanceKm: 1 });
    (globalThis as typeof globalThis & { __packupPatchMapForTest?: unknown }).__packupPatchMapForTest = { route };

    const res = await PATCH_PLAN(new Request("http://test", { method: "PATCH", body: JSON.stringify({ op: "reorder", day: 1, orderedIds: ["c1", "x", "y"] }) }), { params: Promise.resolve({ id: "trip-patch-cluster" }) });
    const saved = JSON.parse(await readFile(path.join(dataRoot, "trip-patch-cluster", "40-plan.json"), "utf8"));

    expect(res.status).toBe(400);
    expect(saved.days[0].items.map((item: { id: string }) => item.id)).toEqual(["a", "x", "b", "y"]);
  });

  it("returns 409 without overwriting when the plan changes during patch", async () => {
    await writePatchTrip("trip-patch-conflict");
    (globalThis as typeof globalThis & { __packupPatchMapForTest?: unknown }).__packupPatchMapForTest = { route: vi.fn().mockResolvedValue({ durationMin: 10, distanceKm: 1 }) };
    const thirdPartyPlan = {
      days: [{ index: 1, items: [{ id: "fresh", poiId: "fresh", name: "fresh", durationMin: 30 }] }],
      filtered: [],
      warnings: ["fresh plan"]
    };
    (globalThis as typeof globalThis & { __packupPatchAfterReadForTest?: unknown }).__packupPatchAfterReadForTest = async (file: string) => {
      await writeFile(file, JSON.stringify(thirdPartyPlan), "utf8");
    };

    const res = await PATCH_PLAN(new Request("http://test", { method: "PATCH", body: JSON.stringify({ op: "reorder", day: 1, orderedIds: ["p1", "p2", "p3", "p4"] }) }), { params: Promise.resolve({ id: "trip-patch-conflict" }) });
    const saved = JSON.parse(await readFile(path.join(dataRoot, "trip-patch-conflict", "40-plan.json"), "utf8"));

    expect(res.status).toBe(409);
    expect(await res.text()).toContain("行程已被更新,请刷新后重试");
    expect(saved).toEqual(thirdPartyPlan);
  });
});

describe("GET /api/trips/[id]", () => {
  it("aggregates plan, failedLinks, and input", async () => {
    await writeTrip("trip-ok", {
      input: { id: "trip-ok", links: ["u1", "u2"], destination: "上海", transport: "public", pace: "moderate" },
      notes: [
        { id: "n1", url: "u1", title: "", body: "", images: [], fetchStatus: "failed", failReason: "fetch fail" },
        { id: "n2", url: "u2", title: "ok", body: "ok", images: [], fetchStatus: "ok" }
      ],
      pois: { pois: [], filtered: [], failedNotes: [{ noteId: "n2", reason: "extract fail" }] },
      plan: { days: [{ index: 1, items: [{ name: "外滩", startTime: "09:00", durationMin: 60 }] }], filtered: [], warnings: [] }
    });

    const res = await GET(new Request("http://test/api/trips/trip-ok"), { params: Promise.resolve({ id: "trip-ok" }) });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.input.destination).toBe("上海");
    expect(json.failedLinks).toEqual([
      { url: "u1", reason: "fetch fail" },
      { url: "u2", reason: "extract fail" }
    ]);
  });

  it("returns 404 for missing trip and 409 when an error checkpoint exists without a plan", async () => {
    expect((await GET(new Request("http://test/api/trips/missing"), { params: Promise.resolve({ id: "missing" }) })).status).toBe(404);
    const dir = path.join(dataRoot, "trip-error");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "plan.error.json"), JSON.stringify({ error: "bad plan" }), "utf8");
    const res = await GET(new Request("http://test/api/trips/trip-error"), { params: Promise.resolve({ id: "trip-error" }) });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "bad plan" });
  });
});

async function writeTrip(
  id: string,
  files: {
    input: unknown;
    notes: unknown;
    pois: unknown;
    grounded?: unknown;
    plan: unknown;
  }
) {
  const dir = path.join(dataRoot, id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "00-input.json"), JSON.stringify(files.input), "utf8");
  await writeFile(path.join(dir, "10-notes.json"), JSON.stringify(files.notes), "utf8");
  await writeFile(path.join(dir, "20-pois.json"), JSON.stringify(files.pois), "utf8");
  if (files.grounded) await writeFile(path.join(dir, "30-grounded.json"), JSON.stringify(files.grounded), "utf8");
  await writeFile(path.join(dir, "40-plan.json"), JSON.stringify(files.plan), "utf8");
  await readFile(path.join(dir, "40-plan.json"), "utf8");
}

async function writePatchTrip(id: string) {
  const dir = path.join(dataRoot, id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "40-plan.json"), JSON.stringify({
    days: [{ index: 1, items: ["p1", "p2", "p3", "p4"].map((id, index) => ({
      id,
      poiId: id,
      name: id,
      slot: "morning",
      durationMin: 60,
      location: { lng: 121 + index * 0.02, lat: 31 },
      transportToNext: index < 3 ? { mode: "public", durationMin: 10, distanceKm: 1 } : undefined
    })) }],
    filtered: [],
    warnings: []
  }), "utf8");
}

async function writeDiscontinuousClusterTrip(id: string) {
  const dir = path.join(dataRoot, id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "40-plan.json"), JSON.stringify({
    days: [{ index: 1, items: [
      { id: "a", poiId: "a", name: "a", clusterKey: "c1", durationMin: 60, location: { lng: 121, lat: 31 } },
      { id: "x", poiId: "x", name: "x", clusterKey: "x", durationMin: 60, location: { lng: 121.02, lat: 31 } },
      { id: "b", poiId: "b", name: "b", clusterKey: "c1", durationMin: 60, location: { lng: 121.04, lat: 31 } },
      { id: "y", poiId: "y", name: "y", clusterKey: "y", durationMin: 60, location: { lng: 121.06, lat: 31 } }
    ] }],
    filtered: [],
    warnings: []
  }), "utf8");
}
