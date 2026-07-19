import { describe, expect, it } from "vitest";
import { poiTypeFromAmap } from "./poi-type";

describe("poiTypeFromAmap", () => {
  it.each([
    ["050305", "food", "翠华餐厅 餐饮服务;快餐厅;茶餐厅"],
    ["060101", "shop", "海港城 购物服务;商场;购物中心"],
    ["061000", "shop", "庙街夜市 购物服务;特色商业街"],
    ["100103", "stay", "如心酒店 住宿服务;宾馆酒店"],
    ["110200", "sight", "太平山顶 风景名胜"],
    ["110101", "sight", "维多利亚公园 风景名胜;公园广场;公园"],
    ["080501", "experience", "迪士尼 体育休闲服务;休闲场所;游乐场"],
    ["140100", "sight", "香港历史博物馆 科教文化服务;博物馆"]
  ])("%s → %s (%s)", (typecode, expected) => {
    expect(poiTypeFromAmap(typecode)).toBe(expected);
  });

  it("高德多分类取首个:天星小轮 110000|070000 → sight", () => {
    expect(poiTypeFromAmap("110000|070000")).toBe("sight");
  });

  it.each([
    ["190301", "星光大道/兰桂坊 地名地址信息;道路名"],
    ["120201", "重庆大厦 商务住宅;楼宇"],
    ["150104", "香港国际机场 交通设施服务"]
  ])("没有旅行语义的 %s 落 other(%s),留给用户手动改", (typecode) => {
    expect(poiTypeFromAmap(typecode)).toBe("other");
  });

  it("缺失 typecode 落 other", () => {
    expect(poiTypeFromAmap(undefined)).toBe("other");
    expect(poiTypeFromAmap("")).toBe("other");
  });
});
