import path from "node:path";
import type { LLMRunner } from "@/lib/llm/types";
import { buildExtractPrompt } from "@/lib/prompts/extract";
import { BUDGETS } from "./budgets";
import type { CandidatePoi, FilteredItem, Note, TripInput } from "./types";
import { CandidatePoiSchema, FilteredItemSchema } from "./types";

export async function runExtract(
  notes: Note[],
  input: TripInput,
  llm: LLMRunner,
  opts: { workDir?: string } = {}
): Promise<{ pois: CandidatePoi[]; filtered: FilteredItem[]; failedNotes: { noteId: string; reason: string }[] }> {
  const okNotes = notes.filter((note) => note.fetchStatus === "ok");
  const results = await mapLimitWithDeadline(
    okNotes,
    3,
    (note) => extractOne(resolveNoteImages(note, opts.workDir), input, llm),
    BUDGETS.extractStageMs,
    (note) => ({ pois: [], filtered: [], failed: { noteId: note.id, reason: "提取超时" } })
  );
  return {
    pois: results.flatMap((result) => result.pois),
    filtered: results.flatMap((result) => result.filtered),
    failedNotes: results.flatMap((result) => result.failed ? [result.failed] : [])
  };
}

function resolveNoteImages(note: Note, workDir?: string): Note {
  if (!workDir) return note;
  return {
    ...note,
    images: note.images.map((image) => (path.isAbsolute(image) ? image : path.resolve(workDir, image)))
  };
}

async function extractOne(note: Note, input: TripInput, llm: LLMRunner) {
  let validationError: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: string;
    try {
      raw = await llm.run({
        prompt: buildExtractPrompt(note, input, validationError),
        images: note.images,
        jsonSchema: extractJsonSchema,
        timeoutMs: BUDGETS.extractPerNoteMs
      });
    } catch (error) {
      return { pois: [], filtered: [], failed: { noteId: note.id, reason: summarizeReason(error instanceof Error ? error.message : String(error)) } };
    }

    try {
      return normalizeExtractPayload(JSON.parse(raw), note.id);
    } catch (error) {
      validationError = error instanceof Error ? error.message : String(error);
      if (attempt === 1) {
        return { pois: [], filtered: [], failed: { noteId: note.id, reason: summarizeReason(validationError) } };
      }
    }
  }
  return { pois: [], filtered: [], failed: { noteId: note.id, reason: "unknown extract failure" } };
}

function normalizeExtractPayload(payload: unknown, noteId: string) {
  if (!payload || typeof payload !== "object") throw new Error("LLM output is not an object");
  const object = payload as { pois?: unknown[]; filtered?: unknown[] };
  const pois = (object.pois ?? []).map((item) => CandidatePoiSchema.parse({ ...(item as object), sourceNoteId: noteId }));
  const filtered = (object.filtered ?? []).map((item) =>
    FilteredItemSchema.parse({ ...(item as object), sourceNoteId: (item as { sourceNoteId?: string }).sourceNoteId ?? noteId, stage: "extract" })
  );
  return { pois, filtered, failed: undefined as undefined | { noteId: string; reason: string } };
}

async function mapLimitWithDeadline<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>, stageMs: number, onTimeout: (item: T) => R): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const deadline = Date.now() + stageMs;
  const timedOut = Symbol("timedOut");
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        results[index] = onTimeout(items[index]);
        continue;
      }
      const task = fn(items[index]);
      task.catch(() => undefined);
      const result = await Promise.race([task, sleep(remaining).then(() => timedOut)]);
      results[index] = result === timedOut ? onTimeout(items[index]) : (result as R);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeReason(reason: string) {
  return reason.replace(/\s+/g, " ").trim().slice(0, 200);
}

const extractJsonSchema = {
  type: "object",
  required: ["pois", "filtered"],
  properties: {
    pois: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "type", "reason", "sourceType"],
        properties: {
          name: { type: "string", description: "地点/店铺名称" },
          type: { type: "string", enum: ["sight", "food", "shop", "stay", "experience", "other"] },
          city: { type: "string", description: "所属城市,不确定留空" },
          reason: { type: "string", description: "推荐理由,保留笔记原文口吻" },
          suggestedDuration: { type: "string" },
          timeHint: { type: "string" },
          sourceType: { type: "string", enum: ["text", "image"] }
        }
      }
    },
    filtered: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "why"],
        properties: {
          name: { type: "string" },
          why: { type: "string", description: "被过滤原因" }
        }
      }
    }
  }
};
