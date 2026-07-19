import type { PoiType } from "@/lib/pipeline/types";

/**
 * 高德 POI 分类大类(typecode 前 2 位)→ packup 的 6 类地点卡片。
 *
 * 两边的分类轴并不一致:高德按「物理设施」分,我们按「旅行意义」分。
 * 交通设施(地铁站)、商务住宅(重庆大厦)、地名地址(星光大道、兰桂坊这类本质是街道的景点)
 * 在高德没有旅行语义,一律落 other,由用户在详情抽屉里手动改。
 * 拿 185 条真实 POI 与 LLM 判定对比,这套映射一致率约 79%。
 */
const BY_MAJOR: Record<string, PoiType> = {
  "05": "food", // 餐饮服务
  "06": "shop", // 购物服务
  "08": "experience", // 体育休闲服务
  "10": "stay", // 住宿服务
  "11": "sight", // 风景名胜
  "14": "sight" // 科教文化服务(博物馆/美术馆/科技馆)
};

/** 高德可能返回多分类(如天星小轮 `110000|070000`),取首个 */
export function poiTypeFromAmap(typecode?: string): PoiType {
  if (!typecode) return "other";
  return BY_MAJOR[typecode.split("|")[0].trim().slice(0, 2)] ?? "other";
}
