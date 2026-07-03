import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createDefaultPipelineDeps, runPipeline } from "@/lib/pipeline/run";
import { SelectionSchema, TripInputSchema, type StageEvent, type TripInput } from "@/lib/pipeline/types";

type PipelineFn = typeof runPipeline;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const dir = tripDir(id);
  if (!(await exists(dir))) return Response.json({ error: "Trip not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const selection = SelectionSchema.safeParse(body);
  if (!selection.success) return Response.json({ error: "Invalid selection", issues: selection.error.issues }, { status: 400 });

  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "25-selection.json"), `${JSON.stringify(selection.data, null, 2)}\n`, "utf8");
  await rm(path.join(dir, "40-plan.json"), { force: true });
  await rm(path.join(dir, "plan.error.json"), { force: true });

  const input = await readInput(id, dir);
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      try {
        const pipelineOverride = (globalThis as typeof globalThis & { __packupGeneratePipelineForTest?: PipelineFn }).__packupGeneratePipelineForTest;
        const pipeline = pipelineOverride ?? runPipeline;
        const deps = pipelineOverride ? testDeps() : createDefaultPipelineDeps(dir, input);
        const result = await pipeline(input, deps, {
          fromStage: "plan",
          force: false,
          onEvent: (event: StageEvent) => send(event)
        });
        send({ stage: "done", tripId: result.tripId });
      } catch (error) {
        send({ stage: "error", status: "error", detail: error instanceof Error ? error.message : String(error), at: new Date().toISOString() });
      } finally {
        controller.close();
      }
    }
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8" } });
}

async function readInput(id: string, dir: string): Promise<TripInput> {
  const raw = await readJson(path.join(dir, "00-input.json")).catch(() => ({ id, links: ["selection"], destination: "未知" }));
  return TripInputSchema.parse({ ...(raw as object), id });
}

function testDeps() {
  return {
    fetcher: { fetch: async () => [] },
    llm: { run: async () => "" },
    map: { searchPoi: async () => null, route: async () => ({ durationMin: 0, distanceKm: 0 }) }
  };
}

function tripDir(id: string) {
  return path.join(process.env.PACKUP_DATA_DIR ?? path.join(process.cwd(), "data/trips"), id);
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
