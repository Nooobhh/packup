import type { LngLat, TransportMode } from "@/lib/pipeline/types";

export type AmapPoi = {
  amapId: string;
  name: string;
  location: LngLat;
  address?: string;
  cityName?: string;
  openHours?: string;
  rating?: string;
};

export interface MapProvider {
  searchPoi(name: string, city: string): Promise<AmapPoi | null>;
  route(from: LngLat, to: LngLat, mode: TransportMode): Promise<{ durationMin: number; distanceKm: number; polyline?: LngLat[] }>;
}

export type { LngLat, TransportMode };
