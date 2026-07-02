"use client";

import React, { useEffect, useRef } from "react";
import type { PlanDay } from "@/lib/pipeline/types";

export function DayMap({ day }: { day: PlanDay }) {
  const ref = useRef<HTMLDivElement>(null);
  const key = process.env.NEXT_PUBLIC_AMAP_JS_KEY;

  useEffect(() => {
    if (!key || !ref.current) return;
    const scriptId = "amap-js-sdk";
    if (!document.getElementById(scriptId)) {
      const script = document.createElement("script");
      script.id = scriptId;
      script.src = `https://webapi.amap.com/maps?v=2.0&key=${key}`;
      document.head.appendChild(script);
    }
  }, [key, day]);

  if (!key) {
    return <div className="rounded-lg border bg-muted p-6 text-sm text-muted-foreground">地图 key 未配置</div>;
  }
  return <div ref={ref} className="h-80 rounded-lg border" aria-label="当日地图" />;
}
