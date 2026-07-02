import { nanoid } from "nanoid";
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

  const parsed = TripInputSchema.safeParse({ ...(raw as object), id: (raw as { id?: string }).id ?? nanoid(10) });
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
