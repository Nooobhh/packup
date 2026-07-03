import type { LngLat } from "./types";

export type Edge = { from: string; to: string; distanceKm: number };

export function haversineKm(a: LngLat, b: LngLat): number {
  const earthKm = 6371.0088;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const lat1 = radians(a.lat);
  const lat2 = radians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return earthKm * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function distanceMatrix(pois: { id: string; location: LngLat }[]) {
  const edges: Edge[] = [];
  for (let i = 0; i < pois.length; i++) {
    for (let j = i + 1; j < pois.length; j++) {
      edges.push({ from: pois[i].id, to: pois[j].id, distanceKm: haversineKm(pois[i].location, pois[j].location) });
    }
  }
  return edges;
}

export function nearestNeighborEdges(pois: { id: string; location: LngLat }[], k: number): Edge[] {
  if (pois.length < 2 || k <= 0) return [];
  const byPair = new Map<string, Edge>();
  for (const poi of pois) {
    const nearest = pois
      .filter((candidate) => candidate.id !== poi.id)
      .map((candidate) => ({ from: poi.id, to: candidate.id, distanceKm: haversineKm(poi.location, candidate.location) }))
      .sort((a, b) => a.distanceKm - b.distanceKm)
      .slice(0, k);
    for (const edge of nearest) {
      const key = [edge.from, edge.to].sort().join("::");
      if (!byPair.has(key)) byPair.set(key, edge);
    }
  }
  return Array.from(byPair.values()).sort((a, b) => a.distanceKm - b.distanceKm);
}

export function nearestNeighborPathKm(points: LngLat[]): number {
  if (points.length < 2) return 0;
  const remaining = points.slice(1);
  let current = points[0];
  let total = 0;
  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const distance = haversineKm(current, remaining[i]);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    total += bestDistance;
    current = remaining.splice(bestIndex, 1)[0];
  }
  return total;
}

export function clusterByDistance<T extends { id: string; location?: LngLat }>(pois: T[], thresholdKm = 0.25): Map<string, string> {
  const parent = new Map<string, string>();
  const inputIndex = new Map<string, number>();
  for (const [index, poi] of pois.entries()) {
    parent.set(poi.id, poi.id);
    inputIndex.set(poi.id, index);
  }

  const located = pois.filter((poi): poi is T & { location: LngLat } => Boolean(poi.location));
  for (let i = 0; i < located.length; i++) {
    for (let j = i + 1; j < located.length; j++) {
      if (haversineKm(located[i].location, located[j].location) <= thresholdKm) {
        union(located[i].id, located[j].id);
      }
    }
  }

  const groups = new Map<string, string[]>();
  for (const poi of pois) {
    const root = find(poi.id);
    groups.set(root, [...(groups.get(root) ?? []), poi.id]);
  }

  const clusterKeys = new Map<string, string>();
  for (const ids of groups.values()) {
    const clusterKey = ids.reduce((first, id) => (inputIndex.get(id)! < inputIndex.get(first)! ? id : first), ids[0]);
    for (const id of ids) clusterKeys.set(id, clusterKey);
  }
  return clusterKeys;

  function find(id: string): string {
    const current = parent.get(id) ?? id;
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  }

  function union(a: string, b: string) {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA === rootB) return;
    const keep = inputIndex.get(rootA)! <= inputIndex.get(rootB)! ? rootA : rootB;
    const move = keep === rootA ? rootB : rootA;
    parent.set(move, keep);
  }
}

export function backtrackRatio(orderedPoints: LngLat[]): number {
  if (orderedPoints.length < 3) return 1;
  const orderedDistance = pathDistance(orderedPoints);
  const nearest = nearestNeighborPathKm(orderedPoints);
  if (nearest === 0) return 1;
  return orderedDistance / nearest;
}

function pathDistance(points: LngLat[]) {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    total += haversineKm(points[i], points[i + 1]);
  }
  return total;
}

function radians(degrees: number) {
  return (degrees * Math.PI) / 180;
}
