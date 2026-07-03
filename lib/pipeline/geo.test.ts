import { describe, expect, it } from "vitest";
import { backtrackRatio, clusterByDistance, distanceMatrix, haversineKm, nearestNeighborEdges, nearestNeighborPathKm } from "./geo";

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

  it("clusters transitively connected nearby POIs under the default threshold", () => {
    const clusters = clusterByDistance([
      { id: "a", location: { lng: 0, lat: 0 } },
      { id: "b", location: { lng: 0, lat: 0.00135 } },
      { id: "c", location: { lng: 0, lat: 0.00315 } }
    ]);

    expect(clusters.get("a")).toBe("a");
    expect(clusters.get("b")).toBe("a");
    expect(clusters.get("c")).toBe("a");
  });

  it("keeps POIs farther than the threshold in separate clusters", () => {
    const clusters = clusterByDistance([
      { id: "a", location: { lng: 0, lat: 0 } },
      { id: "b", location: { lng: 0, lat: 0.003 } }
    ]);

    expect(clusters.get("a")).toBe("a");
    expect(clusters.get("b")).toBe("b");
  });

  it("keeps POIs without locations independent", () => {
    const clusters = clusterByDistance([
      { id: "a", location: { lng: 0, lat: 0 } },
      { id: "missing" },
      { id: "b", location: { lng: 0, lat: 0.001 } }
    ]);

    expect(clusters.get("a")).toBe("a");
    expect(clusters.get("b")).toBe("a");
    expect(clusters.get("missing")).toBe("missing");
  });

  it("returns an empty map for empty input", () => {
    expect(clusterByDistance([]).size).toBe(0);
  });
});
