import React from "react";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DayMap } from "@/components/day-map";
import { DayTimeline } from "@/components/day-timeline";
import { FailedLinksSection, FilteredSection } from "@/components/filtered-section";
import { TripInputSchema, TripPlanSchema } from "@/lib/pipeline/types";

export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = await readTripPayload(id);
  if (!payload) return <main className="p-6">行程不存在或尚未生成</main>;
  const { plan, failedLinks } = payload;
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      {plan.warnings.length ? <div className="rounded-lg border bg-yellow-50 p-4 text-sm">{plan.warnings.join(" / ")}</div> : null}
      {plan.daysDecision ? <p className="text-sm text-muted-foreground">{typeof plan.daysDecision === "string" ? plan.daysDecision : plan.daysDecision.reason}</p> : null}
      <FailedLinksSection failedLinks={failedLinks} />
      <div className="space-y-8">
        {plan.days.map((day, index) => (
          <section key={day.index ?? day.day ?? index} className="grid gap-4 lg:grid-cols-[1fr_360px]">
            <div>
              <h2 className="mb-3 text-lg font-semibold">Day {day.index ?? day.day ?? index + 1}{day.theme ? ` · ${day.theme}` : ""}</h2>
              <DayTimeline day={day} />
            </div>
            <DayMap day={day} />
          </section>
        ))}
      </div>
      <FilteredSection filtered={plan.filtered} />
    </main>
  );
}

async function readTripPayload(id: string) {
  const dir = path.join(process.env.PACKUP_DATA_DIR ?? path.join(process.cwd(), "data/trips"), id);
  try {
    const [inputRaw, planRaw, notesRaw, poisRaw] = await Promise.all([
      readFile(path.join(dir, "00-input.json"), "utf8"),
      readFile(path.join(dir, "40-plan.json"), "utf8"),
      readFile(path.join(dir, "10-notes.json"), "utf8").catch(() => "[]"),
      readFile(path.join(dir, "20-pois.json"), "utf8").catch(() => "{}")
    ]);
    const input = TripInputSchema.parse(JSON.parse(inputRaw));
    const plan = TripPlanSchema.parse(JSON.parse(planRaw));
    const notes = JSON.parse(notesRaw) as { id: string; url: string; fetchStatus: string; failReason?: string }[];
    const pois = JSON.parse(poisRaw) as { failedNotes?: { noteId: string; reason: string }[] };
    const byNoteId = new Map(notes.map((note) => [note.id, note]));
    const failedLinks = [
      ...notes.filter((note) => note.fetchStatus === "failed").map((note) => ({ url: note.url, reason: note.failReason ?? "fetch failed" })),
      ...(pois.failedNotes ?? []).map((failed) => ({ url: byNoteId.get(failed.noteId)?.url ?? failed.noteId, reason: failed.reason }))
    ];
    return { input, plan, failedLinks };
  } catch {
    return null;
  }
}
