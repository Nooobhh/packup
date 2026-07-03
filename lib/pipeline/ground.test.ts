import { describe, expect, it, vi } from "vitest";
import type { MapProvider } from "@/lib/map/types";
import { BUDGETS } from "./budgets";
import { runGround } from "./ground";
import type { CandidatePoi, TripInput } from "./types";

const input: TripInput = {
  links: ["https://xhslink.com/1"],
  destination: "上海",
  transport: "public",
  pace: "moderate"
};

describe("runGround", () => {
  it("fills verified POI fields on hit", async () => {
    const map = mapWithSearch([{ amapId: "a1", name: "外滩", cityName: "上海市", location: { lng: 1, lat: 2 }, address: "addr" }]);
    const result = await runGround([poi("外滩")], input, map);
    expect(result.grounded[0]).toMatchObject({ id: "a1", name: "外滩", verified: true, amapId: "a1", address: "addr" });
    expect(result.filtered).toEqual([]);
  });

  it("simplifies the name and retries once before keeping unverified", async () => {
    const searchPoi = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ amapId: "a2", name: "咖啡", cityName: "上海市", location: { lng: 3, lat: 4 } });
    const hit = await runGround([poi("咖啡(上海店)")], input, { searchPoi, route: vi.fn() });
    expect(searchPoi.mock.calls.map((call) => call[0])).toEqual(["咖啡(上海店)", "咖啡"]);
    expect(hit.grounded[0]).toMatchObject({ verified: true, amapId: "a2" });

    const miss = await runGround([poi("不存在")], input, mapWithSearch([null, null]));
    expect(miss.grounded[0]).toMatchObject({ id: "unverified-n1-1", name: "不存在", verified: false });
    expect(miss.grounded[0].location).toBeUndefined();
  });

  it("assigns stable unique ids to verified and unverified POIs", async () => {
    const result = await runGround(
      [poi("外滩", "note-a"), poi("未知A", "note-a"), poi("未知B", "note-b")],
      input,
      mapWithSearch([
        { amapId: "amap-1", name: "外滩", cityName: "上海市", location: { lng: 1, lat: 2 } },
        null,
        null,
        null,
        null
      ])
    );

    expect(result.grounded.map((item) => item.id)).toEqual(["amap-1", "unverified-note-a-2", "unverified-note-b-1"]);
  });

  it("marks remaining POIs unverified when the ground stage deadline expires", async () => {
    const original = BUDGETS.groundStageMs;
    (BUDGETS as { groundStageMs: number }).groundStageMs = 10;
    try {
      const searchPoi = vi.fn(() => new Promise((resolve) => setTimeout(() => resolve({ amapId: "late", name: "迟到", cityName: "上海市", location: { lng: 1, lat: 1 } }), 50)));

      const result = await runGround([poi("慢点", "n1"), poi("剩余", "n2")], input, { searchPoi, route: vi.fn() });

      expect(searchPoi).toHaveBeenCalledTimes(1);
      expect(result.grounded).toHaveLength(2);
      expect(result.grounded.every((item) => item.verified === false)).toBe(true);
      expect(result.grounded.map((item) => item.id)).toEqual(["unverified-n1-1", "unverified-n2-1"]);
    } finally {
      (BUDGETS as { groundStageMs: number }).groundStageMs = original;
    }
  });

  it("moves cross-city results into ground filtered", async () => {
    const result = await runGround(
      [poi("苏州店")],
      input,
      mapWithSearch([{ amapId: "s1", name: "苏州店", cityName: "苏州市", location: { lng: 1, lat: 1 } }])
    );
    expect(result.grounded).toEqual([]);
    expect(result.filtered[0]).toMatchObject({ name: "苏州店", stage: "ground", reason: expect.stringContaining("苏州市") });
  });

  it("dedupes same amapId, merges reason/source, and preserves total input count through filtered duplicates", async () => {
    const result = await runGround(
      [poi("店A", "n1", "理由A"), poi("店A别名", "n2", "理由B")],
      input,
      mapWithSearch([
        { amapId: "dup", name: "店A", cityName: "上海市", location: { lng: 1, lat: 1 } },
        { amapId: "dup", name: "店A", cityName: "上海市", location: { lng: 1, lat: 1 } }
      ])
    );

    expect(result.grounded).toHaveLength(1);
    expect(result.grounded[0].reason).toContain("理由A");
    expect(result.grounded[0].reason).toContain("理由B");
    expect(result.grounded[0].sourceNoteId).toContain("n1");
    expect(result.grounded[0].sourceNoteId).toContain("n2");
    expect(result.filtered).toHaveLength(1);
    expect(result.grounded.length + result.filtered.length).toBe(2);
  });
});

function poi(name: string, sourceNoteId = "n1", reason = "笔记理由"): CandidatePoi {
  return { name, type: "sight", city: "上海", reason, sourceNoteId, sourceType: "text" };
}

function mapWithSearch(results: unknown[]): MapProvider {
  const searchPoi = vi.fn();
  for (const result of results) searchPoi.mockResolvedValueOnce(result);
  return { searchPoi, route: vi.fn() };
}
