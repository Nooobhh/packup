import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { parseQuery } from "@/lib/pipeline/parse-query";
import { createDefaultPipelineDeps, runPipeline } from "@/lib/pipeline/run";
import { TripInputSchema, type StageEvent, type TripInput } from "@/lib/pipeline/types";

type PipelineFn = typeof runPipeline;
type GenerateMode = "plan" | "pool";

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const body = raw as { id?: string; query?: string; destination?: string; links?: string[]; mode?: GenerateMode };
  if (!Array.isArray(body.links) || body.links.length === 0) {
    return Response.json({ error: "至少提供一条链接" }, { status: 400 });
  }
  const mode: GenerateMode = body.mode === "pool" ? "pool" : "plan";
  let candidate: Record<string, unknown> = { ...(raw as object), id: body.id ?? nanoid(10) };
  delete (candidate as { mode?: unknown }).mode;
  if (body.query && !body.destination) {
    try {
      const parsedQuery = await parseQuery(body.query);
      candidate = {
        ...candidate,
        query: body.query,
        destination: parsedQuery.destination,
        days: parsedQuery.days ? { base: parsedQuery.days } : undefined,
        preferences: parsedQuery.preferences
      };
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
    }
  }

  const parsed = TripInputSchema.safeParse(candidate);
  if (!parsed.success) {
    return Response.json({ error: "Invalid TripInput", issues: parsed.error.issues }, { status: 400 });
  }

  const input = parsed.data;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      try {
        send({ type: "init", tripId: input.id });
        const pipelineOverride = (globalThis as typeof globalThis & { __packupGeneratePipelineForTest?: PipelineFn }).__packupGeneratePipelineForTest;
        const pipeline = pipelineOverride ?? runPipeline;
        const deps = pipelineOverride ? testDeps() : createDefaultPipelineDeps(undefined, input);
        if (mode === "pool") {
          // 只拆地点入池:跑到 ground 后写空 selection(全部落池)→ 继续跑 plan → 用户直接进画布
          const groundResult = await pipeline(input, deps, {
            onEvent: (event: StageEvent) => send(event),
            toStage: "ground"
          });
          await writeSelection(groundResult.tripId, []);
          const planResult = await pipeline(input, deps, {
            onEvent: (event: StageEvent) => send(event),
            fromStage: "plan"
          });
          send({ stage: "plan", status: "pool-ready", tripId: planResult.tripId });
        } else {
          const result = await pipeline(input, deps, {
            onEvent: (event: StageEvent) => send(event),
            toStage: "ground"
          });
          send({ stage: "ground", status: "await-selection", tripId: result.tripId });
        }
      } catch (error) {
        send({ stage: "error", status: "error", detail: error instanceof Error ? error.message : String(error), at: new Date().toISOString() });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive"
    }
  });
}

function testDeps() {
  return {
    fetcher: { fetch: async () => [] },
    map: { searchPoi: async () => null, searchPois: async () => [], route: async () => ({ durationMin: 0, distanceKm: 0 }) }
  };
}

/** mode=pool 时,主动写空 selection.json,让 plan 阶段把所有 grounded 落池 */
async function writeSelection(tripId: string, selectedPoiIds: string[]) {
  const dir = path.join(process.env.PACKUP_DATA_DIR ?? path.join(process.cwd(), "data/trips"), tripId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "25-selection.json"), `${JSON.stringify({ selectedPoiIds }, null, 2)}\n`, "utf8");
}
