import { readFile } from "node:fs/promises";
import path from "node:path";
import { createDefaultPipelineDeps, runPipeline } from "../lib/pipeline/run";
import { StageNameSchema, TripInputSchema } from "../lib/pipeline/types";

async function main() {
  const [tripId, stageArg, ...flags] = process.argv.slice(2);
  if (!tripId || !stageArg) {
    throw new Error("Usage: npm run stage -- <tripId> <stage> [--force]");
  }
  const stage = StageNameSchema.parse(stageArg);
  const dataRoot = process.env.PACKUP_DATA_DIR ?? path.join(process.cwd(), "data/trips");
  const workDir = path.join(dataRoot, tripId);
  const input = TripInputSchema.parse(JSON.parse(await readFile(path.join(workDir, "00-input.json"), "utf8")));
  const deps = process.env.PACKUP_STAGE_MOCK === "1" ? mockDeps() : createDefaultPipelineDeps(workDir, input);
  await runPipeline(input, deps, {
    fromStage: stage,
    force: flags.includes("--force"),
    onEvent: (event) => console.log(JSON.stringify(event))
  });
}

function mockDeps() {
  return {
    fetcher: { fetch: async () => [] },
    llm: {
      run: async () =>
        JSON.stringify({
          days: [
            {
              index: 1,
              items: [
                {
                  name: "外滩",
                  type: "sight",
                  startTime: "09:00",
                  durationMin: 60,
                  address: "中山东一路",
                  verified: true,
                  location: { lng: 121.49, lat: 31.24 },
                  reason: "mock stage rerun"
                }
              ]
            }
          ],
          filtered: [],
          warnings: []
        })
    },
    map: { searchPoi: async () => null, route: async () => ({ durationMin: 5, distanceKm: 1 }) }
  };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
