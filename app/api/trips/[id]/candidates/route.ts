import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { ExtractOutputSchema, GroundOutputSchema } from "@/lib/pipeline/types";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const dir = tripDir(id);
  if (!(await exists(dir))) return Response.json({ error: "Trip not found" }, { status: 404 });

  const groundPath = path.join(dir, "30-grounded.json");
  if (!(await exists(groundPath))) return Response.json({ error: "Grounded candidates not ready" }, { status: 409 });

  const ground = GroundOutputSchema.parse(await readJson(groundPath));
  const extract = ExtractOutputSchema.partial().parse(await readJson(path.join(dir, "20-pois.json")).catch(() => ({})));
  return Response.json({ grounded: ground.grounded, filtered: [...(extract.filtered ?? []), ...ground.filtered] });
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
