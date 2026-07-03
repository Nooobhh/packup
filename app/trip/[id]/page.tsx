import React from "react";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { FailedLinksSection, FilteredSection } from "@/components/filtered-section";
import { TripWorkbench } from "@/components/workbench/trip-workbench";
import { NoteSchema, TripInputSchema, TripPlanSchema } from "@/lib/pipeline/types";

export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = await readTripPayload(id);
  if (!payload) return <main className="p-6">行程不存在或尚未生成</main>;
  const { plan, failedLinks, notes } = payload;
  return (
    <main className="space-y-6 px-6 py-8">
      {plan.warnings.length ? (
        <details className="rounded-lg border bg-yellow-50 p-4 text-sm">
          <summary className="cursor-pointer font-medium">提示 {plan.warnings.length} 条</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {plan.warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </details>
      ) : null}
      {renderDaysDecision(plan.daysDecision)}
      <FailedLinksSection failedLinks={failedLinks} />
      <TripWorkbench initialPlan={plan} initialNotes={notes} tripId={id} />
      <FilteredSection filtered={plan.filtered} />
    </main>
  );
}

function renderDaysDecision(decision: unknown) {
  // 兼容历史落盘数据里 LLM 输出的字面量 "null" 等无意义字符串
  const text = typeof decision === "string" ? decision : decision && typeof decision === "object" && "reason" in decision ? String((decision as { reason: unknown }).reason) : "";
  if (!text.trim() || ["null", "none", "undefined"].includes(text.trim().toLowerCase())) return null;
  return <p className="text-sm text-muted-foreground">{text}</p>;
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
    const notes = NoteSchema.array().parse(JSON.parse(notesRaw));
    const pois = JSON.parse(poisRaw) as { failedNotes?: { noteId: string; reason: string }[] };
    const byNoteId = new Map(notes.map((note) => [note.id, note]));
    const failedLinks = [
      ...notes.filter((note) => note.fetchStatus === "failed").map((note) => ({ url: note.url, reason: note.failReason ?? "fetch failed" })),
      ...(pois.failedNotes ?? []).map((failed) => ({ url: byNoteId.get(failed.noteId)?.url ?? failed.noteId, reason: failed.reason }))
    ];
    return {
      input,
      plan,
      failedLinks,
      notes: notes.map((note) => ({ id: note.id, title: note.title, author: note.author, url: note.url, body: note.body }))
    };
  } catch {
    return null;
  }
}
