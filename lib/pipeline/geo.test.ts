import { describe, expect, it } from "vitest";
import { backtrackRatio, distanceMatrix, haversineKm, nearestNeighborEdges, nearestNeighborPathKm } from "./geo";

describe("geo utilities", () => {
  it("computes haversine distance within 1% for New York to London", () => {
    const nyc = { lng: -74.006, lat: 40.7128 };
    const london = { lng: -0.1276, lat: 51.5072 };
    expect(haversineKm(nyc, london)).toBeGreaterThan(5510);
    expect(haversineKm(nyc, london)).toBeLessThan(5625);
  });

  it("builds a structured pairwise distance matrix", () => {
    const matrix = distanceMatrix([
      { id: "a", location: { lng: 0, lat: 0 } },
      { id: "b", location: { lng: 1, lat: 0 } }
    ]);
    expect(matrix).toHaveLength(1);
    expect(matrix[0]).toMatchObject({ from: "a", to: "b" });
    expect(matrix[0].distanceKm).toBeGreaterThan(100);
  });

  it("returns deduped nearest-neighbor edges sorted by distance", () => {
    const edges = nearestNeighborEdges(
      [
        { id: "a", location: { lng: 0, lat: 0 } },
        { id: "b", location: { lng: 0.01, lat: 0 } },
        { id: "c", location: { lng: 1, lat: 0 } }
      ],
      2
    );
    const keys = edges.map((edge) => [edge.from, edge.to].sort().join("-"));
    expect(new Set(keys).size).toBe(keys.length);
    expect(edges[0]).toMatchObject({ from: "a", to: "b" });
    expect(edges.map((edge) => edge.distanceKm)).toEqual([...edges.map((edge) => edge.distanceKm)].sort((a, b) => a - b));
  });

  it("detects a backtracking order while reasonable order is about one", () => {
    const reasonable = [
      { lng: 0, lat: 0 },
      { lng: 1, lat: 0 },
      { lng: 2, lat: 0 },
      { lng: 3, lat: 0 }
    ];
    const backtracking = [reasonable[0], reasonable[3], reasonable[1], reasonable[2]];
    expect(backtrackRatio(reasonable)).toBeCloseTo(1, 1);
    expect(backtrackRatio(backtracking)).toBeGreaterThan(1.5);
  });

  it("handles empty, single, and double point boundaries", () => {
    expect(distanceMatrix([])).toEqual([]);
    expect(nearestNeighborEdges([{ id: "a", location: { lng: 0, lat: 0 } }], 2)).toEqual([]);
    expect(nearestNeighborPathKm([])).toBe(0);
    expect(backtrackRatio([])).toBe(1);
    expect(backtrackRatio([{ lng: 0, lat: 0 }, { lng: 1, lat: 1 }])).toBe(1);
  });
});
