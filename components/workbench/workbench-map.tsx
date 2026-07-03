"use client";

import React, { useEffect, useRef, useState } from "react";
import type { LngLat, PlanDay, PlanItem } from "@/lib/pipeline/types";

type AMapApi = {
  Map: new (container: HTMLElement, opts?: object) => AMapMap;
  Marker: new (opts: object) => { on?: (event: string, cb: () => void) => void };
  Polyline: new (opts: object) => unknown;
};

type AMapMap = {
  clearMap?: () => void;
  add?: (overlays: unknown[]) => void;
  setFitView?: (overlays?: unknown[]) => void;
};

export function WorkbenchMap({
  days,
  pool,
  focus,
  selectedItemId,
  showPool,
  onMarkerClick
}: {
  days: PlanDay[];
  pool: PlanItem[];
  focus: "all" | number;
  selectedItemId: string | null;
  showPool: boolean;
  onMarkerClick: (itemId: string, dayIndex: number | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<AMapMap | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const key = process.env.NEXT_PUBLIC_AMAP_JS_KEY;

  useEffect(() => {
    if (!key || !ref.current) return;
    let cancelled = false;
    loadAmapSdk(key)
      .then((AMap) => {
        if (cancelled || !ref.current) return;
        if (!mapRef.current) mapRef.current = new AMap.Map(ref.current, { zoom: 12 });
        renderWorkbenchOverlays(AMap, mapRef.current, { days, pool, focus, selectedItemId, showPool, onMarkerClick });
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [key, days, pool, focus, selectedItemId, showPool, onMarkerClick]);

  if (!key || loadFailed) return <div className="rounded-lg border bg-muted p-6 text-sm text-muted-foreground">地图 key 未配置</div>;
  return <div ref={ref} className="h-full min-h-80 rounded-lg border" aria-label="工作台地图" />;
}

function renderWorkbenchOverlays(
  AMap: AMapApi,
  map: AMapMap,
  opts: {
    days: PlanDay[];
    pool: PlanItem[];
    focus: "all" | number;
    selectedItemId: string | null;
    showPool: boolean;
    onMarkerClick: (itemId: string, dayIndex: number | null) => void;
  }
) {
  map.clearMap?.();
  const colors = ["#2563eb", "#16a34a", "#db2777", "#ea580c", "#7c3aed"];
  const overlays: unknown[] = [];
  const activeDays = opts.focus === "all" ? opts.days : [opts.days[opts.focus - 1]].filter(Boolean);
  activeDays.forEach((day, dayIndex) => {
    const color = colors[dayIndex % colors.length];
    const points = day.items.map((item) => pointFromItem(item)).filter((point): point is MapPoint => Boolean(point));
    for (const point of points) {
      const marker = new AMap.Marker({
        title: point.name,
        position: [point.location.lng, point.location.lat],
        content: markerContent(point.id === opts.selectedItemId ? color : "#111827", point.id === opts.selectedItemId)
      });
      marker.on?.("click", () => opts.onMarkerClick(point.id, opts.days.indexOf(day) + 1));
      overlays.push(marker);
    }
    for (let index = 0; index < day.items.length - 1; index++) {
      const from = itemLocation(day.items[index]);
      const to = itemLocation(day.items[index + 1]);
      if (!from || !to) continue;
      const path = (day.items[index].transportToNext?.polyline?.length ? day.items[index].transportToNext?.polyline : [from, to])!.map((point) => [point.lng, point.lat]);
      overlays.push(new AMap.Polyline({ path, strokeColor: color, strokeWeight: 4 }));
    }
  });
  if (opts.showPool) {
    for (const item of opts.pool) {
      const point = pointFromItem(item);
      if (!point) continue;
      const marker = new AMap.Marker({ title: point.name, position: [point.location.lng, point.location.lat], content: markerContent("#6b7280", point.id === opts.selectedItemId) });
      marker.on?.("click", () => opts.onMarkerClick(point.id, null));
      overlays.push(marker);
    }
  }
  if (overlays.length) {
    map.add?.(overlays);
    map.setFitView?.(overlays);
  }
}

type MapPoint = { id: string; name: string; location: LngLat };

function pointFromItem(item: PlanItem): MapPoint | undefined {
  const location = itemLocation(item);
  if (!location) return undefined;
  return {
    id: item.clusterKey ?? item.id ?? item.poiId ?? item.name ?? `${location.lng},${location.lat}`,
    name: item.name ?? item.poi?.name ?? "",
    location
  };
}

function itemLocation(item: PlanItem) {
  return item.location ?? item.poi?.location;
}

function markerContent(color: string, selected: boolean) {
  const size = selected ? 18 : 12;
  return `<div style="width:${size}px;height:${size}px;border-radius:999px;background:${color};border:2px solid white;box-shadow:0 1px 8px rgba(0,0,0,.25)"></div>`;
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
