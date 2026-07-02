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
  const points = verifiedMapPoints(day);
  map.clearMap?.();
  const markers = points.map(
    (point) =>
      new AMap.Marker({
        title: point.name,
        position: [point.location.lng, point.location.lat]
      })
  );
  const overlays = [...markers];
  if (points.length >= 2) {
    overlays.push(
      new AMap.Polyline({
        path: points.map((point) => [point.location.lng, point.location.lat]),
        strokeWeight: 4,
        strokeColor: "#2563eb"
      })
    );
  }
  if (overlays.length > 0) {
    map.add?.(overlays);
    map.setFitView?.(overlays);
  }
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
