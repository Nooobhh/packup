import type { MapProvider } from "@/lib/map/types";
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

  for (const poi of pois) {
    const hit = await searchWithRetry(poi, input.destination, map);
    if (!hit) {
      grounded.push(GroundedPoiSchema.parse({ ...poi, verified: false }));
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
