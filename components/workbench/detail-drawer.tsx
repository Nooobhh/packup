"use client";

import React from "react";
import type { Note, PlanItem } from "@/lib/pipeline/types";

type DrawerNote = Pick<Note, "id" | "title" | "author" | "url" | "body">;

export function DetailDrawer({ item, note, onClose }: { item: PlanItem & { sourceNoteId?: string }; note?: DrawerNote; onClose: () => void }) {
  const sourceNoteId = item.poi?.sourceNoteId ?? item.sourceNoteId;
  const name = item.name ?? item.poi?.name ?? "";
  const manual = sourceNoteId === "manual";
  const excerpt = note && name ? excerptAround(note.body, name) : undefined;

  return (
    <aside className="fixed inset-y-0 right-0 z-20 w-full max-w-md overflow-y-auto border-l bg-background p-5 shadow-xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">{name}</h2>
          <p className="text-sm text-muted-foreground">{item.address ?? item.poi?.address}</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-md border px-2 py-1 text-sm">关闭</button>
      </div>
      <dl className="mt-4 grid gap-2 text-sm">
        <div><dt className="font-medium">营业</dt><dd className="text-muted-foreground">{item.openHours ?? item.poi?.openHours ?? "未知"}</dd></div>
        <div><dt className="font-medium">评分</dt><dd className="text-muted-foreground">{item.poi?.rating ?? "未知"}</dd></div>
        <div><dt className="font-medium">推荐理由</dt><dd className="text-muted-foreground">{item.reason ?? item.poi?.reason ?? "无"}</dd></div>
      </dl>
      {manual ? (
        <p className="mt-4 rounded-md bg-secondary p-3 text-sm">手动添加</p>
      ) : note ? (
        <section className="mt-5 space-y-3">
          <h3 className="text-sm font-semibold">来源笔记引用</h3>
          {excerpt ? (
            <blockquote className="rounded-md border-l-4 pl-3 text-sm text-muted-foreground">{excerpt}</blockquote>
          ) : (
            <details open className="rounded-md border p-3 text-sm text-muted-foreground">
              <summary className="cursor-pointer font-medium text-foreground">笔记全文</summary>
              <p className="mt-2 whitespace-pre-wrap">{note.body}</p>
            </details>
          )}
          <div className="text-sm">
            <p className="font-medium">{note.title}</p>
            {note.author ? <p className="text-muted-foreground">{note.author}</p> : null}
            <a href={note.url} target="_blank" rel="noreferrer" className="underline">查看原笔记</a>
          </div>
        </section>
      ) : null}
    </aside>
  );
}

function excerptAround(body: string, needle: string) {
  const index = body.indexOf(needle);
  if (index < 0) return undefined;
  const start = Math.max(0, index - 80);
  const end = Math.min(body.length, index + needle.length + 80);
  return `${start > 0 ? "..." : ""}${body.slice(start, end)}${end < body.length ? "..." : ""}`;
}
