import { describe, expect, it, vi } from "vitest";
import type { LLMRunner } from "@/lib/llm/types";
import type { MapProvider } from "@/lib/map/types";
import { buildPlanPrompt } from "@/lib/prompts/plan";
import { runPlan } from "./plan";
import type { GroundedPoi, TripInput } from "./types";

const input: TripInput = {
  links: ["https://xhslink.com/1"],
  destination: "上海",
  days: { base: 2, flex: 0 },
  transport: "public",
  pace: "moderate"
};

describe("runPlan", () => {
  it("rehydrates legal slot output by id and emits slot items without startTime", async () => {
    const grounded = [gp("p-a", "外滩", 121.49, 31.24), gp("p-b", "早餐店", 121.5, 31.24, true, "food")];
    const llm = llmWith({ days: [{ theme: "市区", slots: { morning: ["p-a"], afternoon: ["p-b"], evening: [] } }] });
    const result = await runPlan(grounded, [], input, llm, mapWithRoute(async () => ({ durationMin: 10, distanceKm: 1 })));

    expect(result.days[0].items[0]).toMatchObject({
      poiId: "p-a",
      name: "外滩",
      slot: "morning",
      clusterKey: "p-a",
      verified: true,
      location: grounded[0].location
    });
    expect(result.days[0].items[0].startTime).toBeUndefined();
    expect(result.days[0].items[1]).toMatchObject({ name: "早餐店", slot: "afternoon", durationMin: 60 });
  });

  it("drops hallucinated ids and warns while preserving valid ids", async () => {
    const grounded = [gp("p-a", "外滩", 121.49, 31.24)];
    const result = await runPlan(
      grounded,
      [],
      input,
      llmWith({ days: [{ slots: { morning: ["p-a", "made-up"], afternoon: [], evening: [] } }] }),
      mapWithRoute(async () => ({ durationMin: 10, distanceKm: 1 }))
    );

    expect(result.days[0].items.map((item) => item.poiId)).toEqual(["p-a"]);
    expect(result.warnings.some((warning) => warning.includes("made-up"))).toBe(true);
  });

  it("falls back after one failed llm call and keeps selected POIs non-empty", async () => {
    const grounded = [gp("p-a", "外滩", 121.49, 31.24), gp("p-b", "豫园", 121.5, 31.23), gp("p-c", "咖啡", 121.51, 31.22)];
    const llm: LLMRunner = { run: vi.fn().mockRejectedValue(new Error("timeout")) };
    const result = await runPlan(grounded, [], input, llm, mapWithRoute(async () => ({ durationMin: 10, distanceKm: 1 })));

    expect(llm.run).toHaveBeenCalledTimes(1);
    expect(result.days.flatMap((day) => day.items)).not.toHaveLength(0);
    expect(result.warnings).toContain("LLM 分天失败,已按地理就近自动分配");
  });

  it("keeps unverified selected POIs in a non-empty fallback plan", async () => {
    const grounded = [gp("u-a", "笔记小店", 121.49, 31.24, false)];
    grounded[0].location = undefined;
    const result = await runPlan(
      grounded,
      [],
      input,
      llmWith({ days: [{ slots: { morning: ["u-a"], afternoon: [], evening: [] } }] }),
      mapWithRoute(async () => ({ durationMin: 10, distanceKm: 1 }))
    );

    expect(result.days.flatMap((day) => day.items)).toHaveLength(1);
    expect(result.days[0].items[0]).toMatchObject({ name: "笔记小店", verified: false });
  });

  it("selects per-leg modes by distance and retries slow public legs with drive", async () => {
    const grounded = [
      gp("near-a", "近A", 121, 31),
      gp("near-b", "近B", 121.004, 31),
      gp("far-c", "远C", 121.06, 31),
      gp("far-d", "远D", 121.12, 31)
    ];
    const route = vi.fn(async (_from, _to, mode) => {
      if (mode === "public") return { durationMin: 95, distanceKm: 5 };
      if (mode === "drive") return { durationMin: 40, distanceKm: 5 };
      return { durationMin: 8, distanceKm: 0.5 };
    });

    const result = await runPlan(
      grounded,
      [],
      { ...input, days: { base: 1, flex: 0 } },
      llmWith({ days: [{ slots: { morning: ["near-a", "near-b"], afternoon: ["far-c", "far-d"], evening: [] } }] }),
      { searchPoi: vi.fn(), route }
    );

    expect(result.days[0].items[0].transportToNext?.mode).toBe("walk");
    expect(result.days[0].items[1].transportToNext?.mode).toBe("drive");
    expect(route).toHaveBeenCalledWith(expect.anything(), expect.anything(), "public");
    expect(route).toHaveBeenCalledWith(expect.anything(), expect.anything(), "drive");
  });

  it("does not call route between same-cluster members but routes across clusters", async () => {
    const grounded = [
      gp("a", "A", 121, 31),
      gp("b", "B", 121.0005, 31),
      gp("c", "C", 121.02, 31)
    ];
    const route = vi.fn(async () => ({ durationMin: 10, distanceKm: 1 }));

    const result = await runPlan(
      grounded,
      [],
      { ...input, days: { base: 1, flex: 0 } },
      llmWith({ days: [{ slots: { morning: ["a"], afternoon: ["c"], evening: [] } }] }),
      { searchPoi: vi.fn(), route }
    );

    expect(result.days[0].items.map((item) => item.name)).toEqual(["A", "B", "C"]);
    expect(result.days[0].items[0].transportToNext).toMatchObject({ mode: "walk" });
    expect(result.days[0].items[0].transportToNext?.polyline).toBeUndefined();
    expect(route).toHaveBeenCalledTimes(1);
  });

  it("does not call map.route while building LLM context", async () => {
    const grounded = [gp("a", "A", 121, 31), gp("b", "B", 122, 31)];
    const route = vi.fn(async () => ({ durationMin: 10, distanceKm: 1 }));
    const llm: LLMRunner = {
      run: vi.fn(async () => {
        expect(route).not.toHaveBeenCalled();
        return JSON.stringify({ days: [{ slots: { morning: ["a"], afternoon: ["b"], evening: [] } }] });
      })
    };

    await runPlan(grounded, [], input, llm, { searchPoi: vi.fn(), route });
  });

  it("parses suggestedDuration and uses type defaults", async () => {
    const grounded = [
      { ...gp("a", "体验", 121, 31, true, "experience"), suggestedDuration: "2小时" },
      gp("b", "餐厅", 121.02, 31, true, "food")
    ];

    const result = await runPlan(
      grounded,
      [],
      { ...input, days: { base: 1, flex: 0 } },
      llmWith({ days: [{ slots: { morning: ["a"], afternoon: ["b"], evening: [] } }] }),
      mapWithRoute(async () => ({ durationMin: 10, distanceKm: 1 }))
    );

    expect(result.days[0].items.map((item) => item.durationMin)).toEqual([120, 60]);
  });
});

describe("buildPlanPrompt", () => {
  it("serializes ids, preferences, day instruction, and slot schema without route samples", () => {
    const prompt = buildPlanPrompt({
      slimPois: [{ id: "p1", name: "外滩", type: "sight", members: ["外滩"] }],
      input: { ...input, preferences: ["city walk"] },
      distanceMatrix: [{ name: "外滩", near: [] }]
    });

    expect(prompt).toContain('"id":"p1"');
    expect(prompt).toContain("preferences");
    expect(prompt).toContain("morning");
    expect(prompt).toContain("afternoon");
    expect(prompt).toContain("evening");
    expect(prompt).not.toContain("routeSamples");
  });
});

function gp(id: string, name: string, lng: number, lat: number, verified = true, type: GroundedPoi["type"] = "sight"): GroundedPoi {
  return {
    id,
    name,
    type,
    reason: `${name} reason`,
    sourceNoteId: id,
    sourceType: "text",
    verified,
    amapId: verified ? id : undefined,
    location: { lng, lat },
    address: `${name} addr`
  };
}

function llmWith(result: unknown): LLMRunner {
  return { run: vi.fn().mockResolvedValue(JSON.stringify(result)) };
}

function mapWithRoute(route: MapProvider["route"]): MapProvider {
  return { searchPoi: vi.fn(), route: vi.fn(route) };
}
