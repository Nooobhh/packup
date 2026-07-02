import React from "react";
import type { FilteredItem } from "@/lib/pipeline/types";

export function FilteredSection({ filtered }: { filtered: FilteredItem[] }) {
  if (filtered.length === 0) return null;
  return (
    <section className="mt-6 rounded-lg border p-4">
      <h2 className="font-semibold">过滤项</h2>
      <ul className="mt-3 space-y-2 text-sm">
        {filtered.map((item, index) => (
          <li key={item.id ?? `${item.name}-${index}`} className="flex flex-wrap gap-2">
            <span className="font-medium">{item.name}</span>
            <span>{item.stage}</span>
            {item.sourceNoteId ? <span>{item.sourceNoteId}</span> : null}
            <span className="text-muted-foreground">{item.reason}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function FailedLinksSection({ failedLinks }: { failedLinks: { url: string; reason: string }[] }) {
  if (failedLinks.length === 0) return null;
  return (
    <section className="rounded-lg border p-4">
      <h2 className="font-semibold">失败链接</h2>
      <ul className="mt-3 space-y-2 text-sm">
        {failedLinks.map((item) => (
          <li key={item.url}>
            <span className="font-mono">{item.url}</span>
            <span className="ml-2 text-muted-foreground">{item.reason}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
