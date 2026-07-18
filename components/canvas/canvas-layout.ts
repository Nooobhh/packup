import type { PlanDay, PlanItem, TripPlan } from "@/lib/pipeline/types";

/**
 * 「工作画布」布局:画布本身无限,但默认内容收敛在一个长方形工作区里 ——
 * 上半是文件夹行(每行 FOLDER_PER_ROW 个,满行换行,不向右无限延伸),
 * 下半是待安排池,池顶随文件夹行数下移,始终紧贴文件夹区底部。
 * 新增 Day 因此落在工作区内而不是飞到远处;复位(fit)取的也是这个长方形。
 */
export const FOLDER_W = 208;
export const FOLDER_H = 156;
export const FOLDER_GAP_X = 660;
export const FOLDER_Y = 0;
export const FOLDER_PER_ROW = 3;
export const FOLDER_ROW_H = 260;
export const STICKER_W = 148;
export const STICKER_H = 172;
export const POOL_X = -60;
/** 文件夹区底部 → 池区顶部的留白 */
export const POOL_GAP_Y = 140;
export const POOL_STEP_X = 176;
export const POOL_ROW_H = 210;
export const POOL_PER_ROW = 7;

export function folderRows(dayCount: number): number {
  return Math.max(1, Math.ceil(dayCount / FOLDER_PER_ROW));
}

/** 池左上角(卡片网格起点):y 随文件夹行数下移 */
export function poolOrigin(dayCount: number): XY {
  return { x: POOL_X, y: FOLDER_Y + (folderRows(dayCount) - 1) * FOLDER_ROW_H + FOLDER_H + POOL_GAP_Y };
}

/** 池虚线框矩形(含标题浮出的上缘余量);空池也有固定尺寸,保证 fit 时找得到 */
export function poolZoneRect(dayCount: number, poolCount: number): { x: number; y: number; w: number; h: number } {
  const origin = poolOrigin(dayCount);
  const rows = Math.max(1, Math.ceil(poolCount / POOL_PER_ROW));
  return { x: origin.x - 48, y: origin.y - 70, w: POOL_PER_ROW * POOL_STEP_X + 80, h: rows * POOL_ROW_H + 90 };
}

export type XY = { x: number; y: number };

export type CanvasPersist = {
  view?: { tx: number; ty: number; scale: number };
  positions: Record<string, XY>;
};

/**
 * 条目主键:优先用实例 uid,不走 clusterKey 短路。
 * clusterKey 是 pipeline 阶段的"相邻同区聚成一张卡"语义,画布展开为每 POI 一张独立卡片,
 * clusterKey 保留在数据里供 pipeline 使用,但不再影响画布/地图渲染与编辑主键。
 * 未来若恢复卡片聚合,把这里改回 `item.clusterKey ?? ...` 即可。
 */
export function itemKey(item: PlanItem): string {
  return item.uid ?? item.id ?? item.poiId ?? item.name ?? "";
}

/** 稳定字符串 hash → [0,1) ,用于伪随机旋转/散布(SSR 安全) */
export function hash01(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/** 贴纸伪随机旋转角(度) */
export function stickerTilt(seed: string, range = 8): number {
  return (hash01(seed) - 0.5) * range;
}

/** 文件夹默认位置:每行 FOLDER_PER_ROW 个,满行折到下一行 */
export function folderPos(dayNumber: number): XY {
  const index = dayNumber - 1;
  return {
    x: (index % FOLDER_PER_ROW) * FOLDER_GAP_X,
    y: FOLDER_Y + Math.floor(index / FOLDER_PER_ROW) * FOLDER_ROW_H
  };
}

/** 池卡片默认位置:池区内蛇形横带,向下增行 */
export function poolPos(index: number, key: string, dayCount: number): XY {
  const origin = poolOrigin(dayCount);
  const row = Math.floor(index / POOL_PER_ROW);
  const col = index % POOL_PER_ROW;
  return {
    x: origin.x + col * POOL_STEP_X + (hash01(key) - 0.5) * 24,
    y: origin.y + row * POOL_ROW_H + (hash01(`${key}:y`) - 0.5) * 30
  };
}

/** 展开态:当天卡片以文件夹为起点向右蛇形摊开 */
export function expandedPos(dayNumber: number, index: number): XY {
  const origin = folderPos(dayNumber);
  const perRow = 3;
  const row = Math.floor(index / perRow);
  const colRaw = index % perRow;
  const col = row % 2 === 0 ? colRaw : perRow - 1 - colRaw; // 蛇形回折
  return {
    x: origin.x + FOLDER_W + 90 + col * 216,
    y: origin.y - 40 + row * 236
  };
}

/** 与现有 UI 相同的相邻 clusterKey 分组:一组渲染为一张贴纸卡 */
export type ItemGroup = { id: string; index: number; items: PlanItem[] };

/**
 * 每 item 一组(不再按 clusterKey 相邻合并)。
 * pipeline 阶段仍会给相邻同区 POI 打 clusterKey,画布展示层与编辑操作不再看。
 * 未来恢复卡片聚合时,改回 `if (last && item.clusterKey && last.id === item.clusterKey) last.items.push(item)` 即可。
 */
export function groupAdjacent(items: PlanItem[]): ItemGroup[] {
  return items.map((item, index) => ({ id: itemKey(item), index, items: [item] }));
}

/**
 * 工作画布包围盒(用于 fit 复位)= 文件夹 + 池虚线框 + 所有卡片。
 * 位置优先取 positions override(用户拖动后落地的实际位置),否则默认布局。
 * 用默认位置时,已经被用户拖到别处的 folder / 池卡片,fit 会以「默认位置」为中心而不是实际位置,
 * 导致 folder 在屏幕外 —— 用户视觉上就是「复位后 folder 不见了」。
 * 池虚线框无条件计入:池为空时它没有卡片可吃,不计就会导致「复位后找不到待安排区」。
 */
export function contentBounds(plan: TripPlan, positions: Record<string, XY> = {}): { min: XY; max: XY } {
  const min = { x: Infinity, y: Infinity };
  const max = { x: -Infinity, y: -Infinity };
  const eat = (p: XY, w: number, h: number) => {
    min.x = Math.min(min.x, p.x);
    min.y = Math.min(min.y, p.y);
    max.x = Math.max(max.x, p.x + w);
    max.y = Math.max(max.y, p.y + h);
  };
  plan.days.forEach((_day: PlanDay, i: number) => {
    const dayNumber = i + 1;
    const pos = positions[`folder:${dayNumber}`] ?? folderPos(dayNumber);
    // 收纳的 mini 贴纸探出文件夹上缘,包围盒上沿留余量
    eat({ x: pos.x, y: pos.y - 60 }, FOLDER_W + 40, FOLDER_H + 60);
  });
  const pool = groupAdjacent(plan.pool);
  const zone = poolZoneRect(plan.days.length, pool.length);
  eat({ x: zone.x, y: zone.y }, zone.w, zone.h);
  pool.forEach((group, gi) => {
    const pos = positions[group.id] ?? poolPos(gi, group.id, plan.days.length);
    eat(pos, STICKER_W, STICKER_H);
  });
  if (!Number.isFinite(min.x)) return { min: { x: -200, y: -200 }, max: { x: 800, y: 600 } };
  return { min, max };
}

const PERSIST_PREFIX = "packup-canvas-";

export function loadPersist(tripId: string): CanvasPersist {
  if (typeof window === "undefined") return { positions: {} };
  try {
    const raw = window.localStorage.getItem(PERSIST_PREFIX + tripId);
    if (!raw) return { positions: {} };
    const parsed = JSON.parse(raw) as CanvasPersist;
    return { positions: parsed.positions ?? {}, view: parsed.view };
  } catch {
    return { positions: {} };
  }
}

export function savePersist(tripId: string, persist: CanvasPersist) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PERSIST_PREFIX + tripId, JSON.stringify(persist));
  } catch {
    /* 存储满/隐私模式:静默忽略 */
  }
}

export const DAY_COLORS = ["var(--day-tan)", "var(--day-blue)", "var(--day-sage)", "var(--day-brick)", "var(--day-cream)"];

export function dayColor(dayNumber: number): string {
  return DAY_COLORS[(dayNumber - 1) % DAY_COLORS.length];
}
