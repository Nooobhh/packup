import { describe, expect, it } from "vitest";
import { TripInputSchema, TripPlanSchema } from "./types";

describe("TripInputSchema", () => {
  const valid = {
    links: ["https://www.xiaohongshu.com/explore/abc"],
    destination: "上海",
    days: { base: 3, flex: 1 },
    dailyThemes: ["市区", "美食"],
    transport: "public",
    pace: "moderate"
  };

  it("parses a valid trip input", () => {
    expect(TripInputSchema.parse(valid).destination).toBe("上海");
  });

  it.each([
    [{ ...valid, links: [] }, "zero links"],
    [{ ...valid, links: Array.from({ length: 11 }, (_, i) => `https://www.xiaohongshu.com/explore/${i}`) }, "eleven links"],
    [{ ...valid, days: { base: 15, flex: 1 } }, "sixteen total days"],
    [{ ...valid, days: undefined, dailyThemes: ["主题"] }, "themes without days"]
  ])("rejects %s", (input) => {
    expect(() => TripInputSchema.parse(input)).toThrow();
  });
});

describe("TripPlanSchema", () => {
  it("parses a plan with all filtered stages and daysDecision", () => {
    const plan = {
      tripId: "trip_1",
      destination: "上海",
      daysDecision: {
        requested: "base 2 flex 1",
        actualDays: 3,
        reason: "内容量适合三天"
      },
      days: [
        {
          day: 1,
          theme: "外滩",
          items: [
            {
              id: "item_1",
              poiId: "poi_1",
              name: "外滩",
              type: "景点",
              startTime: "09:30",
              durationMin: 90,
              address: "中山东一路",
              openHours: "全天",
              verified: true,
              location: { lng: 121.4903, lat: 31.2417 },
              reason: "笔记说这里适合上午散步",
              note: "安排在早段避开人流",
              transportToNext: { durationMin: 20, distanceKm: 4.2, mode: "public" }
            }
          ]
        }
      ],
      filtered: [
        { id: "f1", name: "广告", stage: "extract", sourceNoteId: "n1", reason: "广告内容" },
        { id: "f2", name: "苏州店", stage: "ground", sourceNoteId: "n2", reason: "实际城市为苏州" },
        { id: "f3", name: "远郊点", stage: "plan", sourceNoteId: "n3", reason: "容量不足" }
      ],
      warnings: ["openHours 缺失"]
    };

    expect(TripPlanSchema.parse(plan).filtered.map((item) => item.stage)).toEqual([
      "extract",
      "ground",
      "plan"
    ]);
  });
});
