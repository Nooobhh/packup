"use client";

import React, { useState } from "react";
import { closestCenter, DndContext, type DragEndEvent } from "@dnd-kit/core";
import type { AmapPoi } from "@/lib/map/types";
import type { GroundedPoi, Note, TransportMode, TripPlan } from "@/lib/pipeline/types";
import { applyIntent, type WorkbenchIntent } from "./workbench-reducer";
import { DayLane } from "./day-lane";
import { PoolPanel } from "./pool-panel";
import { WorkbenchMap } from "./workbench-map";
import { DetailDrawer } from "./detail-drawer";

type WorkbenchNote = Pick<Note, "id" | "title" | "author" | "url" | "body">;

export function TripWorkbench({ initialPlan, initialNotes, tripId }: { initialPlan: TripPlan; initialNotes: WorkbenchNote[]; tripId: string }) {
  const [plan, setPlan] = useState(initialPlan);
  const [notes] = useState(initialNotes);
  const [message, setMessage] = useState("");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [shortKm, setShortKm] = useState(String(initialPlan.transportPrefs?.shortKm ?? 1));
  const [shortMode, setShortMode] = useState<TransportMode>(initialPlan.transportPrefs?.shortMode ?? "walk");
  const [longMode, setLongMode] = useState<TransportMode>(initialPlan.transportPrefs?.longMode ?? "public");
  const [mapFocus, setMapFocus] = useState<"all" | number>("all");
  const [showPoolOnMap, setShowPoolOnMap] = useState(true);
  const selectedItem = selectedItemId ? findItem(plan, selectedItemId) : undefined;

  async function execute(intent: WorkbenchIntent, options: { recalcAfterPrefs?: boolean } = {}) {
    setMessage("");
    const snapshot = plan;
    const result = applyIntent(plan, intent);
    if ("error" in result) {
      setMessage(result.error);
      return;
    }
    setPlan(result.optimisticPlan);
    const response = await fetch(`/api/trips/${tripId}/plan`, { method: "PATCH", body: JSON.stringify(result.patchBody) });
    if (response.ok) {
      const payload = await response.json();
      setPlan("days" in payload ? payload : payload.plan);
      if (options.recalcAfterPrefs && window.confirm("立即全程重算交通?")) {
        await execute({ type: "recalc-transport" });
      }
      return;
    }
    setPlan(snapshot);
    if (response.status === 409) {
      setMessage("行程已更新,正在刷新");
      const fresh = await fetch(`/api/trips/${tripId}`);
      if (fresh.ok) {
        const payload = await fresh.json();
        setPlan(payload.plan);
      }
    } else {
      setMessage("保存失败,已回滚");
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const over = event.over?.data.current as DropTarget | undefined;
    if (!over) return;
    const active = event.active.data.current as DragSource | undefined;
    const itemId = active?.itemId;
    if (!itemId) return;
    if (active?.origin === "pool" && over.target === "day") {
      void execute({ type: "place-pool-item", poolItemId: itemId, day: over.day, index: over.index });
    }
    if (active?.origin === "day" && over.target === "pool") {
      void execute({ type: "return-item-to-pool", day: active.day, itemId });
    }
    if (active?.origin === "day" && over.target === "day") {
      if (active.day === over.day) {
        const orderedGroupIds = reorderGroupIds(plan, active.day, itemId, over.index);
        if (orderedGroupIds) void execute({ type: "reorder-day", day: active.day, orderedGroupIds });
      } else {
        void execute({ type: "move-day-item", fromDay: active.day, toDay: over.day, itemId, toIndex: over.index });
      }
    }
  }

  function addPoiToPool(poi: AmapPoi) {
    void execute({ type: "add-poi-to-pool", poi: groundedFromAmap(poi) });
  }

  function addPoiToDay(poi: AmapPoi, day: number) {
    void execute({ type: "add-poi-to-day", day, poi: groundedFromAmap(poi) });
  }

  function savePrefs() {
    void execute({ type: "set-transport-prefs", prefs: { shortKm: Number(shortKm), shortMode, longMode } }, { recalcAfterPrefs: true });
  }

  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="flex min-h-[calc(100vh-2rem)] overflow-hidden rounded-lg border bg-background">
        <PoolPanel
          items={plan.pool}
          dayCount={plan.days.length}
          tripId={tripId}
          onPlace={(poolItemId, day) => void execute({ type: "place-pool-item", poolItemId, day })}
          onPoiToPool={addPoiToPool}
          onPoiToDay={addPoiToDay}
        />
        <main className="flex min-w-0 flex-1 flex-col">
          {message ? <div className="border-b bg-yellow-50 px-4 py-2 text-sm text-yellow-900">{message}</div> : null}
          <div className="flex items-center gap-3 border-b px-4 py-3">
            <button type="button" onClick={() => void execute({ type: "add-day" })} className="rounded-md border px-3 py-2 text-sm">+新增 Day</button>
            <label className="text-xs">
              短途 km
              <input value={shortKm} onChange={(event) => setShortKm(event.target.value)} className="ml-2 w-16 rounded-md border px-2 py-1" />
            </label>
            <ModeSelect label="短途" value={shortMode} onChange={setShortMode} />
            <ModeSelect label="长途" value={longMode} onChange={setLongMode} />
            <button type="button" onClick={savePrefs} className="rounded-md border px-3 py-2 text-sm">交通偏好</button>
          </div>
          <div className="flex min-h-0 flex-1 overflow-x-auto">
            {plan.days.map((day, index) => (
              <DayLane
                key={day.index ?? index}
                day={day}
                dayNumber={index + 1}
                onRemoveToPool={(itemId) => void execute({ type: "return-item-to-pool", day: index + 1, itemId })}
                onEditItem={(itemId, set) => void execute({ type: "edit-item", day: index + 1, itemId, set })}
                onTheme={(theme) => void execute({ type: "set-day-theme", day: index + 1, theme })}
                onDeleteDay={() => void execute({ type: "remove-day", day: index + 1 })}
                onOptimize={() => void execute({ type: "optimize-day", day: index + 1 })}
                onSetTransport={(segmentIndex, mode) => void execute({ type: "set-transport", day: index + 1, segmentIndex, mode })}
                onRecalc={() => void execute({ type: "recalc-transport", day: index + 1 })}
                onCardClick={(itemId) => setSelectedItemId(itemId)}
              />
            ))}
            <aside className="min-w-80 bg-muted/30 p-4">
              <h2 className="text-base font-semibold">地图</h2>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => setMapFocus("all")} className="rounded-md border px-2 py-1 text-xs">地图总览</button>
                {plan.days.map((day, index) => (
                  <button key={day.index ?? index} type="button" onClick={() => setMapFocus(index + 1)} className="rounded-md border px-2 py-1 text-xs">
                    地图 Day {index + 1}
                  </button>
                ))}
                <label className="flex items-center gap-1 text-xs">
                  <input type="checkbox" checked={showPoolOnMap} onChange={(event) => setShowPoolOnMap(event.target.checked)} />
                  显示池点
                </label>
              </div>
              <div className="mt-3 h-[calc(100%-2rem)]">
                <WorkbenchMap
                  days={plan.days}
                  pool={plan.pool}
                  focus={mapFocus}
                  selectedItemId={selectedItemId}
                  showPool={showPoolOnMap}
                  onMarkerClick={(itemId) => setSelectedItemId(itemId)}
                />
              </div>
            </aside>
          </div>
        </main>
      </div>
      {selectedItem ? (
        <DetailDrawer
          item={selectedItem}
          note={notes.find((note) => note.id === itemSourceNoteId(selectedItem))}
          onClose={() => setSelectedItemId(null)}
        />
      ) : null}
    </DndContext>
  );
}

type DragSource = { origin?: "pool"; itemId?: string } | { origin?: "day"; itemId?: string; day: number };
type DropTarget = { target: "pool" } | { target: "day"; day: number; index?: number };

function ModeSelect({ label, value, onChange }: { label: string; value: TransportMode; onChange: (value: TransportMode) => void }) {
  return (
    <label className="text-xs">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value as TransportMode)} className="ml-2 rounded-md border px-2 py-1">
        <option value="walk">步行</option>
        <option value="bike">骑行</option>
        <option value="public">公交</option>
        <option value="drive">驾车</option>
      </select>
    </label>
  );
}

function groundedFromAmap(poi: AmapPoi): GroundedPoi {
  return {
    id: poi.amapId,
    name: poi.name,
    type: "other",
    reason: "手动添加",
    sourceNoteId: "manual",
    sourceType: "manual",
    verified: true,
    amapId: poi.amapId,
    location: poi.location,
    address: poi.address,
    openHours: poi.openHours,
    rating: poi.rating
  };
}

function findItem(plan: TripPlan, id: string) {
  return [...plan.days.flatMap((day) => day.items), ...plan.pool].find((item) => (item.clusterKey ?? item.id ?? item.poiId ?? item.name) === id);
}

function itemSourceNoteId(item: ReturnType<typeof findItem>) {
  return item?.poi?.sourceNoteId ?? (item as { sourceNoteId?: string } | undefined)?.sourceNoteId;
}

function reorderGroupIds(plan: TripPlan, dayNumber: number, itemId: string, targetItemIndex: number | undefined) {
  const day = plan.days[dayNumber - 1];
  if (!day) return undefined;
  const groups = groupAdjacent(day.items);
  const activeIndex = groups.findIndex((group) => group.id === itemId || group.items.some((item) => rawItemId(item) === itemId));
  if (activeIndex < 0) return undefined;
  const itemIndex = targetItemIndex ?? day.items.length;
  let targetGroupIndex = groups.filter((group) => group.index < itemIndex).length;
  if (targetGroupIndex > activeIndex) targetGroupIndex -= 1;
  const ordered = groups.map((group) => group.id);
  const [activeId] = ordered.splice(activeIndex, 1);
  ordered.splice(targetGroupIndex, 0, activeId);
  if (ordered.every((id, index) => id === groups[index].id)) return undefined;
  return ordered;
}

function groupAdjacent(items: TripPlan["days"][number]["items"]) {
  const groups: Array<{ id: string; index: number; items: TripPlan["days"][number]["items"] }> = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const id = item.clusterKey ?? rawItemId(item);
    const last = groups.at(-1);
    if (last && item.clusterKey && last.id === item.clusterKey) last.items.push(item);
    else groups.push({ id, index, items: [item] });
  }
  return groups;
}

function rawItemId(item: TripPlan["days"][number]["items"][number]) {
  return item.poiId ?? item.id ?? item.name ?? "";
}
