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
        await execute({ type: "optimize-day", day: 1 });
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
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : "";
    if (!overId) return;
    const active = event.active.data.current as { origin?: "pool" | "day"; itemId?: string } | undefined;
    const itemId = active?.itemId;
    if (!itemId) return;
    if (active?.origin === "pool" && overId.startsWith("day:")) {
      void execute({ type: "place-pool-item", poolItemId: itemId, day: Number(overId.split(":")[1]) });
    }
    if (active?.origin === "day" && overId === "pool-drop") {
      const fromDay = Number(activeId.split(":")[1]);
      void execute({ type: "return-item-to-pool", day: fromDay, itemId });
    }
    if (active?.origin === "day" && overId.startsWith("day:")) {
      const fromDay = Number(activeId.split(":")[1]);
      const toDay = Number(overId.split(":")[1]);
      if (fromDay !== toDay) void execute({ type: "move-day-item", fromDay, toDay, itemId });
    }
  }

  function addPoiToDay(poi: AmapPoi, day: number) {
    void execute({ type: "add-poi-to-day", day, poi: groundedFromAmap(poi) });
  }

  function savePrefs() {
    void execute({ type: "set-transport-prefs", prefs: { shortKm: Number(shortKm), shortMode, longMode } });
  }

  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="flex min-h-[calc(100vh-2rem)] overflow-hidden rounded-lg border bg-background">
        <PoolPanel
          items={plan.pool}
          dayCount={plan.days.length}
          tripId={tripId}
          onPlace={(poolItemId, day) => void execute({ type: "place-pool-item", poolItemId, day })}
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
                onRecalc={() => void patchRaw({ op: "recalc-transport", day: index + 1 })}
                onCardClick={(itemId) => setSelectedItemId(itemId)}
              />
            ))}
            <aside className="min-w-80 bg-muted/30 p-4">
              <h2 className="text-base font-semibold">地图</h2>
              <div className="mt-3 h-[calc(100%-2rem)]">
                <WorkbenchMap
                  days={plan.days}
                  pool={plan.pool}
                  focus="all"
                  selectedItemId={selectedItemId}
                  showPool
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

  async function patchRaw(body: object) {
    const response = await fetch(`/api/trips/${tripId}/plan`, { method: "PATCH", body: JSON.stringify(body) });
    if (response.ok) setPlan(await response.json());
    else setMessage("保存失败,已回滚");
  }
}

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
