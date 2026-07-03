import type { MapProvider } from "@/lib/map/types";
import { BUDGETS } from "./budgets";
import type { CandidatePoi, FilteredItem, GroundedPoi, TripInput } from "./types";
import { FilteredItemSchema, GroundedPoiSchema } from "./types";

export async function runGround(
  pois: CandidatePoi[],
  input: TripInput,
  map: MapProvider
): Promise<{ grounded: GroundedPoi[]; filtered: FilteredItem[] }> {
  const grounded: GroundedPoi[] = [];
  const filtered: FilteredItem[] = [];
  const byAmapId = new Map<string, GroundedPoi>();
  const noteCounts = new Map<string, number>();
  const deadline = Date.now() + BUDGETS.groundStageMs;
  let expired = false;

  for (const poi of pois) {
    const noteIndex = (noteCounts.get(poi.sourceNoteId) ?? 0) + 1;
    noteCounts.set(poi.sourceNoteId, noteIndex);
    if (expired || Date.now() >= deadline) {
      expired = true;
      grounded.push(unverifiedPoi(poi, noteIndex));
      continue;
    }
    const hit = await withDeadline(searchWithRetry(poi, input.destination, map), deadline);
    if (hit === "deadline") {
      expired = true;
      grounded.push(unverifiedPoi(poi, noteIndex));
      continue;
    }
    if (!hit) {
      grounded.push(unverifiedPoi(poi, noteIndex));
      continue;
    }

    if (hit.cityName && !sameCity(hit.cityName, input.destination)) {
      filtered.push(
        FilteredItemSchema.parse({
          name: poi.name,
          sourceNoteId: poi.sourceNoteId,
          stage: "ground",
          reason: `高德返回实际城市为 ${hit.cityName},与目的地 ${input.destination} 不符`
        })
      );
      continue;
    }

    const candidate = GroundedPoiSchema.parse({
      ...poi,
      id: hit.amapId,
      verified: true,
      amapId: hit.amapId,
      name: hit.name || poi.name,
      location: hit.location,
      address: hit.address,
      openHours: hit.openHours,
      rating: hit.rating
    });

    const existing = byAmapId.get(candidate.amapId ?? "");
    if (existing) {
      existing.reason = mergeText(existing.reason, poi.reason);
      existing.sourceNoteId = mergeText(existing.sourceNoteId, poi.sourceNoteId);
      filtered.push(
        FilteredItemSchema.parse({
          name: poi.name,
          sourceNoteId: poi.sourceNoteId,
          stage: "ground",
          reason: `重复 POI 已合并到 ${existing.name}`
        })
      );
      continue;
    }

    if (candidate.amapId) byAmapId.set(candidate.amapId, candidate);
    grounded.push(candidate);
  }

  return { grounded, filtered };
}

function unverifiedPoi(poi: CandidatePoi, noteIndex: number) {
  return GroundedPoiSchema.parse({ ...poi, id: `unverified-${poi.sourceNoteId}-${noteIndex}`, verified: false });
}

async function withDeadline<T>(promise: Promise<T>, deadline: number): Promise<T | "deadline"> {
  promise.catch(() => undefined);
  const remaining = deadline - Date.now();
  if (remaining <= 0) return "deadline";
  return Promise.race([promise, new Promise<"deadline">((resolve) => setTimeout(() => resolve("deadline"), remaining))]);
}

async function searchWithRetry(poi: CandidatePoi, city: string, map: MapProvider) {
  const first = await map.searchPoi(poi.name, city);
  if (first) return first;
  const simplified = simplifyName(poi.name);
  if (simplified && simplified !== poi.name) {
    return map.searchPoi(simplified, city);
  }
  return null;
}

function simplifyName(name: string) {
  return name
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/(旗舰店|总店|分店|门店|上海店|店)$/g, "")
    .trim();
}

function sameCity(actual: string, destination: string) {
  return actual.includes(destination) || destination.includes(actual.replace(/市$/, ""));
}

function mergeText(a: string, b: string) {
  const parts = new Set(
    `${a}\n${b}`
      .split(/\n|,|，/)
      .map((part) => part.trim())
      .filter(Boolean)
  );
  return Array.from(parts).join(" / ");
}
