import { afterEach, describe, expect, it, vi } from "vitest";
import type { LLMRunner } from "@/lib/llm/types";
import type { MapProvider } from "@/lib/map/types";
import { __resetProvidersForTest } from "@/lib/llm/router";
import { buildPlanPrompt } from "@/lib/prompts/plan";
import { backtrackRatio } from "./geo";
import { nearestClusterOrder, planItemFromPoi, recommendLegTransport, runPlan } from "./plan";
import type { GroundedPoi, PlanItem, TripInput } from "./types";

const input: TripInput = {
  links: ["https://xhslink.com/1"],
  destination: "上海",
  days: { base: 2, flex: 0 },
  transport: "public",
  pace: "moderate"
};

describe("runPlan", () => {
  afterEach(() => __resetProvidersForTest());

  it("rehydrates legal slot output by id and emits slot items without startTime", async () => {
    const grounded = [gp("p-a", "外滩", 121.49, 31.24), gp("p-b", "早餐店", 121.5, 31.24, true, "food")];
    const llm = llmWith({ days: [{ theme: "市区", slots: { morning: ["p-a"], afternoon: ["p-b"], evening: [] } }] });
    __resetProvidersForTest({ deepseek: llm, "claude-cli": llm });
    const result = await runPlan(grounded, [], input, mapWithRoute(async () => ({ durationMin: 10, distanceKm: 1 })));

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
    const llm = llmWith({ days: [{ slots: { morning: ["p-a", "made-up"], afternoon: [], evening: [] } }] });
    __resetProvidersForTest({ deepseek: llm, "claude-cli": llm });
    const result = await runPlan(
      grounded,
      [],
      input,
      mapWithRoute(async () => ({ durationMin: 10, distanceKm: 1 }))
    );

    expect(result.days[0].items.map((item) => item.poiId)).toEqual(["p-a"]);
    expect(result.warnings.some((warning) => warning.includes("made-up"))).toBe(true);
  });

  it("falls back after one failed llm call and keeps selected POIs non-empty", async () => {
    const grounded = [gp("p-a", "外滩", 121.49, 31.24), gp("p-b", "豫园", 121.5, 31.23), gp("p-c", "咖啡", 121.51, 31.22)];
    const llm: LLMRunner = { run: vi.fn().mockRejectedValue(new Error("timeout")) };
    __resetProvidersForTest({ deepseek: llm, "claude-cli": llm });
    const result = await runPlan(grounded, [], input, mapWithRoute(async () => ({ durationMin: 10, distanceKm: 1 })));

    expect(llm.run).toHaveBeenCalledTimes(1);
    expect(result.days.flatMap((day) => day.items)).not.toHaveLength(0);
    expect(result.warnings).toContain("LLM 分天失败,已按地理就近自动分配");
  });

  it("keeps unverified selected POIs in a non-empty fallback plan", async () => {
    const grounded = [gp("u-a", "笔记小店", 121.49, 31.24, false)];
    grounded[0].location = undefined;
    const llm = llmWith({ days: [{ slots: { morning: ["u-a"], afternoon: [], evening: [] } }] });
    __resetProvidersForTest({ deepseek: llm, "claude-cli": llm });
    const result = await runPlan(
      grounded,
      [],
      input,
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

    const llm = llmWith({ days: [{ slots: { morning: ["near-a", "near-b"], afternoon: ["far-c", "far-d"], evening: [] } }] });
    __resetProvidersForTest({ deepseek: llm, "claude-cli": llm });
    const result = await runPlan(
      grounded,
      [],
      { ...input, days: { base: 1, flex: 0 } },
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

    const llm = llmWith({ days: [{ slots: { morning: ["a"], afternoon: ["c"], evening: [] } }] });
    __resetProvidersForTest({ deepseek: llm, "claude-cli": llm });
    const result = await runPlan(
      grounded,
      [],
      { ...input, days: { base: 1, flex: 0 } },
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

    __resetProvidersForTest({ deepseek: llm, "claude-cli": llm });
    await runPlan(grounded, [], input, { searchPoi: vi.fn(), route });
  });

  it("parses suggestedDuration and uses type defaults", async () => {
    const grounded = [
      { ...gp("a", "体验", 121, 31, true, "experience"), suggestedDuration: "2小时" },
      gp("b", "餐厅", 121.02, 31, true, "food")
    ];

    const llm = llmWith({ days: [{ slots: { morning: ["a"], afternoon: ["b"], evening: [] } }] });
    __resetProvidersForTest({ deepseek: llm, "claude-cli": llm });
    const result = await runPlan(
      grounded,
      [],
      { ...input, days: { base: 1, flex: 0 } },
      mapWithRoute(async () => ({ durationMin: 10, distanceKm: 1 }))
    );

    expect(result.days[0].items.map((item) => item.durationMin)).toEqual([120, 60]);
  });

  it("pre-filters oversized candidates by priority before planning", async () => {
    const reasonOnly = Array.from({ length: 8 }, (_, index) => gp(`r${index}`, `理由${index}`, 121.02 + index * 0.01, 31, false));
    const timed = { ...gp("timed", "有时间", 121.2, 31, false), timeHint: "上午" };
    const verified = gp("verified", "已验证", 121.21, 31, true);
    const grounded = [...reasonOnly, timed, verified];
    const llm: LLMRunner = {
      run: vi.fn(async (opts) => {
        expect(opts.prompt).toContain('"id":"verified"');
        expect(opts.prompt).toContain('"id":"timed"');
        expect(opts.prompt).not.toContain('"id":"r6"');
        expect(opts.prompt).not.toContain('"id":"r7"');
        return JSON.stringify({ days: [{ slots: { morning: ["verified"], afternoon: ["timed"], evening: [] } }] });
      })
    };

    __resetProvidersForTest({ deepseek: llm, "claude-cli": llm });
    const result = await runPlan(
      grounded,
      [],
      { ...input, days: { base: 1, flex: 0 }, pace: "moderate" },
      mapWithRoute(async () => ({ durationMin: 5, distanceKm: 1 }))
    );

    expect(result.filtered.filter((item) => item.reason.includes("行程容量")).map((item) => item.name)).toEqual(["理由6", "理由7"]);
  });

  it("deterministically repairs overload and backtracking using the 720/90/1.5 thresholds", async () => {
    const grounded = [
      { ...gp("a", "A", 0, 0), suggestedDuration: "300分钟" },
      { ...gp("b", "B", 3, 0), suggestedDuration: "300分钟" },
      { ...gp("c", "C", 1, 0), suggestedDuration: "300分钟" },
      { ...gp("d", "D", 2, 0), suggestedDuration: "300分钟" }
    ];

    const llm = llmWith({ days: [{ slots: { morning: ["a", "b"], afternoon: ["c", "d"], evening: [] } }] });
    __resetProvidersForTest({ deepseek: llm, "claude-cli": llm });
    const result = await runPlan(
      grounded,
      [],
      { ...input, days: { base: 1, flex: 0 } },
      mapWithRoute(async () => ({ durationMin: 5, distanceKm: 1 }))
    );
    const day = result.days[0];
    const totalMin = day.items.reduce((sum, item) => sum + item.durationMin + (item.transportToNext?.durationMin ?? 0), 0);
    const maxSegment = Math.max(0, ...day.items.map((item) => item.transportToNext?.durationMin ?? 0));
    const points = day.items.map((item) => item.location).filter(Boolean) as { lng: number; lat: number }[];

    expect(totalMin).toBeLessThanOrEqual(720);
    expect(maxSegment).toBeLessThanOrEqual(90);
    expect(backtrackRatio(points)).toBeLessThanOrEqual(1.5);
    expect(result.filtered.some((item) => item.reason.includes("超载兜底裁剪"))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("兜底"))).toBe(true);
  });

  it("keeps transitively clustered members adjacent during slot sorting", async () => {
    const grounded = [
      gp("a", "A", 0, 0),
      gp("b", "B", 0, 0.0018),
      gp("c", "C", 0, 0.0036),
      gp("x", "X", 0, 0.0027)
    ];

    const llm = llmWith({ days: [{ slots: { morning: ["a", "x"], afternoon: [], evening: [] } }] });
    __resetProvidersForTest({ deepseek: llm, "claude-cli": llm });
    const result = await runPlan(
      grounded,
      [],
      { ...input, days: { base: 1, flex: 0 } },
      mapWithRoute(async () => ({ durationMin: 5, distanceKm: 1 }))
    );
    const names = result.days[0].items.map((item) => item.name);
    const clusterIndexes = ["A", "B", "C"].map((name) => names.indexOf(name));

    expect(Math.max(...clusterIndexes) - Math.min(...clusterIndexes)).toBe(2);
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

describe("recommendLegTransport", () => {
  it("uses transport preferences to choose short and long leg modes", async () => {
    const route = vi.fn(async (_from, _to, mode) => ({ durationMin: mode === "bike" ? 10 : 20, distanceKm: mode === "bike" ? 1.5 : 3 }));

    const short = await recommendLegTransport(
      item("near-a", 121, 31),
      item("near-b", 121.0159, 31),
      { transport: "public" },
      { route },
      Number.POSITIVE_INFINITY,
      { shortKm: 2, shortMode: "bike", longMode: "drive" }
    );
    const long = await recommendLegTransport(
      item("far-a", 121, 31),
      item("far-b", 121.0318, 31),
      { transport: "public" },
      { route },
      Number.POSITIVE_INFINITY,
      { shortKm: 2, shortMode: "bike", longMode: "drive" }
    );

    expect(short?.mode).toBe("bike");
    expect(long?.mode).toBe("drive");
  });

  it("keeps legacy distance behavior when no preferences are passed", async () => {
    const route = vi.fn(async (_from, _to, mode) => ({ durationMin: 8, distanceKm: 0.5, mode }));

    const result = await recommendLegTransport(item("a", 121, 31), item("b", 121.0045, 31), { transport: "drive" }, { route });

    expect(result?.mode).toBe("walk");
    expect(route).toHaveBeenCalledWith(expect.anything(), expect.anything(), "walk");
  });

  it("keeps same-cluster walk shortcut even when preferences prefer bike", async () => {
    const route = vi.fn(async () => ({ durationMin: 8, distanceKm: 0.5 }));

    const result = await recommendLegTransport(
      { ...item("a", 121, 31), clusterKey: "cluster-1" },
      { ...item("b", 121.0045, 31), clusterKey: "cluster-1" },
      { transport: "drive" },
      { route },
      Number.POSITIVE_INFINITY,
      { shortKm: 2, shortMode: "bike", longMode: "drive" }
    );

    expect(result?.mode).toBe("walk");
    expect(route).not.toHaveBeenCalled();
  });

  it("exports plan item and nearest cluster helpers", () => {
    const poi = gp("p1", "外滩", 121, 31);
    const planItem = planItemFromPoi(poi, "morning", "cluster-1");
    const ordered = nearestClusterOrder([item("a", 121, 31), item("b", 121.01, 31)]);

    expect(planItem).toMatchObject({ name: "外滩", slot: "morning", clusterKey: "cluster-1" });
    expect(ordered).toHaveLength(2);
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

function llmWith(result: unknown): LLMRunner & { run: ReturnType<typeof vi.fn> } {
  return { run: vi.fn().mockResolvedValue(JSON.stringify(result)) };
}

function mapWithRoute(route: MapProvider["route"]): MapProvider {
  return { searchPoi: vi.fn(), searchPois: vi.fn(), route: vi.fn(route) };
}

function item(id: string, lng: number, lat: number): PlanItem {
  return { id, name: id, durationMin: 60, location: { lng, lat }, clusterKey: id };
}
