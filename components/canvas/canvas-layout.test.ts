import { describe, expect, it } from "vitest";
import type { PlanItem } from "@/lib/pipeline/types";
import { STICKER_H, STICKER_W, expandedPos, groupAdjacent, itemKey, poolPos } from "./canvas-layout";

describe("canvas item instance layout", () => {
  it.each([
    { label: "相邻", items: [hotel("hotel-out"), hotel("hotel-back"), item("museum")] },
    { label: "不相邻", items: [hotel("hotel-out"), item("museum"), hotel("hotel-back")] }
  ])("同一 POI $label出现时生成两张不重叠的独立卡片", ({ items }) => {
    const groups = groupAdjacent(items);
    const hotelGroups = groups.filter((group) => group.items[0].poiId === "hotel-poi");
    const positions = hotelGroups.map((group) => expandedPos(1, groups.indexOf(group)));

    expect(hotelGroups.map((group) => group.id)).toEqual(["hotel-out", "hotel-back"]);
    expect(overlaps(positions[0], positions[1])).toBe(false);
  });

  it("池布局和持久化位置都以 uid 区分同一 POI 的实例", () => {
    const first = hotel("hotel-out");
    const second = hotel("hotel-back");
    const positions = {
      [itemKey(first)]: poolPos(0, itemKey(first), 1),
      [itemKey(second)]: poolPos(1, itemKey(second), 1)
    };

    expect(itemKey(first)).not.toBe(itemKey(second));
    expect(Object.keys(positions)).toEqual(["hotel-out", "hotel-back"]);
    expect(overlaps(positions["hotel-out"], positions["hotel-back"])).toBe(false);
  });
});

function hotel(uid: string): PlanItem {
  return { ...item(uid), id: "hotel-poi", poiId: "hotel-poi", name: "同一家酒店", clusterKey: "hotel-poi" };
}

function item(uid: string): PlanItem {
  return { uid, id: uid, poiId: uid, name: uid, durationMin: 60 };
}

function overlaps(a: { x: number; y: number }, b: { x: number; y: number }) {
  return a.x < b.x + STICKER_W && a.x + STICKER_W > b.x && a.y < b.y + STICKER_H && a.y + STICKER_H > b.y;
}
