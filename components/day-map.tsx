"use client";

import React, { useEffect, useRef, useState } from "react";
import type { LngLat, PlanDay, PlanItem } from "@/lib/pipeline/types";

type AMapApi = {
  Map: new (container: HTMLElement, opts?: object) => AMapMap;
  Marker: new (opts: object) => unknown;
  Polyline: new (opts: object) => unknown;
};

type AMapMap = {
  clearMap?: () => void;
  add?: (overlays: unknown[]) => void;
  setFitView?: (overlays?: unknown[]) => void;
};

type MapPoint = { name: string; location: LngLat };

export function DayMap({ day }: { day: PlanDay }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<AMapMap | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const key = process.env.NEXT_PUBLIC_AMAP_JS_KEY;

  useEffect(() => {
    if (!key || !ref.current) return;
    let cancelled = false;
    setLoadFailed(false);

    loadAmapSdk(key)
      .then((AMap) => {
        if (cancelled || !ref.current) return;
        if (!mapRef.current) {
          mapRef.current = new AMap.Map(ref.current, { zoom: 12 });
        }
        renderDayMapOverlays(AMap, mapRef.current, day);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [key, day]);

  if (!key || loadFailed) {
    return <div className="rounded-lg border bg-muted p-6 text-sm text-muted-foreground">地图 key 未配置</div>;
  }
  return <div ref={ref} className="h-80 rounded-lg border" aria-label="当日地图" />;
}

export function verifiedMapPoints(day: PlanDay): MapPoint[] {
  return day.items
    .map((item) => {
      const location = item.location ?? item.poi?.location;
      const verified = item.verified ?? item.poi?.verified;
      const name = item.name ?? item.poi?.name ?? "";
      return verified === true && location ? { name, location } : undefined;
    })
    .filter((point): point is MapPoint => Boolean(point));
}

export function renderDayMapOverlays(AMap: AMapApi, map: AMapMap, day: PlanDay) {
  map.clearMap?.();
  const markers = clusteredMapPoints(day).map(
    (point) =>
      new AMap.Marker({
        title: point.name,
        position: [point.location.lng, point.location.lat]
      })
  );
  const overlays = [...markers];
  let segmentCount = 0;
  for (let index = 0; index < day.items.length - 1; index++) {
    if ((day.items[index].verified ?? day.items[index].poi?.verified) !== true || (day.items[index + 1].verified ?? day.items[index + 1].poi?.verified) !== true) continue;
    const from = day.items[index].location ?? day.items[index].poi?.location;
    const to = day.items[index + 1].location ?? day.items[index + 1].poi?.location;
    if (!from || !to) continue;
    const polyline = day.items[index].transportToNext?.polyline;
    const path = (polyline?.length ? polyline : [from, to]).map((point) => [point.lng, point.lat]);
    overlays.push(
      new AMap.Polyline({
        path,
        strokeWeight: 4,
        strokeColor: "#2563eb"
      })
    );
    segmentCount++;
  }
  if (segmentCount === 0) {
    const fallbackPoints = clusteredMapPoints(day);
    if (fallbackPoints.length >= 2) {
      overlays.push(
        new AMap.Polyline({
          path: fallbackPoints.map((point) => [point.location.lng, point.location.lat]),
          strokeWeight: 4,
          strokeColor: "#2563eb"
        })
      );
    }
  }
  if (overlays.length > 0) {
    map.add?.(overlays);
    map.setFitView?.(overlays);
  }
}

function clusteredMapPoints(day: PlanDay): MapPoint[] {
  const groups = new Map<string, MapPoint[]>();
  for (const item of day.items) {
    const location = item.location ?? item.poi?.location;
    const verified = item.verified ?? item.poi?.verified;
    if (verified !== true || !location) continue;
    const key = item.clusterKey ?? item.id ?? item.poiId ?? item.name ?? `${location.lng},${location.lat}`;
    groups.set(key, [...(groups.get(key) ?? []), { name: item.name ?? item.poi?.name ?? "", location }]);
  }
  return Array.from(groups.values()).map((items) => ({
    name: items.map((item) => item.name).join(" + "),
    location: items[0].location
  }));
}

function loadAmapSdk(key: string): Promise<AMapApi> {
  const existingAmap = (globalThis as typeof globalThis & { AMap?: AMapApi }).AMap;
  if (existingAmap) return Promise.resolve(existingAmap);

  // 高德 JS API 2.0 要求安全密钥,须在 SDK script 加载前挂到全局
  const securityCode = process.env.NEXT_PUBLIC_AMAP_SECURITY_CODE;
  if (securityCode) {
    (globalThis as typeof globalThis & { _AMapSecurityConfig?: object })._AMapSecurityConfig = {
      securityJsCode: securityCode
    };
  }

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
