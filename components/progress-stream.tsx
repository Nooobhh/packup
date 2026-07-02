"use client";

import React from "react";
import type { StageEvent } from "@/lib/pipeline/types";

export function ProgressStream({ events }: { events: StageEvent[] }) {
  if (events.length === 0) return null;
  return (
    <ol className="mt-4 space-y-2">
      {events.map((event, index) => (
        <li key={`${event.stage}-${event.status}-${index}`} className="rounded-md border p-3 text-sm">
          <span className="font-medium">{event.stage}</span> {event.status === "done" ? "✓" : event.status === "error" ? "✗" : "进行中"}
          {event.detail ? <span className="text-muted-foreground"> {event.detail}</span> : null}
        </li>
      ))}
    </ol>
  );
}
