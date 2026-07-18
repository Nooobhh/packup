import React from "react";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { CanvasWorkbench } from "@/components/canvas/canvas-workbench";
import { CanvasNotices } from "@/components/canvas/canvas-notices";
import { NoteSchema, TripInputSchema, parseTripPlan } from "@/lib/pipeline/types";

export default async function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = await readTripPayload(id);
  if (!payload) return <main className="p-6">行程不存在或尚未生成</main>;
  const { plan, failedLinks, notes } = payload;
  return (
    <main>
      <CanvasWorkbench initialPlan={plan} initialNotes={notes} tripId={id} />
      <CanvasNotices
        notices={{
          daysDecision: daysDecisionText(plan.daysDecision),
          warnings: plan.warnings,
          failedLinks,
          filtered: plan.filtered
        }}
      />
    </main>
  );
}

function daysDecisionText(decision: unknown): string | undefined {
  // 兼容历史落盘数据里 LLM 输出的字面量 "null" 等无意义字符串
  const text = typeof decision === "string" ? decision : decision && typeof decision === "object" && "reason" in decision ? String((decision as { reason: unknown }).reason) : "";
  if (!text.trim() || ["null", "none", "undefined"].includes(text.trim().toLowerCase())) return undefined;
  return text;
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
    const plan = parseTripPlan(JSON.parse(planRaw));
    const notes = NoteSchema.array().parse(JSON.parse(notesRaw));
    const pois = JSON.parse(poisRaw) as { failedNotes?: { noteId: string; reason: string }[] };
    const byNoteId = new Map(notes.map((note) => [note.id, note]));
    const failedLinks = [
      ...notes.filter((note) => note.fetchStatus === "failed").map((note) => ({ url: note.url, reason: note.failReason ?? "fetch failed" })),
      ...(pois.failedNotes ?? []).map((failed) => ({ url: byNoteId.get(failed.noteId)?.url ?? failed.noteId, reason: failed.reason }))
    ];
    const notesWithImages = await Promise.all(
      notes.map(async (note) => ({
        id: note.id,
        title: note.title,
        author: note.author,
        url: note.url,
        images: await localImagePaths(dir, id, note.id)
      }))
    );
    return { input, plan, failedLinks, notes: notesWithImages };
  } catch {
    return null;
  }
}

/** 列出 fetch 阶段缓存到本地的笔记图片,转为 serve API 路径 */
async function localImagePaths(dir: string, tripId: string, noteId: string): Promise<string[]> {
  const files = await readdir(path.join(dir, "images", noteId)).catch(() => [] as string[]);
  return files
    .filter((file) => /^\d+\.(jpg|jpeg|png|webp)$/i.test(file))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
    .map((file) => `/api/trips/${tripId}/images/${noteId}/${file}`);
}
