"use client";

import React, { useMemo, useState } from "react";
import type { FilteredItem, GroundedPoi, StageEvent } from "@/lib/pipeline/types";
import { ProgressStream } from "./progress-stream";

export function CandidateList({ tripId, grounded, filtered }: { tripId: string; grounded: GroundedPoi[]; filtered: FilteredItem[] }) {
  const defaultSelected = useMemo(() => new Set(grounded.filter((poi) => poi.verified).map((poi) => poi.id ?? poi.amapId ?? poi.name)), [grounded]);
  const [selected, setSelected] = useState(defaultSelected);
  const [events, setEvents] = useState<StageEvent[]>([]);
  const [error, setError] = useState("");
  const verified = grounded.filter((poi) => poi.verified);
  const unverified = grounded.filter((poi) => !poi.verified);

  function toggle(id: string) {
    setSelected((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit() {
    setError("");
    const response = await fetch(`/api/trips/${tripId}/selection`, {
      method: "POST",
      body: JSON.stringify({ selectedPoiIds: Array.from(selected), selectedAt: new Date().toISOString() })
    });
    if (!response.ok || !response.body) {
      setError("排程请求失败");
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const line = chunk.split("\n").find((item) => item.startsWith("data: "));
        if (!line) continue;
        const payload = JSON.parse(line.slice(6));
        if (payload.stage === "done") {
          window.location.href = `/trip/${payload.tripId}`;
          return;
        }
        if (payload.status === "error") setError("排程失败,可重试");
        setEvents((old) => [...old, payload]);
      }
    }
  }

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <h2 className="text-base font-semibold">已验证</h2>
        {verified.map((poi) => renderPoi(poi, selected, toggle))}
      </section>
      <section className="space-y-3">
        <h2 className="text-base font-semibold">未验证</h2>
        {unverified.map((poi) => renderPoi(poi, selected, toggle))}
      </section>
      {filtered.length ? <p className="text-sm text-muted-foreground">另有 {filtered.length} 项已过滤</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <p className="text-sm text-muted-foreground">未选中的地点会进入工作台待计划池；重新排程将覆盖工作台里的已有编辑。</p>
      <button type="button" disabled={selected.size === 0} onClick={submit} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
        排程
      </button>
      <ProgressStream events={events} />
    </div>
  );
}

function renderPoi(poi: GroundedPoi, selected: Set<string>, toggle: (id: string) => void) {
  const id = poi.id ?? poi.amapId ?? poi.name;
  return (
    <label key={id} className="flex gap-3 rounded-lg border p-3 text-sm">
      <input type="checkbox" checked={selected.has(id)} onChange={() => toggle(id)} aria-label={poi.name} />
      <span className="grid gap-1">
        <span className="font-medium">
          {poi.name} <span className="text-xs text-muted-foreground">{poi.type}</span>
          {!poi.verified ? <span className="ml-2 rounded bg-yellow-100 px-2 py-0.5 text-xs text-yellow-900">未验证</span> : null}
        </span>
        <span className="text-muted-foreground">{poi.reason}</span>
      </span>
    </label>
  );
}
