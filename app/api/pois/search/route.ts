import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { AmapRestProvider } from "@/lib/map/amap-rest";
import type { MapProvider } from "@/lib/map/types";
import { TripInputSchema } from "@/lib/pipeline/types";

type PoiSearchMap = { searchPois: NonNullable<MapProvider["searchPois"]> };

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tripId = url.searchParams.get("tripId")?.trim();
  const q = url.searchParams.get("q")?.trim();
  if (!tripId || !q) return Response.json({ error: "tripId and q are required" }, { status: 400 });

  const dir = path.join(process.env.PACKUP_DATA_DIR ?? path.join(process.cwd(), "data/trips"), tripId);
  const inputFile = path.join(dir, "00-input.json");
  if (!(await exists(inputFile))) return Response.json({ error: "Trip not found" }, { status: 404 });

  const input = TripInputSchema.parse(JSON.parse(await readFile(inputFile, "utf8")));
  const map = getMap();
  const results = await map.searchPois(q, input.destination, 8);
  return Response.json(results.slice(0, 8));
}

function getMap(): PoiSearchMap {
  return ((globalThis as typeof globalThis & { __packupPoiSearchMapForTest?: PoiSearchMap }).__packupPoiSearchMapForTest ??
    new AmapRestProvider()) as PoiSearchMap;
}

async function exists(file: string) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
