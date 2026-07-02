import type { AmapPoi, LngLat, MapProvider, TransportMode } from "./types";

type FetchJson = (url: string) => Promise<unknown>;

export class MapKeyMissingError extends Error {
  constructor() {
    super("AMAP_REST_KEY is required");
    this.name = "MapKeyMissingError";
  }
}

export class AmapRestProvider implements MapProvider {
  private readonly key: string;
  private readonly fetchJson: FetchJson;
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(opts: { env?: Record<string, string | undefined>; fetchJson?: FetchJson } = {}) {
    const env = opts.env ?? process.env;
    const key = env.AMAP_REST_KEY;
    if (!key) throw new MapKeyMissingError();
    this.key = key;
    this.fetchJson = opts.fetchJson ?? defaultFetchJson;
  }

  async searchPoi(name: string, city: string): Promise<AmapPoi | null> {
    const url = this.url("/v3/place/text", {
      keywords: name,
      city,
      citylimit: "true",
      offset: "1",
      extensions: "all"
    });
    const search = await this.call(url);
    assertAmapOk(search);
    const first = array(search.pois)[0] as Record<string, unknown> | undefined;
    if (!first) return null;

    let detail = first;
    const id = string(first.id);
    if (id) {
      const detailResponse = await this.call(this.url("/v3/place/detail", { id, extensions: "all" })).catch(() => undefined);
      if (detailResponse) {
        assertAmapOk(detailResponse);
        detail = (array(detailResponse.pois)[0] as Record<string, unknown> | undefined) ?? first;
      }
    }

    const location = parseLocation(string(first.location) || string(detail.location));
    return {
      amapId: id || name,
      name: string(first.name) || name,
      location,
      address: string(first.address) || undefined,
      cityName: string(first.cityname) || string(first.cityName) || undefined,
      openHours: businessField(detail, ["opentime_today", "open_time", "business_hours"]),
      rating: businessField(detail, ["rating", "score"])
    };
  }

  async route(from: LngLat, to: LngLat, mode: TransportMode): Promise<{ durationMin: number; distanceKm: number }> {
    const endpoint =
      mode === "drive" ? "/v3/direction/driving" : mode === "walk" ? "/v3/direction/walking" : "/v3/direction/transit/integrated";
    const response = await this.call(
      this.url(endpoint, {
        origin: formatLngLat(from),
        destination: formatLngLat(to),
        strategy: mode === "public" ? "0" : undefined
      })
    );
    assertAmapOk(response);
    const route = response.route as Record<string, unknown> | undefined;
    const path = (array(route?.paths)[0] ?? array(route?.transits)[0]) as Record<string, unknown> | undefined;
    if (!path) throw new Error("Amap route response missing path");
    return {
      durationMin: Math.round(number(path.duration) / 60),
      distanceKm: number(path.distance) / 1000
    };
  }

  private url(endpoint: string, params: Record<string, string | undefined>) {
    const query = new URLSearchParams({ key: this.key });
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) query.set(key, value);
    }
    return `https://restapi.amap.com${endpoint}?${query.toString()}`;
  }

  private async call(url: string) {
    await this.acquire();
    try {
      return (await this.fetchJson(url)) as Record<string, unknown>;
    } finally {
      this.release();
    }
  }

  private async acquire() {
    if (this.active < 3) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
  }

  private release() {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

async function defaultFetchJson(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Amap HTTP ${response.status}`);
  return response.json();
}

function assertAmapOk(response: Record<string, unknown>) {
  if (response.status !== "1") {
    throw new Error(`Amap error ${string(response.infocode) || "unknown"} ${string(response.info) || ""}`.trim());
  }
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function string(value: unknown) {
  return typeof value === "string" ? value : "";
}

function number(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error("Amap numeric field missing");
  return parsed;
}

function parseLocation(value: string): LngLat {
  const [lng, lat] = value.split(",").map(Number);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) throw new Error("Amap POI location missing");
  return { lng, lat };
}

function businessField(poi: Record<string, unknown>, keys: string[]) {
  const business = poi.business && typeof poi.business === "object" ? (poi.business as Record<string, unknown>) : poi;
  for (const key of keys) {
    const value = string(business[key]);
    if (value) return value;
  }
  return undefined;
}

function formatLngLat(value: LngLat) {
  return `${value.lng},${value.lat}`;
}
