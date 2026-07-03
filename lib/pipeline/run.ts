import { existsSync } from "node:fs";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { ManualFetcher } from "@/lib/fetchers/manual";
import type { ContentFetcher } from "@/lib/fetchers/types";
import { XhsCliFetcher } from "@/lib/fetchers/xhs-cli";
import { XhsHttpFetcher } from "@/lib/fetchers/xhs-http";
import { ClaudeCliRunner } from "@/lib/llm/claude-cli";
import type { LLMRunner } from "@/lib/llm/types";
import { AmapRestProvider } from "@/lib/map/amap-rest";
import type { MapProvider } from "@/lib/map/types";
import { runExtract } from "./extract";
import { runGround } from "./ground";
import { planItemFromPoi, runPlan } from "./plan";
import {
  ExtractOutputSchema,
  FilteredItemSchema,
  GroundOutputSchema,
  NoteSchema,
  SelectionSchema,
  TripInputSchema,
  TripPlanSchema,
  type ExtractOutput,
  type GroundOutput,
  type Note,
  type StageEvent,
  type StageName,
  type TripInput,
  type TripPlan
} from "./types";

const stages = ["fetch", "extract", "ground", "plan"] as const;
const outputFiles: Record<StageName, string> = {
  fetch: "10-notes.json",
  extract: "20-pois.json",
  ground: "30-grounded.json",
  plan: "40-plan.json"
};

export async function runPipeline(
  input: TripInput,
  deps: { fetcher: ContentFetcher; llm: LLMRunner; map: MapProvider },
  opts: { onEvent?: (e: StageEvent) => void; force?: boolean; fromStage?: StageName; toStage?: StageName } = {}
): Promise<{ tripId: string }> {
  const parsedInput = TripInputSchema.parse(input);
  const tripId = parsedInput.id ?? nanoid(10);
  const workDir = tripDir(tripId);
  await mkdir(workDir, { recursive: true });
  await writeJson(path.join(workDir, "00-input.json"), { ...parsedInput, id: tripId });

  const startIndex = await startStageIndex(workDir, opts);
  if (opts.force || opts.fromStage) await deleteDownstream(workDir, startIndex);

  for (let index = startIndex; index < stages.length; index++) {
    const stage = stages[index];
    try {
      emit(opts.onEvent, stage, "start");
      if (stage === "fetch") await runFetch(parsedInput, deps.fetcher, workDir);
      if (stage === "extract") await runExtractStage(parsedInput, deps.llm, workDir);
      if (stage === "ground") await runGroundStage(parsedInput, deps.map, workDir);
      if (stage === "plan") await runPlanStage(parsedInput, deps.llm, deps.map, workDir);
      emit(opts.onEvent, stage, "done");
      if (opts.toStage === stage) break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await writeJson(path.join(workDir, `${stage}.error.json`), {
        stage,
        error: message,
        input: summarizeInput(parsedInput)
      });
      emit(opts.onEvent, stage, "error", message);
      throw error;
    }
  }

  return { tripId };
}

export function createDefaultPipelineDeps(workDir?: string, input?: TripInput): { fetcher: ContentFetcher; llm: LLMRunner; map: MapProvider } {
  const manualDir = workDir ? path.join(workDir, "manual") : "";
  const useManual = Boolean(workDir && input && input.links.length === 0 && existsSyncish(manualDir));
  const fetcher = process.env.PACKUP_FETCHER === "cli" ? new XhsCliFetcher() : new XhsHttpFetcher();
  return {
    fetcher: useManual ? new ManualFetcher() : fetcher,
    llm: new ClaudeCliRunner(),
    map: new AmapRestProvider()
  };
}

function tripDir(tripId: string) {
  return path.join(process.env.PACKUP_DATA_DIR ?? path.join(process.cwd(), "data/trips"), tripId);
}

async function startStageIndex(workDir: string, opts: { force?: boolean; fromStage?: StageName }) {
  if (opts.fromStage) return stages.indexOf(opts.fromStage);
  if (opts.force) return 0;
  if (await exists(path.join(workDir, outputFiles.plan))) return stages.length;
  if (await exists(path.join(workDir, outputFiles.ground))) return stages.indexOf("plan");
  if (await exists(path.join(workDir, outputFiles.extract))) return stages.indexOf("ground");
  if (await exists(path.join(workDir, outputFiles.fetch))) return stages.indexOf("extract");
  return 0;
}

async function deleteDownstream(workDir: string, startIndex: number) {
  for (let index = startIndex; index < stages.length; index++) {
    await rm(path.join(workDir, outputFiles[stages[index]]), { force: true });
    await rm(path.join(workDir, `${stages[index]}.error.json`), { force: true });
  }
}

async function runFetch(input: TripInput, fetcher: ContentFetcher, workDir: string) {
  const notes = await fetcher.fetch(input.links, workDir);
  if (notes.length === 0 || notes.every((note) => note.fetchStatus === "failed")) {
    throw new Error("Fetch 全失败");
  }
  await writeJson(path.join(workDir, outputFiles.fetch), NoteSchema.array().parse(notes));
}

async function runExtractStage(input: TripInput, llm: LLMRunner, workDir: string) {
  const notes = NoteSchema.array().parse(await readJson(path.join(workDir, outputFiles.fetch)));
  const output = await runExtract(notes, input, llm, { workDir });
  await writeJson(path.join(workDir, outputFiles.extract), ExtractOutputSchema.parse(output));
}

async function runGroundStage(input: TripInput, map: MapProvider, workDir: string) {
  const extract = ExtractOutputSchema.parse(await readJson(path.join(workDir, outputFiles.extract)));
  const output = await runGround(extract.pois, input, map);
  await writeJson(
    path.join(workDir, outputFiles.ground),
    GroundOutputSchema.parse({ grounded: output.grounded, filtered: [...extract.filtered, ...output.filtered] })
  );
}

async function runPlanStage(input: TripInput, llm: LLMRunner, map: MapProvider, workDir: string) {
  const ground = GroundOutputSchema.parse(await readJson(path.join(workDir, outputFiles.ground)));
  const selectionFile = path.join(workDir, "25-selection.json");
  let selectedGrounded = ground.grounded;
  let filtered = ground.filtered;
  let poolPois: GroundOutput["grounded"] = [];
  if (await exists(selectionFile)) {
    const selection = SelectionSchema.parse(await readJson(selectionFile));
    const selected = new Set(selection.selectedPoiIds);
    selectedGrounded = ground.grounded.filter((poi) => selected.has(poi.id ?? poi.amapId ?? poi.name));
    const unselected = ground.grounded.filter((poi) => !selected.has(poi.id ?? poi.amapId ?? poi.name));
    poolPois = unselected.filter((poi) => poi.verified === true && Boolean(poi.location));
    filtered = [
      ...ground.filtered,
      ...unselected
        .filter((poi) => !(poi.verified === true && Boolean(poi.location)))
        .map((poi) =>
          FilteredItemSchema.parse({
            id: poi.id ?? poi.amapId ?? poi.name,
            name: poi.name,
            sourceNoteId: poi.sourceNoteId,
            stage: "plan",
            reason: "用户未选入排程"
          })
        )
    ];
  }
  const plan = await runPlan(selectedGrounded, filtered, input, llm, map);
  plan.pool = poolPois.map((poi) => {
    const item = planItemFromPoi(poi, "morning", poi.id ?? poi.amapId ?? poi.name);
    delete item.slot;
    delete item.transportToNext;
    return item;
  });
  await writeJson(path.join(workDir, outputFiles.plan), TripPlanSchema.parse(plan));
}

async function readJson(file: string) {
  return JSON.parse(await readFile(file, "utf8")) as unknown;
}

async function writeJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function emit(onEvent: ((e: StageEvent) => void) | undefined, stage: StageName, status: StageEvent["status"], detail?: string) {
  onEvent?.({ stage, status, detail, at: new Date().toISOString() });
}

function summarizeInput(input: TripInput) {
  return { id: input.id, links: input.links.length, destination: input.destination, days: input.days };
}

async function exists(file: string) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function existsSyncish(file: string) {
  return existsSync(file);
}
