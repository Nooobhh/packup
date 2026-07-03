"use client";

import React, { useMemo, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import type { AmapPoi } from "@/lib/map/types";
import type { PlanItem, PoiType } from "@/lib/pipeline/types";
import { PoiCard } from "./poi-card";

export function PoolPanel({
  items,
  dayCount,
  tripId,
  onPlace,
  onPoiToDay,
  onFocusSearch
}: {
  items: PlanItem[];
  dayCount: number;
  tripId: string;
  onPlace: (poolItemId: string, day: number) => void;
  onPoiToDay: (poi: AmapPoi, day: number) => void;
  onFocusSearch?: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "pool-drop", data: { target: "pool" } });
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AmapPoi[]>([]);
  const counts = useMemo(() => countTypes(items), [items]);
  const visible = typeFilter === "all" ? items : items.filter((item) => (item.type ?? item.poi?.type ?? "other") === typeFilter);

  async function search() {
    if (!query.trim()) return;
    const response = await fetch(`/api/pois/search?tripId=${encodeURIComponent(tripId)}&q=${encodeURIComponent(query.trim())}`);
    if (response.ok) setResults(await response.json());
  }

  return (
    <aside ref={setNodeRef} className={`min-w-72 border-r bg-background p-4 ${isOver ? "bg-secondary/40" : ""}`}>
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">待计划池</h2>
        <span className="text-xs text-muted-foreground">{items.length}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => setTypeFilter("all")} className="rounded-md border px-2 py-1 text-xs">全部 {items.length}</button>
        {Object.entries(counts).map(([type, count]) => (
          <button key={type} type="button" onClick={() => setTypeFilter(type)} className="rounded-md border px-2 py-1 text-xs">
            {type} {count}
          </button>
        ))}
      </div>
      <div className="mt-4 flex gap-2">
        <input
          aria-label="搜索地点"
          value={query}
          onFocus={onFocusSearch}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void search();
          }}
          className="min-w-0 flex-1 rounded-md border px-3 py-2 text-sm"
        />
        <button type="button" onClick={search} className="rounded-md border px-3 py-2 text-sm">搜索</button>
      </div>
      {results.length ? (
        <div className="mt-3 space-y-2">
          {results.map((poi) => (
            <div key={poi.amapId} className="rounded-md border p-2 text-xs">
              <div className="font-medium">{poi.name}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={() => onPoiToDay(poi, 1)} className="rounded-md border px-2 py-1">入池</button>
                {Array.from({ length: dayCount }, (_, index) => (
                  <button key={index} type="button" onClick={() => onPoiToDay(poi, index + 1)} className="rounded-md border px-2 py-1">
                    加入 Day {index + 1}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <div className="mt-4 space-y-3">
        {visible.map((item) => {
          const id = item.clusterKey ?? item.id ?? item.poiId ?? item.name ?? "";
          return (
            <PoiCard
              key={id}
              item={item}
              dragId={`pool:${id}`}
              origin="pool"
              actions={Array.from({ length: dayCount }, (_, index) => (
                <button key={index} type="button" onClick={() => onPlace(id, index + 1)} className="rounded-md border px-2 py-1 text-xs">
                  加入 Day {index + 1}
                </button>
              ))}
            />
          );
        })}
      </div>
    </aside>
  );
}

function countTypes(items: PlanItem[]) {
  const counts: Partial<Record<PoiType | string, number>> = {};
  for (const item of items) {
    const key = item.type ?? item.poi?.type ?? "other";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
