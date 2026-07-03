import { describe, expect, it, vi } from "vitest";
import type { LLMRunner } from "@/lib/llm/types";
import type { MapProvider } from "@/lib/map/types";
import { buildPlanPrompt } from "@/lib/prompts/plan";
import { backtrackRatio } from "./geo";
import { runPlan } from "./plan";
import type { GroundedPoi, TripInput, TripPlan } from "./types";

const input: TripInput = {
  links: ["https://xhslink.com/1"],
  destination: "上海",
  days: { base: 2, flex: 1 },
  dailyThemes: ["市区"],
  transport: "public",
  pace: "moderate"
};

describe("runPlan", () => {
  it("samples at most 15 nearest route edges before LLM, retries validation once, and precision-routes adjacent items", async () => {
    const grounded = Array.from({ length: 10 }, (_, i) => gp(`p${i}`, i, 0));
    const routeCalls: Array<{ phase: "sample" | "adjacent"; from: number; to: number }> = [];
    let afterLlm = false;
    const map = mapWithRoute(async (from, to) => {
      routeCalls.push({ phase: afterLlm ? "adjacent" : "sample", from: from.lng, to: to.lng });
      return { durationMin: Math.abs(to.lng - from.lng) * 10 + 5, distanceKm: Math.abs(to.lng - from.lng) };
    });
    const validPlan = planWithItems([grounded[0], grounded[1], grounded[2]]);
    const llm: LLMRunner = {
      run: vi
        .fn()
        .mockResolvedValueOnce(JSON.stringify({ days: [] }))
        .mockImplementationOnce(async (opts) => {
          afterLlm = true;
          expect(routeCalls.filter((call) => call.phase === "sample").length).toBeLessThanOrEqual(15);
          expect(routeCalls.filter((call) => call.phase === "sample").length).toBeGreaterThan(0);
          expect(routeCalls.slice(0, 3).map((call) => call.to - call.from)).toEqual([1, 1, 1]);
          expect(opts.prompt).toContain("候选边");
          expect(opts.prompt).toContain("上次输出未通过校验");
          return JSON.stringify(validPlan);
        })
    };

    const result = await runPlan(grounded, [], input, llm, map);

    expect(llm.run).toHaveBeenCalledTimes(2);
    expect(routeCalls.filter((call) => call.phase === "adjacent")).toHaveLength(2);
    expect(result.days[0].items[0].transportToNext).toMatchObject({ mode: "public" });
  });

  it("falls back after two failed repair rounds so final plan is not overloaded or backtracking", async () => {
    const grounded = [gp("a", 0, 0), gp("b", 1, 0), gp("c", 2, 0), gp("d", 3, 0)];
    const badPlan = planWithItems([grounded[0], grounded[3], grounded[1], grounded[2]], 300);
    const llm: LLMRunner = { run: vi.fn().mockResolvedValue(JSON.stringify(badPlan)) };
    const map = mapWithRoute(async () => ({ durationMin: 5, distanceKm: 1 }));

    const result = await runPlan(grounded, [], input, llm, map);
    const day = result.days[0];
    const points = day.items.map((item) => item.location ?? item.poi?.location).filter(Boolean) as { lng: number; lat: number }[];
    const totalMin = day.items.reduce((sum, item) => sum + item.durationMin + (item.transportToNext?.durationMin ?? 0), 0);

    expect(llm.run).toHaveBeenCalledTimes(3);
    expect(backtrackRatio(points)).toBeLessThanOrEqual(1.5);
    expect(totalMin).toBeLessThanOrEqual(720);
    expect(result.filtered.some((item) => item.stage === "plan" && item.reason.includes("超载兜底裁剪"))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("兜底"))).toBe(true);
  });

  it("sends previous plan order, measured transport, and structured violations to repair prompt", async () => {
    const grounded = [gp("a", 0, 0), gp("b", 1, 0), gp("c", 2, 0)];
    const badPlan = planWithItems([grounded[0], grounded[1]], 400);
    const repairedPlan = planWithItems([grounded[0]], 60);
    const llm: LLMRunner = {
      run: vi
        .fn()
        .mockResolvedValueOnce(JSON.stringify(badPlan))
        .mockImplementationOnce(async (opts) => {
          expect(opts.prompt).toContain("上一版 TripPlan");
          expect(opts.prompt).toContain('"name":"a"');
          expect(opts.prompt).toContain('"name":"b"');
          expect(opts.prompt).toContain('"startTime":"09:00"');
          expect(opts.prompt).toContain('"durationMin":400');
          expect(opts.prompt).toContain('"transportToNext"');
          expect(opts.prompt).toContain('"durationMin":95');
          expect(opts.prompt).toContain('"threshold":720');
          expect(opts.prompt).toContain('"threshold":90');
          expect(opts.prompt).toContain("保留未违规天/段");
          expect(opts.prompt).toContain("仅重排违规部分");
          return JSON.stringify(repairedPlan);
        })
    };
    const map = mapWithRoute(async () => ({ durationMin: 95, distanceKm: 1 }));

    await runPlan(grounded, [], input, llm, map);

    expect(llm.run).toHaveBeenCalledTimes(2);
  });

  it("adds daysDecision when days are omitted and keeps floating output inside range", async () => {
    const grounded = [gp("a", 0, 0), gp("b", 1, 0), gp("c", 2, 0)];
    const map = mapWithRoute(async () => ({ durationMin: 5, distanceKm: 1 }));
    const missingDaysInput = { ...input, days: undefined, dailyThemes: undefined };
    const result = await runPlan(grounded, [], missingDaysInput, { run: vi.fn().mockResolvedValue(JSON.stringify(planWithItems([grounded[0]]))) }, map);
    expect(result.daysDecision).toBeTruthy();

    const floating = await runPlan(grounded, [], input, { run: vi.fn().mockResolvedValue(JSON.stringify(planWithItems([grounded[0], grounded[1]]))) }, map);
    expect(floating.days.length).toBeGreaterThanOrEqual(1);
    expect(floating.days.length).toBeLessThanOrEqual(3);
  });

  it("removes hallucinated plan items that are not present in grounded input", async () => {
    const grounded = [gp("真实地点", 1, 1)];
    const plan = planWithItems([grounded[0]]);
    plan.days[0].items.push({
      name: "LLM编造地点",
      type: "sight",
      startTime: "10:00",
      durationMin: 60,
      verified: true,
      location: { lng: 9, lat: 9 },
      address: "不存在地址"
    });
    const result = await runPlan(grounded, [], input, { run: vi.fn().mockResolvedValue(JSON.stringify(plan)) }, mapWithRoute(async () => ({ durationMin: 5, distanceKm: 1 })));

    expect(result.days[0].items.map((item) => item.name)).toEqual(["真实地点"]);
    expect(result.warnings).toContain("排程输出包含未经核实的条目已剔除: LLM编造地点");
  });

  it("rehydrates plan items from grounded truth when LLM tampers with verification fields", async () => {
    const grounded = [gp("未验证地点", 2, 2, false)];
    grounded[0].location = undefined;
    grounded[0].address = undefined;
    const tampered = planWithItems([grounded[0]]);
    tampered.days[0].items[0] = {
      ...tampered.days[0].items[0],
      verified: true,
      location: { lng: 99, lat: 99 },
      address: "LLM编造地址",
      openHours: "24小时"
    };

    const result = await runPlan(grounded, [], input, { run: vi.fn().mockResolvedValue(JSON.stringify(tampered)) }, mapWithRoute(async () => ({ durationMin: 5, distanceKm: 1 })));

    expect(result.days[0].items[0]).toMatchObject({
      name: "未验证地点",
      verified: false
    });
    expect(result.days[0].items[0].location).toBeUndefined();
    expect(result.days[0].items[0].address).toBeUndefined();
    expect(result.days[0].items[0].openHours).toBeUndefined();
  });
});

describe("buildPlanPrompt", () => {
  it("contains the decision charter, pace mapping, and theme hard constraint", () => {
    const prompt = buildPlanPrompt({ grounded: [], upstreamFiltered: [], input, distanceMatrix: [], routeSamples: [] });
    expect(prompt).toContain("客观事实");
    expect(prompt).toContain("用户显式输入");
    expect(prompt).toContain("笔记建议");
    expect(prompt).toContain("packed 5-7");
    expect(prompt).toContain("dailyThemes 硬约束");
  });

  it("serializes floating days, daily themes, selected pace range, and startDate weekdays", () => {
    const prompt = buildPlanPrompt({
      grounded: [],
      upstreamFiltered: [],
      input: {
        ...input,
        days: { base: 2, flex: 1 },
        dailyThemes: ["市区"],
        pace: "moderate",
        startDate: "2026-07-03"
      },
      distanceMatrix: [],
      routeSamples: []
    });

    expect(prompt).toContain("days.base=2");
    expect(prompt).toContain("days.flex=1");
    expect(prompt).toContain("实际天数范围 1-3");
    expect(prompt).toContain("Day 1: 主题=市区");
    expect(prompt).toContain("Day 2: 主题=无主题");
    expect(prompt).toContain("pace=moderate");
    expect(prompt).toContain("moderate 3-5");
    expect(prompt).toContain("startDate=2026-07-03");
    expect(prompt).toContain("Day 1: 日期=2026-07-03 星期五");
    expect(prompt).toContain("Day 2: 日期=2026-07-04 星期六");
  });

  it("serializes omitted days as recommendation instructions with selected relaxed pace", () => {
    const prompt = buildPlanPrompt({
      grounded: [],
      upstreamFiltered: [],
      input: {
        links: ["https://xhslink.com/1"],
        destination: "上海",
        transport: "walk",
        pace: "relaxed"
      },
      distanceMatrix: [],
      routeSamples: []
    });

    expect(prompt).toContain("days=缺省");
    expect(prompt).toContain("按内容量推荐");
    expect(prompt).toContain("cap 15");
    expect(prompt).toContain("pace=relaxed");
    expect(prompt).toContain("relaxed 2-3");
  });

  it("serializes startDate with weekday derivation instructions when days are omitted", () => {
    const prompt = buildPlanPrompt({
      grounded: [],
      upstreamFiltered: [],
      input: {
        links: ["https://xhslink.com/1"],
        destination: "上海",
        startDate: "2026-07-03",
        transport: "public",
        pace: "moderate"
      },
      distanceMatrix: [],
      routeSamples: []
    });

    expect(prompt).toContain("startDate=2026-07-03(星期五)");
    expect(prompt).toContain("按你选定的天数从该日期推导每日星期,核对 openHours");
    expect(prompt).not.toContain("startDate=未提供");
  });
});

function gp(name: string, lng: number, lat: number, verified = true): GroundedPoi {
  return {
    name,
    type: "sight",
    reason: `${name} reason`,
    sourceNoteId: name,
    sourceType: "text",
    verified,
    amapId: name,
    location: { lng, lat },
    address: `${name} addr`
  };
}

function planWithItems(pois: GroundedPoi[], durationMin = 60): TripPlan {
  return {
    days: [
      {
        index: 1,
        items: pois.map((poi, index) => ({
          id: `i-${poi.name}`,
          poiId: poi.amapId,
          name: poi.name,
          type: poi.type,
          startTime: `${String(9 + index).padStart(2, "0")}:00`,
          durationMin,
          address: poi.address,
          verified: poi.verified,
          location: poi.location,
          reason: poi.reason
        }))
      }
    ],
    filtered: [],
    warnings: []
  };
}

function mapWithRoute(route: MapProvider["route"]): MapProvider {
  return { searchPoi: vi.fn(), route: vi.fn(route) };
}

describe("budgetPois pre-filtering", () => {
  it("caps oversized candidate sets before planning and files overflow as filtered", async () => {
    // 30 POI 排 3 天 moderate → 预算 ceil(5*3*1.5)=23,应砍 7 个进 filtered
    const many = Array.from({ length: 30 }, (_, i) => gp(`P${i}`, 114 + i * 0.001, 22 + i * 0.001, true));
    const llm: LLMRunner = {
      run: vi.fn(async (opts) => {
        // 断言 prompt 里可排 POI 不超过预算(体现预筛已生效)
        const poiCount = (opts.prompt.match(/"name":/g) || []).length;
        return JSON.stringify({
          days: [{ index: 1, items: [{ name: "P0", startTime: "09:00", durationMin: 60 }] }],
          filtered: [],
          warnings: [],
          daysDecision: null
        });
      })
    };
    const map: MapProvider = {
      searchPoi: vi.fn(),
      route: vi.fn(async () => ({ durationMin: 10, distanceKm: 1 }))
    };
    const input: TripInput = { links: ["x"], destination: "香港", days: { base: 3, flex: 0 }, pace: "moderate" };
    const plan = await runPlan(many, [], input, llm, map);
    const budgetFiltered = plan.filtered.filter((f) => f.why?.includes("行程容量"));
    expect(budgetFiltered.length).toBe(7);
  });
});
