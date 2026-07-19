import type { LngLat, TransportMode } from "@/lib/pipeline/types";

export type AmapPoi = {
  amapId: string;
  name: string;
  location: LngLat;
  address?: string;
  cityName?: string;
  openHours?: string;
  rating?: string;
  /** 高德分类编码(6 位,前 2 位为大类);经 poiTypeFromAmap 映射成我们的 6 类 */
  typecode?: string;
};

export interface MapProvider {
  searchPoi(name: string, city: string): Promise<AmapPoi | null>;
  searchPois?(keyword: string, city: string, limit?: number): Promise<AmapPoi[]>;
  route(from: LngLat, to: LngLat, mode: TransportMode): Promise<{ durationMin: number; distanceKm: number; polyline?: LngLat[] }>;
}

export type { LngLat, TransportMode };
