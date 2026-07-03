"use client";

import React, { useMemo, useState } from "react";
import { normalizeLinks } from "@/lib/fetchers/normalize";
import type { StageEvent } from "@/lib/pipeline/types";
import { ProgressStream } from "./progress-stream";

export function TripForm() {
  const [query, setQuery] = useState("");
  const [linksText, setLinksText] = useState("");
  const [events, setEvents] = useState<StageEvent[]>([]);
  const [error, setError] = useState("");
  const [tripId, setTripId] = useState("");
  const [manualDestination, setManualDestination] = useState("");
  const [manualDays, setManualDays] = useState("3");
  const links = useMemo(() => normalizeLinks(linksText), [linksText]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setTripId("");
    setEvents([]);
    if (!query.trim()) {
      setError("请填写旅行需求");
      return;
    }
    if (links.length === 0) {
      setError("请粘贴小红书链接");
      return;
    }

    const response = await fetch("/api/generate", { method: "POST", body: JSON.stringify({ query: query.trim(), links }) });
    if (!response.ok || !response.body) {
      setError("生成请求失败");
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
        if (typeof payload.tripId === "string") setTripId(payload.tripId);
        if (payload.status === "await-selection") {
          window.location.href = `/trip/${payload.tripId}/select`;
          return;
        }
        if (payload.status === "error") setError("已完成段保留,可重跑");
        if (isStageEvent(payload)) setEvents((old) => [...old, payload]);
      }
    }
  }

  async function submitManual() {
    setError("");
    const destination = manualDestination.trim();
    const days = Number(manualDays);
    if (!destination || !Number.isInteger(days)) {
      setError("请填写手动行程目的地和天数");
      return;
    }
    const response = await fetch("/api/trips", { method: "POST", body: JSON.stringify({ destination, days: { base: days } }) });
    if (!response.ok) {
      setError("创建空行程失败");
      return;
    }
    const payload = await response.json();
    window.location.href = `/trip/${payload.tripId}`;
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <form onSubmit={submit} className="space-y-5 rounded-lg border bg-card p-5">
        <label className="block text-sm font-medium">
          旅行需求
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="香港3天2晚 city walk+美食"
            className="mt-2 w-full rounded-md border p-3 text-sm"
          />
        </label>
        <div className="space-y-2">
          <label htmlFor="links" className="block text-sm font-medium">小红书链接</label>
          <textarea id="links" value={linksText} onChange={(event) => setLinksText(event.target.value)} className="min-h-32 w-full rounded-md border p-3 text-sm" />
          <p className="text-sm text-muted-foreground">识别到 {links.length} 条小红书链接</p>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {tripId ? (
          <p className="text-sm text-muted-foreground">
            行程 ID: {tripId}, 中断后可访问 <a className="underline" href={`/trip/${tripId}/select`}>/trip/{tripId}/select</a> 继续
          </p>
        ) : null}
        <button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">生成行程</button>
      </form>
      <section className="mt-5 space-y-4 rounded-lg border bg-card p-5">
        <div className="grid gap-3 sm:grid-cols-[1fr_120px_auto]">
          <label className="block text-sm font-medium">
            手动目的地
            <input value={manualDestination} onChange={(event) => setManualDestination(event.target.value)} className="mt-2 w-full rounded-md border p-3 text-sm" />
          </label>
          <label className="block text-sm font-medium">
            手动天数
            <input type="number" min={1} max={15} value={manualDays} onChange={(event) => setManualDays(event.target.value)} className="mt-2 w-full rounded-md border p-3 text-sm" />
          </label>
          <div className="flex items-end">
            <button type="button" onClick={submitManual} className="rounded-md border px-4 py-3 text-sm font-medium">手动从零</button>
          </div>
        </div>
      </section>
      <ProgressStream events={events} />
    </main>
  );
}

function isStageEvent(value: unknown): value is StageEvent {
  return typeof value === "object" && value !== null && "stage" in value && "status" in value;
}
