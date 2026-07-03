"use client";

import React, { useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import type { PlanItem } from "@/lib/pipeline/types";

export function PoiCard({
  item,
  dragId,
  origin,
  dragData,
  onClick,
  onEdit,
  actions
}: {
  item: PlanItem;
  dragId: string;
  origin: "pool" | "day";
  dragData?: Record<string, unknown>;
  onClick?: () => void;
  onEdit?: (set: { note?: string; startTime?: string; durationMin?: number }) => void;
  actions?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(item.note ?? "");
  const [startTime, setStartTime] = useState(item.startTime ?? "");
  const [durationMin, setDurationMin] = useState(String(item.durationMin));
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: dragId,
    data: { origin, itemId: item.clusterKey ?? item.id ?? item.poiId ?? item.name, ...dragData }
  });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;

  function submitEdit() {
    onEdit?.({
      note: note || undefined,
      startTime: startTime || undefined,
      durationMin: Number(durationMin) > 0 ? Number(durationMin) : undefined
    });
    setEditing(false);
  }

  return (
    <article
      ref={setNodeRef}
      style={style}
      data-testid={origin === "pool" ? "pool-card" : "day-card"}
      className={`rounded-lg border bg-card p-3 text-sm shadow-sm ${isDragging ? "opacity-60" : ""}`}
    >
      <button type="button" onClick={onClick} className="block w-full text-left" {...listeners} {...attributes}>
        <div className="flex items-center gap-2">
          <h4 className="font-medium">{item.name ?? item.poi?.name}</h4>
          <span className="rounded bg-secondary px-2 py-0.5 text-xs">{item.type ?? item.poi?.type ?? "other"}</span>
          {(item.verified ?? item.poi?.verified) === false ? <span className="rounded bg-yellow-100 px-2 py-0.5 text-xs text-yellow-900">未验证</span> : null}
        </div>
        <p className="mt-1 line-clamp-2 text-muted-foreground">{item.note ?? item.reason ?? item.poi?.reason ?? item.address ?? item.poi?.address}</p>
        <p className="mt-2 text-xs text-muted-foreground">{item.durationMin} min</p>
      </button>
      <div className="mt-3 flex flex-wrap gap-2">
        {actions}
        {onEdit ? (
          <button type="button" onClick={() => setEditing((value) => !value)} className="rounded-md border px-2 py-1 text-xs">
            编辑
          </button>
        ) : null}
      </div>
      {editing ? (
        <div className="mt-3 grid gap-2">
          <input aria-label="备注" value={note} onChange={(event) => setNote(event.target.value)} className="rounded-md border px-2 py-1 text-xs" />
          <input aria-label="开始时间" value={startTime} onChange={(event) => setStartTime(event.target.value)} placeholder="09:30" className="rounded-md border px-2 py-1 text-xs" />
          <input aria-label="停留分钟" value={durationMin} onChange={(event) => setDurationMin(event.target.value)} className="rounded-md border px-2 py-1 text-xs" />
          <button type="button" onClick={submitEdit} className="rounded-md bg-primary px-2 py-1 text-xs text-primary-foreground">
            保存
          </button>
        </div>
      ) : null}
    </article>
  );
}
