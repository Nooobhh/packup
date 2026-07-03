import React from "react";
import type { PlanDay, PlanItem, Slot } from "@/lib/pipeline/types";

const SLOT_LABEL: Record<Slot, string> = { morning: "上午", afternoon: "下午", evening: "晚上" };
const MODE_LABEL: Record<string, string> = { walk: "步行", public: "公交", drive: "驾车", bike: "骑行" };

export function DayTimeline({ day }: { day: PlanDay }) {
  const hasSlots = day.items.some((item) => item.slot);
  if (!hasSlots) return <ol className="space-y-3">{groupAdjacent(day.items).map(renderNode)}</ol>;

  return (
    <div className="space-y-5">
      {(["morning", "afternoon", "evening"] as Slot[]).map((slot) => {
        const items = day.items.filter((item) => item.slot === slot);
        if (items.length === 0) return null;
        return (
          <section key={slot} className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">{SLOT_LABEL[slot]}</h3>
            <ol className="space-y-3">{groupAdjacent(items).map(renderNode)}</ol>
          </section>
        );
      })}
    </div>
  );
}

function groupAdjacent(items: PlanItem[]) {
  const groups: PlanItem[][] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && item.clusterKey && last[0].clusterKey === item.clusterKey) last.push(item);
    else groups.push([item]);
  }
  return groups;
}

function renderNode(group: PlanItem[], index: number) {
  const first = group[0];
  const title = group.map((item) => item.name ?? item.poi?.name).join(" + ");
  return (
    <li key={first.id ?? `${first.startTime}-${index}`} className="rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        {first.startTime ? <time className="font-mono text-sm">{first.startTime}</time> : null}
        <h4 className="font-semibold">{title}</h4>
        <span className="rounded bg-secondary px-2 py-0.5 text-xs">{first.type ?? first.poi?.type}</span>
        {group.some((item) => (item.verified ?? item.poi?.verified) === false) ? <span className="rounded bg-yellow-100 px-2 py-0.5 text-xs text-yellow-900">未验证</span> : null}
      </div>
      <div className="mt-2 grid gap-1 text-sm text-muted-foreground">
        {group.length === 1 ? renderItemDetails(first) : group.map((item) => <div key={item.id ?? item.name}>{item.name ?? item.poi?.name}: {item.reason ?? item.poi?.reason} / {item.durationMin} min</div>)}
        {first.transportToNext ? <span>下一段 {MODE_LABEL[first.transportToNext.mode] ?? first.transportToNext.mode}: {first.transportToNext.durationMin} min / {first.transportToNext.distanceKm.toFixed(2)} km</span> : null}
      </div>
    </li>
  );
}

function renderItemDetails(item: PlanItem) {
  return (
    <>
      <span>{item.address ?? item.poi?.address}</span>
      <span>{item.openHours ?? item.poi?.openHours ?? "未知"}</span>
      <span>{item.durationMin} min</span>
      {item.reason ?? item.poi?.reason ? <span>{item.reason ?? item.poi?.reason}</span> : null}
      {item.note ? <span>{item.note}</span> : null}
    </>
  );
}
