import React from "react";
import type { PlanDay } from "@/lib/pipeline/types";

export function DayTimeline({ day }: { day: PlanDay }) {
  return (
    <ol className="space-y-3">
      {day.items.map((item, index) => (
        <li key={item.id ?? `${item.startTime}-${index}`} className="rounded-lg border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <time className="font-mono text-sm">{item.startTime}</time>
            <h3 className="font-semibold">{item.name ?? item.poi?.name}</h3>
            <span className="rounded bg-secondary px-2 py-0.5 text-xs">{item.type ?? item.poi?.type}</span>
            {(item.verified ?? item.poi?.verified) === false ? <span className="rounded bg-yellow-100 px-2 py-0.5 text-xs text-yellow-900">未验证</span> : null}
          </div>
          <div className="mt-2 grid gap-1 text-sm text-muted-foreground">
            <span>{item.address ?? item.poi?.address}</span>
            <span>{item.openHours ?? item.poi?.openHours ?? "未知"}</span>
            <span>{item.durationMin} min</span>
            {item.reason ?? item.poi?.reason ? <span>{item.reason ?? item.poi?.reason}</span> : null}
            {item.note ? <span>{item.note}</span> : null}
            {item.transportToNext ? <span>下一段 {item.transportToNext.mode}: {item.transportToNext.durationMin} min / {item.transportToNext.distanceKm.toFixed(2)} km</span> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
