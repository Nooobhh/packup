import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { ExtractOutputSchema, NoteSchema, TripInputSchema, TripPlanSchema } from "@/lib/pipeline/types";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const dir = path.join(process.env.PACKUP_DATA_DIR ?? path.join(process.cwd(), "data/trips"), id);
  if (!(await exists(dir))) {
    return Response.json({ error: "Trip not found" }, { status: 404 });
  }

  const planPath = path.join(dir, "40-plan.json");
  if (!(await exists(planPath))) {
    const error = await readFirstError(dir);
    if (error) return Response.json(error, { status: 409 });
    return Response.json({ error: "Trip plan not ready" }, { status: 409 });
  }

  const input = TripInputSchema.parse(await readJson(path.join(dir, "00-input.json")));
  const notes = NoteSchema.array().parse(await readJson(path.join(dir, "10-notes.json")).catch(() => []));
  const extract = ExtractOutputSchema.partial().parse(await readJson(path.join(dir, "20-pois.json")).catch(() => ({})));
  const plan = TripPlanSchema.parse(await readJson(planPath));
  const byNoteId = new Map(notes.map((note) => [note.id, note]));
  const failedLinks = [
    ...notes.filter((note) => note.fetchStatus === "failed").map((note) => ({ url: note.url, reason: note.failReason ?? "fetch failed" })),
    ...(extract.failedNotes ?? []).map((failed) => ({
      url: byNoteId.get(failed.noteId)?.url ?? failed.noteId,
      reason: failed.reason
    }))
  ];
  const responseNotes = notes.map((note) => ({
    id: note.id,
    title: note.title,
    author: note.author,
    url: note.url,
    body: note.body
  }));

  return Response.json({ plan, failedLinks, input, notes: responseNotes });
}

async function exists(file: string) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function readJson(file: string) {
  return JSON.parse(await readFile(file, "utf8")) as unknown;
}

async function readFirstError(dir: string) {
  const files = await readdir(dir).catch(() => []);
  const errorFile = files.find((file) => file.endsWith(".error.json"));
  if (!errorFile) return undefined;
  return readJson(path.join(dir, errorFile));
}
