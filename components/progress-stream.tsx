"use client";

import React from "react";
import type { StageEvent, StageName } from "@/lib/pipeline/types";

const STAGES: Array<{ key: StageName; label: string }> = [
  { key: "fetch", label: "抓取笔记" },
  { key: "extract", label: "提取地点" },
  { key: "ground", label: "地图校准" },
  { key: "plan", label: "智能排程" }
];

/** 生成进度:按管线段聚合展示最新状态(贴纸风) */
export function ProgressStream({ events }: { events: StageEvent[] }) {
  if (events.length === 0) return null;
  const latest = new Map<string, StageEvent>();
  for (const event of events) latest.set(event.stage, event);

  return (
    <ol className="mt-6 space-y-2.5 rounded-[18px] border-[3px] border-ink bg-white p-5 hard-shadow" aria-label="生成进度">
      {STAGES.filter((stage) => latest.has(stage.key)).map((stage, index) => {
        const event = latest.get(stage.key)!;
        return (
          <li key={stage.key} className="flex items-center gap-3">
            <StageBadge index={index + 1} status={event.status} />
            <span className={`font-display text-[15px] font-bold ${event.status === "error" ? "text-warn-ink" : "text-ink"}`}>{stage.label}</span>
            {event.status === "start" ? <RunningDots /> : null}
            {event.detail ? <span className="min-w-0 flex-1 truncate text-[12px] text-ink-soft">{event.detail}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

function StageBadge({ index, status }: { index: number; status: StageEvent["status"] }) {
  if (status === "done") {
    return (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-accent-soft text-[13px] font-bold text-accent hard-shadow">
        ✓
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-warn text-[13px] font-bold text-warn-ink hard-shadow">
        ✗
      </span>
    );
  }
  return (
    <span className="flex h-7 w-7 shrink-0 animate-pulse items-center justify-center rounded-full border-2 border-ink bg-white text-[13px] font-bold text-ink hard-shadow">
      {index}
    </span>
  );
}

function RunningDots() {
  return (
    <span className="flex items-center gap-0.5" aria-label="进行中">
      {[0, 1, 2].map((dot) => (
        <i key={dot} className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent-bright" style={{ animationDelay: `${dot * 140}ms` }} />
      ))}
    </span>
  );
}
