import { nanoid } from "nanoid";
import { ClaudeCliRunner } from "@/lib/llm/claude-cli";
import { parseQuery } from "@/lib/pipeline/parse-query";
import { createDefaultPipelineDeps, runPipeline } from "@/lib/pipeline/run";
import { TripInputSchema, type StageEvent, type TripInput } from "@/lib/pipeline/types";

type PipelineFn = typeof runPipeline;

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const body = raw as { id?: string; query?: string; destination?: string; links?: string[] };
  let candidate: Record<string, unknown> = { ...(raw as object), id: body.id ?? nanoid(10) };
  if (body.query && !body.destination) {
    try {
      const testMode = Boolean((globalThis as typeof globalThis & { __packupGeneratePipelineForTest?: PipelineFn }).__packupGeneratePipelineForTest) || Boolean(process.env.VITEST);
      const parsedQuery = await parseQuery(body.query, testMode ? testDeps().llm : new ClaudeCliRunner());
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
        const pipelineOverride = (globalThis as typeof globalThis & { __packupGeneratePipelineForTest?: PipelineFn }).__packupGeneratePipelineForTest;
        const pipeline = pipelineOverride ?? runPipeline;
        const deps = pipelineOverride ? testDeps() : createDefaultPipelineDeps(undefined, input);
        const result = await pipeline(input, deps, {
          onEvent: (event: StageEvent) => send(event),
          toStage: "ground"
        });
        send({ stage: "ground", status: "await-selection", tripId: result.tripId });
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
    llm: { run: async () => "" },
    map: { searchPoi: async () => null, route: async () => ({ durationMin: 0, distanceKm: 0 }) }
  };
}
