"use client";

import React, { useState } from "react";
import { Bell, X } from "lucide-react";
import type { FilteredItem } from "@/lib/pipeline/types";

export type Notices = {
  daysDecision?: string;
  warnings: string[];
  failedLinks: Array<{ url: string; reason: string }>;
  filtered: FilteredItem[];
};

/** 顶栏下方浮动提示签:管线 warnings / 抓取失败 / 落选地点 */
export function CanvasNotices({ notices }: { notices: Notices }) {
  const [open, setOpen] = useState(false);
  const count = notices.warnings.length + notices.failedLinks.length + (notices.daysDecision ? 1 : 0);
  if (count === 0 && notices.filtered.length === 0) return null;

  return (
    <div data-canvas-ui className="fixed left-4 top-[4.5rem] z-40">
      {open ? (
        <div className="max-h-[60vh] w-80 overflow-y-auto rounded-[14px] border-2 border-ink bg-white p-3 text-[13px] hard-shadow">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-display text-[15px] font-bold text-ink">提示</h3>
            <button type="button" onClick={() => setOpen(false)} aria-label="收起提示" className="flex h-6 w-6 items-center justify-center rounded-full border border-line text-ink hover:bg-accent-soft">
              <X size={13} />
            </button>
          </div>
          {notices.daysDecision ? <p className="mb-2 rounded-[10px] bg-accent-soft px-2.5 py-1.5 text-accent">{notices.daysDecision}</p> : null}
          {notices.warnings.map((warning) => (
            <p key={warning} className="mb-1.5 rounded-[10px] bg-paper px-2.5 py-1.5 text-ink">
              {warning}
            </p>
          ))}
          {notices.failedLinks.map((failed) => (
            <p key={failed.url} className="mb-1.5 rounded-[10px] bg-warn/40 px-2.5 py-1.5 text-warn-ink">
              抓取失败:{failed.url}({failed.reason})
            </p>
          ))}
          {notices.filtered.length ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-[12px] font-medium text-ink-soft">落选地点 {notices.filtered.length} 个(管线过滤)</summary>
              <ul className="mt-1.5 space-y-1">
                {notices.filtered.map((item) => (
                  <li key={`${item.name}:${item.stage}`} className="rounded-[8px] border border-line px-2 py-1 text-[12px] text-ink-soft">
                    <span className="font-medium text-ink">{item.name}</span> · {item.reason}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 rounded-full border-2 border-ink bg-white px-3 py-1.5 text-[12px] font-semibold text-ink hard-shadow transition-transform hover:-translate-y-px"
        >
          <Bell size={13} />
          提示 {count > 0 ? count : notices.filtered.length}
        </button>
      )}
    </div>
  );
}
