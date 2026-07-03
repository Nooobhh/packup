"use client";

import React, { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { PlanDay, TransportMode } from "@/lib/pipeline/types";
import { PoiCard } from "./poi-card";

const MODE_LABEL: Record<string, string> = { walk: "步行", public: "公交", drive: "驾车", bike: "骑行" };

export function DayLane({
  day,
  dayNumber,
  onRemoveToPool,
  onEditItem,
  onTheme,
  onDeleteDay,
  onOptimize,
  onSetTransport,
  onRecalc,
  onCardClick
}: {
  day: PlanDay;
  dayNumber: number;
  onRemoveToPool: (itemId: string) => void;
  onEditItem: (itemId: string, set: { note?: string; startTime?: string; durationMin?: number }) => void;
  onTheme: (theme: string) => void;
  onDeleteDay: () => void;
  onOptimize: () => void;
  onSetTransport: (segmentIndex: number, mode: TransportMode) => void;
  onRecalc: () => void;
  onCardClick?: (itemId: string) => void;
}) {
  const [theme, setTheme] = useState(day.theme ?? "");
  const { setNodeRef, isOver } = useDroppable({ id: `day:${dayNumber}`, data: { target: "day", day: dayNumber } });
  const ids = day.items.map((item) => item.clusterKey ?? item.id ?? item.poiId ?? item.name ?? "");

  return (
    <section ref={setNodeRef} className={`flex min-w-80 flex-col border-r bg-background p-4 ${isOver ? "bg-secondary/40" : ""}`}>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold">Day {dayNumber}</h2>
            {day.date ? <p className="text-xs text-muted-foreground">{day.date}</p> : null}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onOptimize} className="rounded-md border px-2 py-1 text-xs">智能排程</button>
            <button type="button" onClick={() => window.confirm("删除这一天?") && onDeleteDay()} className="rounded-md border px-2 py-1 text-xs">删除天</button>
          </div>
        </div>
        <div className="flex gap-2">
          <input aria-label={`Day ${dayNumber} 主题`} value={theme} onChange={(event) => setTheme(event.target.value)} className="min-w-0 flex-1 rounded-md border px-2 py-1 text-xs" />
          <button type="button" onClick={() => onTheme(theme)} className="rounded-md border px-2 py-1 text-xs">保存主题</button>
        </div>
      </div>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="mt-4 space-y-3">
          {day.items.map((item, index) => {
            const id = item.clusterKey ?? item.id ?? item.poiId ?? item.name ?? "";
            return (
              <React.Fragment key={`${id}-${index}`}>
                <PoiCard
                  item={item}
                  dragId={`day:${dayNumber}:${id}`}
                  origin="day"
                  onClick={() => onCardClick?.(id)}
                  onEdit={(set) => onEditItem(id, set)}
                  actions={
                    <button type="button" onClick={() => onRemoveToPool(id)} className="rounded-md border px-2 py-1 text-xs">
                      移回池
                    </button>
                  }
                />
                {index < day.items.length - 1 ? (
                  <TransportStrip
                    segmentIndex={index}
                    item={item}
                    onSetTransport={onSetTransport}
                    onRecalc={onRecalc}
                  />
                ) : null}
              </React.Fragment>
            );
          })}
        </div>
      </SortableContext>
    </section>
  );
}

function TransportStrip({
  segmentIndex,
  item,
  onSetTransport,
  onRecalc
}: {
  segmentIndex: number;
  item: PlanDay["items"][number];
  onSetTransport: (segmentIndex: number, mode: TransportMode) => void;
  onRecalc: () => void;
}) {
  const route = item.transportToNext;
  if (!route) {
    return (
      <button type="button" onClick={onRecalc} className="w-full rounded-md border border-dashed px-2 py-1 text-xs text-muted-foreground">
        交通待计算 · 点击重试
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md bg-secondary px-2 py-1 text-xs">
      <span>{MODE_LABEL[route.mode] ?? route.mode}</span>
      <span>{route.durationMin} min</span>
      <span>{route.distanceKm.toFixed(2)} km</span>
      {(["walk", "bike", "public", "drive"] as TransportMode[]).map((mode) => (
        <button key={mode} type="button" onClick={() => onSetTransport(segmentIndex, mode)} className="rounded border px-1">
          {MODE_LABEL[mode]}
        </button>
      ))}
    </div>
  );
}
