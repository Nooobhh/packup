import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentFetcher } from "@/lib/fetchers/types";
import type { LLMRunner } from "@/lib/llm/types";
import type { MapProvider } from "@/lib/map/types";
import { GroundOutputSchema, NoteSchema, TripPlanSchema, type StageEvent, type TripInput } from "./types";
import { runPipeline } from "./run";

let dataRoot: string;
const oldEnv = process.env.PACKUP_DATA_DIR;

beforeEach(async () => {
  dataRoot = await mkdtemp(path.join(os.tmpdir(), "pipeline-run-"));
  process.env.PACKUP_DATA_DIR = dataRoot;
});

afterEach(async () => {
  process.env.PACKUP_DATA_DIR = oldEnv;
  await rm(dataRoot, { recursive: true, force: true });
});

const input: TripInput = {
  id: "trip-test",
  links: ["https://xhslink.com/1"],
  destination: "上海",
  days: { base: 1, flex: 0 },
  transport: "public",
  pace: "moderate"
};

describe("runPipeline", () => {
  it("runs all stages, emits start/done events, and writes zod-readable checkpoints", async () => {
    const events: StageEvent[] = [];
    const deps = depsForSuccess();

    const result = await runPipeline(input, deps, { onEvent: (event) => events.push(event) });

    expect(result.tripId).toBe("trip-test");
    expect(events.map((event) => `${event.stage}:${event.status}`)).toEqual([
      "fetch:start",
      "fetch:done",
      "extract:start",
      "extract:done",
      "ground:start",
      "ground:done",
      "plan:start",
      "plan:done"
    ]);
    const dir = path.join(dataRoot, "trip-test");
    NoteSchema.array().parse(JSON.parse(await readFile(path.join(dir, "10-notes.json"), "utf8")));
    expect(JSON.parse(await readFile(path.join(dir, "20-pois.json"), "utf8")).failedNotes).toEqual([]);
    GroundOutputSchema.parse(JSON.parse(await readFile(path.join(dir, "30-grounded.json"), "utf8")));
    TripPlanSchema.parse(JSON.parse(await readFile(path.join(dir, "40-plan.json"), "utf8")));
  });

  it("writes an error checkpoint and preserves completed stages on failure", async () => {
    const events: StageEvent[] = [];
    const deps = depsForSuccess();
    deps.map.searchPoi = vi.fn().mockRejectedValue(new Error("amap down"));

    await expect(runPipeline(input, deps, { onEvent: (event) => events.push(event) })).rejects.toThrow("amap down");

    const dir = path.join(dataRoot, "trip-test");
    await expect(readFile(path.join(dir, "10-notes.json"), "utf8")).resolves.toContain("note1");
    await expect(readFile(path.join(dir, "20-pois.json"), "utf8")).resolves.toContain("外滩");
    await expect(readFile(path.join(dir, "ground.error.json"), "utf8")).resolves.toContain("amap down");
    expect(events.at(-1)).toMatchObject({ stage: "ground", status: "error" });
  });

  it("resumes from existing grounded output and skips earlier stages", async () => {
    const dir = path.join(dataRoot, "trip-test");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "00-input.json"), JSON.stringify(input), "utf8");
    await writeFile(path.join(dir, "30-grounded.json"), JSON.stringify({ grounded: [grounded()], filtered: [] }), "utf8");
    const deps = depsForSuccess();
    deps.llm.run = vi.fn().mockResolvedValue(JSON.stringify({ days: [{ index: 1, items: [planItem()] }], filtered: [], warnings: [] }));

    await runPipeline(input, deps);

    expect(deps.fetcher.fetch).not.toHaveBeenCalled();
    expect(deps.llm.run).toHaveBeenCalledTimes(1);
    await expect(readFile(path.join(dir, "40-plan.json"), "utf8")).resolves.toContain("外滩");
  });

  it("force reruns from a stage and deletes downstream artifacts", async () => {
    const dir = path.join(dataRoot, "trip-test");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "00-input.json"), JSON.stringify(input), "utf8");
    await writeFile(path.join(dir, "10-notes.json"), JSON.stringify([{ id: "note1", url: input.links[0], title: "t", body: "b", images: [], fetchStatus: "ok" }]), "utf8");
    await writeFile(path.join(dir, "20-pois.json"), JSON.stringify({ old: true }), "utf8");
    await writeFile(path.join(dir, "30-grounded.json"), JSON.stringify({ old: true }), "utf8");
    await writeFile(path.join(dir, "40-plan.json"), JSON.stringify({ old: true }), "utf8");
    const deps = depsForSuccess();

    await runPipeline(input, deps, { fromStage: "extract", force: true });

    expect(deps.fetcher.fetch).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(path.join(dir, "20-pois.json"), "utf8")).pois[0].name).toBe("外滩");
    expect(JSON.parse(await readFile(path.join(dir, "40-plan.json"), "utf8")).days[0].items[0].name).toBe("外滩");
  });
});

function depsForSuccess(): { fetcher: ContentFetcher & { fetch: ReturnType<typeof vi.fn> }; llm: LLMRunner & { run: ReturnType<typeof vi.fn> }; map: MapProvider } {
  return {
    fetcher: {
      fetch: vi.fn().mockResolvedValue([{ id: "note1", url: input.links[0], title: "t", body: "b", images: [], fetchStatus: "ok" }])
    },
    llm: {
      run: vi
        .fn()
        .mockResolvedValueOnce(
          JSON.stringify({ pois: [{ name: "外滩", type: "sight", reason: "好看", sourceNoteId: "note1", sourceType: "text" }], filtered: [] })
        )
        .mockResolvedValue(JSON.stringify({ days: [{ index: 1, items: [planItem()] }], filtered: [], warnings: [] }))
    },
    map: {
      searchPoi: vi.fn().mockResolvedValue({ amapId: "a1", name: "外滩", cityName: "上海市", location: { lng: 1, lat: 1 }, address: "addr" }),
      route: vi.fn().mockResolvedValue({ durationMin: 5, distanceKm: 1 })
    }
  };
}

function grounded() {
  return { name: "外滩", type: "sight", reason: "好看", sourceNoteId: "note1", sourceType: "text", verified: true, amapId: "a1", location: { lng: 1, lat: 1 }, address: "addr" };
}

function planItem() {
  return { id: "i1", poiId: "a1", name: "外滩", type: "sight", startTime: "09:00", durationMin: 60, address: "addr", verified: true, location: { lng: 1, lat: 1 }, reason: "好看" };
}
