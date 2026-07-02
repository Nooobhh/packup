"use client";

import React, { useMemo, useState } from "react";
import { normalizeLinks } from "@/lib/fetchers/normalize";
import type { StageEvent } from "@/lib/pipeline/types";
import { ProgressStream } from "./progress-stream";

export function TripForm() {
  const [linksText, setLinksText] = useState("");
  const [destination, setDestination] = useState("");
  const [daysBase, setDaysBase] = useState("");
  const [daysFlex, setDaysFlex] = useState("");
  const [startDate, setStartDate] = useState("");
  const [transport, setTransport] = useState("public");
  const [pace, setPace] = useState("moderate");
  const [themes, setThemes] = useState<string[]>([""]);
  const [events, setEvents] = useState<StageEvent[]>([]);
  const [error, setError] = useState("");
  const links = useMemo(() => normalizeLinks(linksText), [linksText]);
  const baseNumber = Number(daysBase);
  const themeCount = Number.isFinite(baseNumber) && baseNumber > 0 ? baseNumber : 1;

  function updateDays(value: string) {
    setDaysBase(value);
    const count = Number(value);
    setThemes((old) => Array.from({ length: Number.isFinite(count) && count > 0 ? count : 1 }, (_, index) => old[index] ?? ""));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!destination.trim()) {
      setError("请填写目的地");
      return;
    }
    if (links.length === 0) {
      setError("请粘贴小红书链接");
      return;
    }

    const body = {
      links,
      destination: destination.trim(),
      days: daysBase ? { base: Number(daysBase), flex: daysFlex ? Number(daysFlex) : 0 } : undefined,
      dailyThemes: daysBase ? themes.map((theme) => theme || null) : undefined,
      startDate: startDate || undefined,
      transport,
      pace
    };
    const response = await fetch("/api/generate", { method: "POST", body: JSON.stringify(body) });
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
        if (payload.stage === "done") {
          window.location.href = `/trip/${payload.tripId}`;
          return;
        }
        if (payload.status === "error") setError("已完成段保留,可重跑");
        setEvents((old) => [...old, payload]);
      }
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <form onSubmit={submit} className="space-y-5 rounded-lg border bg-card p-5">
        <div className="space-y-2">
          <label htmlFor="links" className="block text-sm font-medium">小红书链接</label>
          <textarea id="links" value={linksText} onChange={(event) => setLinksText(event.target.value)} className="min-h-32 w-full rounded-md border p-3 text-sm" />
          <p className="text-sm text-muted-foreground">识别到 {links.length} 条小红书链接</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            目的地
            <input value={destination} onChange={(event) => setDestination(event.target.value)} className="mt-2 w-full rounded-md border p-2" />
          </label>
          <label className="block text-sm font-medium">
            天数
            <input aria-label="天数" type="number" min="1" max="15" value={daysBase} onChange={(event) => updateDays(event.target.value)} placeholder="将按内容推荐天数" className="mt-2 w-full rounded-md border p-2" />
          </label>
          <label className="block text-sm font-medium">
            ± flex
            <input type="number" min="0" value={daysFlex} onChange={(event) => setDaysFlex(event.target.value)} className="mt-2 w-full rounded-md border p-2" />
          </label>
          <label className="block text-sm font-medium">
            startDate
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="mt-2 w-full rounded-md border p-2" />
          </label>
          <label className="block text-sm font-medium">
            transport
            <select value={transport} onChange={(event) => setTransport(event.target.value)} className="mt-2 w-full rounded-md border p-2">
              <option value="public">public</option>
              <option value="drive">drive</option>
              <option value="walk">walk</option>
            </select>
          </label>
          <label className="block text-sm font-medium">
            pace
            <select value={pace} onChange={(event) => setPace(event.target.value)} className="mt-2 w-full rounded-md border p-2">
              <option value="moderate">moderate</option>
              <option value="packed">packed</option>
              <option value="relaxed">relaxed</option>
            </select>
          </label>
        </div>
        <div className="space-y-2">
          {Array.from({ length: themeCount }, (_, index) => (
            <label key={index} className="block text-sm font-medium">
              第 {index + 1} 天主题
              <input
                aria-label={`第 ${index + 1} 天主题`}
                disabled={!daysBase}
                value={themes[index] ?? ""}
                onChange={(event) => setThemes((old) => old.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)))}
                className="mt-2 w-full rounded-md border p-2 disabled:bg-muted"
              />
            </label>
          ))}
          {!daysBase ? <p className="text-sm text-muted-foreground">填天数后可指定每日主题</p> : null}
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">生成行程</button>
      </form>
      <ProgressStream events={events} />
    </main>
  );
}
