"use client";

import React, { useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import type { LngLat, PlanDay, PlanItem } from "@/lib/pipeline/types";
import { DAY_COLORS, itemKey } from "./canvas-layout";

type AMapApi = {
  Map: new (container: HTMLElement, opts?: object) => AMapMap;
  Marker: new (opts: object) => { on?: (event: string, cb: () => void) => void };
  Polyline: new (opts: object) => unknown;
};

type AMapMap = {
  clearMap?: () => void;
  add?: (overlays: unknown[]) => void;
  setFitView?: (overlays?: unknown[]) => void;
  setZoomAndCenter?: (zoom: number, center: [number, number], immediately?: boolean) => void;
  getSize?: () => { width: number; height: number };
  getZoom?: () => number;
  resize?: () => void;
  on?: (event: string, cb: () => void) => void;
  panTo?: (center: [number, number]) => void;
  setCenter?: (center: [number, number]) => void;
};

/** 地图上的一个业务点(day 行程点或池点),聚合的最小单元 */
type MapPoint = { id: string; name: string; location: LngLat; color: string; label: string; groupKey: string };

type MapCluster = { center: LngLat; members: MapPoint[]; groupKey: string };

const DAY_HEX = ["#d9a86b", "#7d95c9", "#6f9b62", "#c96a5b", "#e0b76f"];

const TYPE_FILTERS: Array<{ key: string; label: string; emoji: string }> = [
  { key: "sight", label: "景点", emoji: "🏛" },
  { key: "food", label: "美食", emoji: "🍜" },
  { key: "shop", label: "购物", emoji: "🛍" },
  { key: "stay", label: "住宿", emoji: "🛏" },
  { key: "experience", label: "体验", emoji: "🎫" },
  { key: "other", label: "其他", emoji: "📍" }
];

function itemType(item: PlanItem): string {
  const type = (item.type ?? item.poi?.type ?? "other") as string;
  return TYPE_FILTERS.some((f) => f.key === type) ? type : "other";
}

/**
 * 右下角贴纸风地图小窗:浅色底图 + Day 色序号 marker + 类型/待安排筛选。
 * 底图样式可用 NEXT_PUBLIC_AMAP_STYLE_ID(高德控制台自定义样式)覆盖,默认 whitesmoke。
 */
export function MapDock({
  days,
  pool,
  focus,
  selectedItemId,
  onMarkerClick,
  expanded,
  onToggleExpanded
}: {
  days: PlanDay[];
  pool: PlanItem[];
  focus: "all" | number;
  selectedItemId: string | null;
  onMarkerClick: (itemId: string) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<AMapMap | null>(null);
  const [showPool, setShowPool] = useState(true);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  // 日期筛选:跟随画布展开天,也可手动切换
  const [dayFilter, setDayFilter] = useState<"all" | number>(focus);
  const [loadFailed, setLoadFailed] = useState(false);
  // 点击聚合 marker 后展开的成员列表(坐标为相对地图容器的像素)
  const [openCluster, setOpenCluster] = useState<{ x: number; y: number; members: MapPoint[] } | null>(null);
  const key = process.env.NEXT_PUBLIC_AMAP_JS_KEY;

  useEffect(() => setDayFilter(focus), [focus]);

  // effect 可能在 map complete 前触发多次,complete 后始终用最新 props 渲染
  const optsRef = useRef({ days, pool, focus: dayFilter, selectedItemId, showPool, hiddenTypes, onMarkerClick });
  optsRef.current = { days, pool, focus: dayFilter, selectedItemId, showPool, hiddenTypes, onMarkerClick };

  useEffect(() => {
    if (!key || !ref.current) return;
    let cancelled = false;
    loadAmapSdk(key)
      .then((AMap) => {
        if (cancelled || !ref.current) return;
        if (!mapRef.current) {
          // 初始 center 直接落在行程点上,避免从默认中心(北京)长途飞行动画期间瓦片空白
          const first = firstLocation(optsRef.current.days, optsRef.current.pool);
          const styleId = process.env.NEXT_PUBLIC_AMAP_STYLE_ID;
          mapRef.current = new AMap.Map(ref.current, {
            zoom: 12,
            ...(first ? { center: [first.lng, first.lat] as [number, number] } : {}),
            mapStyle: styleId ? `amap://styles/${styleId}` : "amap://styles/whitesmoke"
          });
          if (process.env.NODE_ENV !== "production") (window as unknown as { __packupMap?: AMapMap }).__packupMap = mapRef.current;
          // zoom 变化后屏幕距离改变,重新聚合(点集未变不会触发 re-fit)
          mapRef.current.on?.("zoomend", () => {
            const g = (globalThis as typeof globalThis & { AMap?: AMapApi }).AMap;
            if (g && mapRef.current) renderOverlays(g, mapRef.current, optsRef.current);
            setOpenCluster(null);
          });
        }
        renderOverlays(AMap, mapRef.current, optsRef.current);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [key, days, pool, dayFilter, selectedItemId, showPool, hiddenTypes, onMarkerClick]);

  useEffect(() => {
    const t = setTimeout(() => {
      const map = mapRef.current;
      if (!map) return;
      map.resize?.();
      // 容器形态切换后(内部尺寸已随 resize 就绪)重新 fit 当前点集
      const points = lastFitPoints.get(map);
      if (points?.length) fitManually(map, points);
    }, 260);
    return () => clearTimeout(t);
  }, [expanded]);

  // 容器从 0 尺寸变为可见时(首帧布局/展开动画),让 AMap 重算视口
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth > 0) mapRef.current?.resize?.();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 选中变化时把 marker 平移到"可视中心"(不是地图几何中心)。
  // expanded=true 时 drawer 会盖住 map dock 下方约 60%,marker 落在几何中心必被遮挡 ——
  // 补偿:把地图 center 向南偏 mapH*0.28,让 marker 相对上移到上部可视区中心。
  // AMap 在 fit 动画期间会吞掉后续 panTo/setCenter 的动画调用,setZoomAndCenter(..., true)
  // 保持当前 zoom + immediately=true 强制立即定位,不入动画队列。
  // 同时取消 fitManually 的 pending 重试,防 500ms/1500ms 后把中心拉回 fit 位置。
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedItemId) return;
    const location = findSelectedLocation(days, pool, selectedItemId);
    if (!location) return;
    const pending = fitRetryTimers.get(map);
    if (pending) {
      clearTimeout(pending);
      fitRetryTimers.delete(map);
    }
    const zoom = map.getZoom?.() ?? 12;
    const size = map.getSize?.() ?? { width: 400, height: 300 };
    const offsetPx = expanded ? size.height * 0.28 : 0;
    const pxPerDeg = (256 * 2 ** zoom) / 360;
    const centerLat = location.lat - offsetPx / pxPerDeg;
    if (map.setZoomAndCenter) map.setZoomAndCenter(zoom, [location.lng, centerLat], true);
  }, [selectedItemId, days, pool, expanded]);

  // 类型数量:焦点范围内(某天或全部+池)统计
  const focusItems = (dayFilter === "all" ? days.flatMap((day) => day.items) : (days[dayFilter - 1]?.items ?? [])).concat(showPool ? pool : []);
  const typeCounts = focusItems.reduce<Record<string, number>>((acc, item) => {
    const type = itemType(item);
    acc[type] = (acc[type] ?? 0) + 1;
    return acc;
  }, {});

  function toggleType(type: string) {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  return (
    <aside
      data-canvas-ui
      className={`fixed z-40 flex flex-col overflow-hidden border-[3px] border-ink bg-white hard-shadow ${
        expanded ? "right-0 top-14 rounded-l-[14px] border-r-0" : "bottom-5 right-5 rounded-[14px]"
      }`}
      style={expanded ? { width: "min(38vw, 720px)", bottom: 0 } : { width: 420, height: 356 }}
      aria-label="行程地图"
    >
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-line bg-paper px-3">
        <h2 className="font-display text-[15px] font-bold text-ink">
          地图{dayFilter !== "all" ? ` · Day ${dayFilter}` : ""}
        </h2>
        <button
          type="button"
          onClick={onToggleExpanded}
          className="flex h-7 w-7 items-center justify-center rounded-full border border-line bg-white text-ink hover:bg-accent-soft"
          aria-label={expanded ? "收起地图" : "展开地图"}
        >
          {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </header>
      {/* 筛选第一行:日期 */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line bg-paper px-3 py-1.5">
        <button
          type="button"
          onClick={() => setDayFilter("all")}
          className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
            dayFilter === "all" ? "border-ink bg-ink text-white" : "border-line bg-white text-ink-soft"
          }`}
        >
          全部
        </button>
        {days.map((_, index) => {
          const dayNumber = index + 1;
          const active = dayFilter === dayNumber;
          return (
            <button
              key={dayNumber}
              type="button"
              onClick={() => setDayFilter(dayNumber)}
              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                active ? "border-ink bg-white text-ink" : "border-line bg-white text-ink-soft"
              }`}
            >
              <i className="h-2 w-2 rounded-full border border-ink/40" style={{ background: DAY_HEX[index % DAY_HEX.length] }} />
              Day {dayNumber}
            </button>
          );
        })}
      </div>
      {/* 筛选第二行:待安排 + 类型 pills */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b-2 border-ink bg-paper px-3 py-1.5">
        <button
          type="button"
          onClick={() => setShowPool((value) => !value)}
          className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
            showPool ? "border-ink bg-accent-soft text-accent" : "border-line bg-white text-ink-soft"
          }`}
        >
          🗂 待安排 · {pool.length}
        </button>
        <i className="h-4 w-px bg-line" />
        {TYPE_FILTERS.filter((f) => (typeCounts[f.key] ?? 0) > 0).map((f) => {
          const active = !hiddenTypes.has(f.key);
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => toggleType(f.key)}
              className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                active ? "border-ink bg-white text-ink" : "border-line bg-muted text-ink-soft/60 line-through"
              }`}
            >
              {f.emoji} {f.label} · {typeCounts[f.key]}
            </button>
          );
        })}
      </div>
      {!key || loadFailed ? (
        <div className="flex flex-1 items-center justify-center bg-muted text-sm text-ink-soft">地图 key 未配置</div>
      ) : (
        <div className="relative min-h-0 w-full flex-1">
          {/* marker 点击走 DOM 委托:AMap v2 的 marker 事件系统在部分环境不派发,不可依赖 */}
          <div
            ref={ref}
            className="h-full w-full"
            onClick={(event) => {
              const target = event.target as HTMLElement;
              const clusterEl = target.closest?.("[data-cluster-id]");
              if (clusterEl && mapRef.current) {
                const cluster = lastClusters.get(mapRef.current)?.[Number(clusterEl.getAttribute("data-cluster-id"))];
                if (cluster) {
                  const rect = event.currentTarget.getBoundingClientRect();
                  setOpenCluster({
                    x: Math.min(event.clientX - rect.left, rect.width - 236),
                    y: Math.min(event.clientY - rect.top + 10, Math.max(0, rect.height - 60 - cluster.members.length * 34)),
                    members: cluster.members
                  });
                }
                return;
              }
              const dot = target.closest?.("[data-marker-id]");
              const encoded = dot?.getAttribute("data-marker-id");
              if (encoded) {
                onMarkerClick(decodeURIComponent(encoded));
                setOpenCluster(null);
                return;
              }
              setOpenCluster(null);
            }}
          />
          {openCluster ? (
            <div
              className="absolute z-10 w-56 overflow-hidden rounded-[12px] border-2 border-ink bg-white hard-shadow"
              style={{ left: Math.max(8, openCluster.x), top: Math.max(8, openCluster.y) }}
            >
              <p className="border-b border-line bg-paper px-3 py-1.5 text-[11px] font-semibold text-ink-soft">这里聚了 {openCluster.members.length} 个地点</p>
              <ul className="max-h-44 overflow-y-auto overscroll-contain p-1.5">
                {openCluster.members.map((member) => (
                  <li key={member.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onMarkerClick(member.id);
                        setOpenCluster(null);
                      }}
                      className="flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 text-left hover:bg-accent-soft"
                    >
                      <i
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-ink/60 text-[10px] font-bold text-white"
                        style={{ background: member.color }}
                      >
                        {member.label}
                      </i>
                      <span className="truncate text-[12px] font-medium text-ink">{member.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </aside>
  );
}

function renderOverlays(
  AMap: AMapApi,
  map: AMapMap,
  opts: {
    days: PlanDay[];
    pool: PlanItem[];
    focus: "all" | number;
    selectedItemId: string | null;
    showPool: boolean;
    hiddenTypes: Set<string>;
    onMarkerClick: (itemId: string) => void;
  }
) {
  map.clearMap?.();
  const overlays: unknown[] = [];
  const points: LngLat[] = [];
  const mapPoints: MapPoint[] = [];
  const activeDays = opts.focus === "all" ? opts.days : [opts.days[opts.focus - 1]].filter(Boolean);
  activeDays.forEach((day) => {
    const dayNumber = opts.days.indexOf(day) + 1;
    const color = DAY_HEX[(dayNumber - 1) % DAY_HEX.length];
    let order = 0;
    for (const item of day.items) {
      const location = item.location ?? item.poi?.location;
      if (!location) continue;
      order += 1;
      if (opts.hiddenTypes.has(itemType(item))) continue;
      points.push(location);
      mapPoints.push({
        id: itemKey(item),
        name: item.name ?? item.poi?.name ?? "",
        location,
        color,
        label: String(order),
        groupKey: `day${dayNumber}`
      });
    }
    for (let index = 0; index < day.items.length - 1; index++) {
      const from = day.items[index].location ?? day.items[index].poi?.location;
      const to = day.items[index + 1].location ?? day.items[index + 1].poi?.location;
      if (!from || !to) continue;
      const polyline = day.items[index].transportToNext?.polyline;
      const path = (polyline?.length ? polyline : [from, to]).map((point: LngLat) => [point.lng, point.lat]);
      overlays.push(new AMap.Polyline({ path, strokeColor: color, strokeWeight: 4, strokeOpacity: 0.9, lineJoin: "round" }));
    }
  });
  if (opts.showPool) {
    for (const item of opts.pool) {
      const location = item.location ?? item.poi?.location;
      if (!location) continue;
      if (opts.hiddenTypes.has(itemType(item))) continue;
      points.push(location);
      mapPoints.push({ id: itemKey(item), name: item.name ?? item.poi?.name ?? "", location, color: "#9b9ba3", label: "", groupKey: "pool" });
    }
  }

  // 临近点聚合暂未启用(见 ROADMAP.md Backlog · 地点聚合)—— 每点直接一个 marker
  const clusters = clusterMapPoints(mapPoints, map.getZoom?.() ?? 12);
  lastClusters.set(map, clusters);
  clusters.forEach((cluster, index) => {
    if (cluster.members.length === 1) {
      const point = cluster.members[0];
      overlays.push(
        new AMap.Marker({
          title: point.name,
          position: [point.location.lng, point.location.lat],
          anchor: "center",
          content: markerContent(point.color, point.label, point.id === opts.selectedItemId, point.id)
        })
      );
      return;
    }
    const selected = cluster.members.some((member) => member.id === opts.selectedItemId);
    overlays.push(
      new AMap.Marker({
        title: cluster.members.map((member) => member.name).join(" / "),
        position: [cluster.center.lng, cluster.center.lat],
        anchor: "center",
        content: clusterContent(cluster, index, selected)
      })
    );
  });

  if (overlays.length) {
    map.add?.(overlays);
    // 视野只在「点集变化」时重新 fit;选中高亮/抽屉开合不动视野(卡片纯覆盖);
    // 容器形态切换的 re-fit 由 expanded effect 在 resize 后补发
    lastFitPoints.set(map, points);
    const sig = points.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
    if (fitSignatures.get(map) !== sig) {
      fitSignatures.set(map, sig);
      fitManually(map, points);
    }
  }
}

const fitSignatures = new WeakMap<AMapMap, string>();
const lastFitPoints = new WeakMap<AMapMap, LngLat[]>();
const lastClusters = new WeakMap<AMapMap, MapCluster[]>();

/**
 * 每点一个 cluster(不聚合)。
 * 未来恢复「真实距离 <500m 且屏幕距离 <120px 完全链聚合」时,把下方注释体替换本函数即可。
 * 保留 zoom 参数以便未来无缝切回。
 */
function clusterMapPoints(mapPoints: MapPoint[], _zoom: number): MapCluster[] {
  return mapPoints.map((point) => ({ center: { ...point.location }, members: [point], groupKey: point.groupKey }));
}

/*
// 备用:真实距离 500m + 屏幕距离 120px 完全链聚合(见 ROADMAP.md Backlog · 地点聚合)
const CLUSTER_METERS = 500;
const CLUSTER_PIXELS = 120;
const EARTH_RADIUS_METERS = 6371000;

function haversineMeters(a: LngLat, b: LngLat): number {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

function screenPixelDistance(a: LngLat, b: LngLat, zoom: number): number {
  const pxPerDeg = (256 * 2 ** zoom) / 360;
  const cosLat = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  const dx = (a.lng - b.lng) * pxPerDeg * cosLat;
  const dy = (a.lat - b.lat) * pxPerDeg;
  return Math.hypot(dx, dy);
}

function clusterMapPointsAggregated(mapPoints: MapPoint[], zoom: number): MapCluster[] {
  const clusters: MapCluster[] = [];
  for (const point of mapPoints) {
    const hit = clusters.find((cluster) => {
      if (cluster.groupKey !== point.groupKey) return false;
      return cluster.members.every((member) => {
        if (haversineMeters(point.location, member.location) >= CLUSTER_METERS) return false;
        if (screenPixelDistance(point.location, member.location, zoom) >= CLUSTER_PIXELS) return false;
        return true;
      });
    });
    if (hit) {
      hit.members.push(point);
      hit.center = {
        lng: hit.members.reduce((sum, member) => sum + member.location.lng, 0) / hit.members.length,
        lat: hit.members.reduce((sum, member) => sum + member.location.lat, 0) / hit.members.length
      };
    } else {
      clusters.push({ center: { ...point.location }, members: [point], groupKey: point.groupKey });
    }
  }
  return clusters;
}
*/

/** 聚合 marker:叠影底圆 + 白底计数 + 组色角标,与单点(实心色圆)明显区分 */
function clusterContent(cluster: MapCluster, index: number, selected: boolean) {
  const color = cluster.members[0].color;
  const border = selected ? "#2a6942" : "#1b1b1f";
  return (
    `<div data-cluster-id="${index}" style="position:relative;width:36px;height:36px;cursor:pointer">` +
    `<div style="position:absolute;left:7px;top:7px;width:27px;height:27px;border-radius:999px;background:${color};opacity:.5;border:2px solid #1b1b1f"></div>` +
    `<div style="position:absolute;left:0;top:0;width:28px;height:28px;border-radius:999px;background:#fff;border:2.5px solid ${border};box-shadow:1px 2px 0 rgba(27,27,31,.25);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#1b1b1f;font-family:ui-sans-serif,system-ui">${cluster.members.length}</div>` +
    `<div style="position:absolute;right:2px;top:-3px;width:11px;height:11px;border-radius:999px;background:${color};border:1.5px solid #1b1b1f"></div>` +
    `</div>`
  );
}

/**
 * 手动计算 zoom/center:AMap 的 setFitView 在地图就绪前会被忽略,不可依赖。
 * 地图样式异步初始化期间 setZoomAndCenter 也可能不触发瓦片加载,按退避重试(幂等)。
 * 抽屉遮挡的场景由容器缩小(bottom 让位)解决,fit 始终以整个容器为目标。
 */
function fitManually(map: AMapMap, points: LngLat[], attempt = 0) {
  if (!points.length || !map.setZoomAndCenter) return;
  const lngs = points.map((point) => point.lng);
  const lats = points.map((point) => point.lat);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const center: [number, number] = [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
  const size = map.getSize?.() ?? { width: 330, height: 206 };
  const cosLat = Math.cos((center[1] * Math.PI) / 180);
  const spanLng = Math.max(maxLng - minLng, 0.005);
  const spanLat = Math.max(maxLat - minLat, 0.005);
  const zoomLng = Math.log2((0.8 * size.width * 360) / (256 * spanLng));
  const zoomLat = Math.log2((0.8 * size.height * 360 * cosLat) / (256 * spanLat));
  // zoom 取整:AMap v2 WebGL 渲染下小数 zoom 可能不渲染底图瓦片;floor 保证内容不出框
  const zoom = Math.max(3, Math.min(17, Math.floor(Math.min(zoomLng, zoomLat))));
  // immediately=true 会跳过动画路径,AMap v2 在该路径下不触发瓦片加载,必须走动画
  map.setZoomAndCenter(zoom, center, false);
  const prev = fitRetryTimers.get(map);
  if (prev) clearTimeout(prev);
  if (attempt < 2) fitRetryTimers.set(map, setTimeout(() => fitManually(map, points, attempt + 1), 500 + attempt * 1000));
}

const fitRetryTimers = new WeakMap<AMapMap, ReturnType<typeof setTimeout>>();

function findSelectedLocation(days: PlanDay[], pool: PlanItem[], id: string): LngLat | undefined {
  for (const day of days) {
    for (const item of day.items) {
      if (itemKey(item) === id) return item.location ?? item.poi?.location;
    }
  }
  const poolItem = pool.find((item) => itemKey(item) === id);
  return poolItem?.location ?? poolItem?.poi?.location;
}

function firstLocation(days: PlanDay[], pool: PlanItem[]) {
  for (const day of days) {
    for (const item of day.items) {
      const location = item.location ?? item.poi?.location;
      if (location) return location;
    }
  }
  for (const item of pool) {
    const location = item.location ?? item.poi?.location;
    if (location) return location;
  }
  return undefined;
}

function markerContent(color: string, label: string, selected: boolean, id: string) {
  const size = selected ? 26 : 20;
  return `<div data-marker-id="${encodeURIComponent(id)}" style="width:${size}px;height:${size}px;border-radius:999px;background:${color};border:2.5px solid #1b1b1f;box-shadow:1px 2px 0 rgba(27,27,31,.25);display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700;font-family:ui-sans-serif,system-ui;cursor:pointer">${label}</div>`;
}

function loadAmapSdk(key: string): Promise<AMapApi> {
  const existingAmap = (globalThis as typeof globalThis & { AMap?: AMapApi }).AMap;
  if (existingAmap) return Promise.resolve(existingAmap);
  const scriptId = "amap-js-sdk";
  const existingScript = document.getElementById(scriptId) as HTMLScriptElement | null;
  return new Promise((resolve, reject) => {
    const onLoad = () => {
      const AMap = (globalThis as typeof globalThis & { AMap?: AMapApi }).AMap;
      if (AMap) resolve(AMap);
      else reject(new Error("AMap SDK loaded without global AMap"));
    };
    const onError = () => reject(new Error("AMap SDK failed to load"));
    if (existingScript) {
      existingScript.addEventListener("load", onLoad, { once: true });
      existingScript.addEventListener("error", onError, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.id = scriptId;
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${key}`;
    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });
    document.head.appendChild(script);
  });
}
