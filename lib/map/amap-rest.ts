import { haversineKm } from "@/lib/pipeline/geo";
import type { AmapPoi, LngLat, MapProvider, TransportMode } from "./types";

type FetchJson = (url: string) => Promise<unknown>;

export class MapKeyMissingError extends Error {
  constructor() {
    super("AMAP_REST_KEY is required");
    this.name = "MapKeyMissingError";
  }
}

const QPS_INFOCODE = "10021"; // CUQPS_HAS_EXCEEDED_THE_LIMIT
const MAX_CONCURRENCY = 2; // 个人 key 免费额度 QPS 低,留余量
const MAX_QPS_RETRIES = 4;

export class AmapRestProvider implements MapProvider {
  private readonly key: string;
  private readonly fetchJson: FetchJson;
  private readonly sleep: (ms: number) => Promise<void>;
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(opts: { env?: Record<string, string | undefined>; fetchJson?: FetchJson; sleep?: (ms: number) => Promise<void> } = {}) {
    const env = opts.env ?? process.env;
    const key = env.AMAP_REST_KEY;
    if (!key) throw new MapKeyMissingError();
    this.key = key;
    this.fetchJson = opts.fetchJson ?? defaultFetchJson;
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
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
      openHours: businessField(detail, ["opentime_today", "open_time", "opentime2", "business_hours"]),
      rating: businessField(detail, ["rating", "score"]),
      typecode: string(first.typecode) || string(detail.typecode) || undefined
    };
  }

  async searchPois(keyword: string, city: string, limit = 8): Promise<AmapPoi[]> {
    const offset = String(Math.min(10, Math.max(1, Math.floor(limit))));
    const url = this.url("/v3/place/text", {
      keywords: keyword,
      city,
      citylimit: "true",
      offset,
      extensions: "all"
    });
    const search = await this.call(url);
    assertAmapOk(search);
    return array(search.pois).map((poi) => poiFromRecord(poi as Record<string, unknown>, keyword));
  }

  async route(from: LngLat, to: LngLat, mode: TransportMode): Promise<{ durationMin: number; distanceKm: number; polyline?: LngLat[] }> {
    if (mode === "bike") return this.bikeRoute(from, to);

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
    const path = (mode === "public" ? array(route?.transits)[0] : array(route?.paths)[0]) as Record<string, unknown> | undefined;
    // 高德对极近距离/无公交方案的点对会返回空 path/transits(香港同街相邻 POI 常见)。
    // 此时降级为直线距离 + 步行速度估算,而非炸掉整个排程。
    if (!path) return estimateWalk(from, to);
    const distanceKm = number(path.distance) / 1000;
    const durationMin = Math.round(number(path.duration) / 60);
    if (distanceKm === 0 && durationMin === 0) return estimateWalk(from, to);
    const polyline = mode === "public" ? transitPolyline(path) : pathPolyline(path);
    return polyline.length > 0 ? { durationMin, distanceKm, polyline } : { durationMin, distanceKm };
  }

  private async bikeRoute(from: LngLat, to: LngLat) {
    const response = await this.call(
      this.url("/v4/direction/bicycling", {
        origin: formatLngLat(from),
        destination: formatLngLat(to)
      })
    );
    if (numberOrUndefined(response.errcode) !== 0) return estimateBike(from, to);
    const data = response.data as Record<string, unknown> | undefined;
    const path = array(data?.paths)[0] as Record<string, unknown> | undefined;
    if (!path) return estimateBike(from, to);
    const distanceKm = number(path.distance) / 1000;
    const durationMin = Math.round(number(path.duration) / 60);
    if (distanceKm === 0 && durationMin === 0) return estimateBike(from, to);
    const polyline = pathPolyline(path);
    return polyline.length > 0 ? { durationMin, distanceKm, polyline } : { durationMin, distanceKm };
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
      // QPS 超限(个人 key 高频撞限)时指数退避重试,而非炸整段管线
      for (let attempt = 0; ; attempt++) {
        const response = (await this.fetchJson(url)) as Record<string, unknown>;
        if (string(response.infocode) === QPS_INFOCODE && attempt < MAX_QPS_RETRIES) {
          await this.sleep(200 * 2 ** attempt);
          continue;
        }
        return response;
      }
    } finally {
      this.release();
    }
  }

  private async acquire() {
    if (this.active < MAX_CONCURRENCY) {
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

// route 空结果降级:直线距离 ×1.3 路面折算,步行 ~5km/h(min 5 分钟)
function estimateWalk(from: LngLat, to: LngLat) {
  const distanceKm = haversineKm(from, to) * 1.3;
  const durationMin = Math.max(5, Math.round((distanceKm / 5) * 60));
  return { durationMin, distanceKm };
}

function estimateBike(from: LngLat, to: LngLat) {
  const distanceKm = haversineKm(from, to) * 1.3;
  const durationMin = Math.max(3, Math.round((distanceKm / 12) * 60));
  return { durationMin, distanceKm };
}

function poiFromRecord(poi: Record<string, unknown>, fallbackName: string): AmapPoi {
  return {
    amapId: string(poi.id) || fallbackName,
    name: string(poi.name) || fallbackName,
    location: parseLocation(string(poi.location)),
    address: string(poi.address) || undefined,
    cityName: string(poi.cityname) || string(poi.cityName) || undefined,
    openHours: businessField(poi, ["opentime_today", "open_time", "opentime2", "business_hours"]),
    rating: businessField(poi, ["rating", "score"]),
    typecode: string(poi.typecode) || undefined
  };
}

function pathPolyline(path: Record<string, unknown>): LngLat[] {
  return normalizePolyline(array(path.steps).flatMap((step) => parsePolylineString(string((step as Record<string, unknown>).polyline))));
}

function transitPolyline(transit: Record<string, unknown>): LngLat[] {
  const points: LngLat[] = [];
  for (const rawSegment of array(transit.segments)) {
    const segment = rawSegment as Record<string, unknown>;
    const walking = segment.walking as Record<string, unknown> | undefined;
    for (const rawStep of array(walking?.steps)) {
      points.push(...parsePolylineString(string((rawStep as Record<string, unknown>).polyline)));
    }
    const bus = segment.bus as Record<string, unknown> | undefined;
    const busline = array(bus?.buslines)[0] as Record<string, unknown> | undefined;
    points.push(...parsePolylineString(string(busline?.polyline)));
  }
  return normalizePolyline(points);
}

function parsePolylineString(value: string): LngLat[] {
  if (!value) return [];
  return value
    .split(";")
    .map((pair) => {
      const [lng, lat] = pair.split(",").map(Number);
      return Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : undefined;
    })
    .filter((point): point is LngLat => Boolean(point));
}

function normalizePolyline(points: LngLat[]): LngLat[] {
  const deduped: LngLat[] = [];
  for (const point of points) {
    const previous = deduped.at(-1);
    if (!previous || previous.lng !== point.lng || previous.lat !== point.lat) deduped.push(point);
  }
  if (deduped.length <= 500) return deduped;

  const thinned: LngLat[] = [];
  const last = deduped.length - 1;
  for (let i = 0; i < 500; i++) {
    thinned.push(deduped[Math.round((i * last) / 499)]);
  }
  return thinned;
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

function numberOrUndefined(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseLocation(value: string): LngLat {
  const [lng, lat] = value.split(",").map(Number);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) throw new Error("Amap POI location missing");
  return { lng, lat };
}

function businessField(poi: Record<string, unknown>, keys: string[]) {
  // v5 放 business,v3 放 biz_ext,兜底读顶层
  const containers = [poi.business, poi.biz_ext, poi].filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object"));
  for (const container of containers) {
    for (const key of keys) {
      const value = string(container[key]);
      if (value) return value;
    }
  }
  return undefined;
}

function formatLngLat(value: LngLat) {
  return `${value.lng},${value.lat}`;
}
