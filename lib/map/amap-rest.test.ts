import { describe, expect, it, vi } from "vitest";
import { AmapRestProvider, MapKeyMissingError } from "./amap-rest";
import type { MapProvider } from "./types";

describe("AmapRestProvider", () => {
  it("implements MapProvider and throws when key is missing", () => {
    expect(() => new AmapRestProvider({ env: {} })).toThrow(MapKeyMissingError);
    const provider: MapProvider = new AmapRestProvider({ env: { AMAP_REST_KEY: "k" }, fetchJson: vi.fn() });
    expect(provider).toBeInstanceOf(AmapRestProvider);
  });

  it("searchPoi returns the first hit with details fields", async () => {
    const fetchJson = vi
      .fn()
      .mockResolvedValueOnce({
        status: "1",
        pois: [{ id: "p1", name: "外滩", location: "121.4903,31.2417", address: "中山东一路", cityname: "上海市" }]
      })
      .mockResolvedValueOnce({ status: "1", pois: [{ business: { opentime_today: "全天", rating: "4.8" } }] });

    const poi = await new AmapRestProvider({ env: { AMAP_REST_KEY: "k" }, fetchJson }).searchPoi("外滩", "上海");

    expect(fetchJson.mock.calls[0][0]).toContain("/place/text");
    expect(fetchJson.mock.calls[0][0]).toContain("keywords=%E5%A4%96%E6%BB%A9");
    expect(fetchJson.mock.calls[0][0]).toContain("citylimit=true");
    expect(poi).toEqual({
      amapId: "p1",
      name: "外滩",
      location: { lng: 121.4903, lat: 31.2417 },
      address: "中山东一路",
      cityName: "上海市",
      openHours: "全天",
      rating: "4.8"
    });
  });

  it("searchPoi returns null on no results and throws Amap error code on HTTP/API failure", async () => {
    await expect(
      new AmapRestProvider({ env: { AMAP_REST_KEY: "k" }, fetchJson: vi.fn().mockResolvedValue({ status: "1", pois: [] }) }).searchPoi(
        "不存在",
        "上海"
      )
    ).resolves.toBeNull();

    await expect(
      new AmapRestProvider({
        env: { AMAP_REST_KEY: "k" },
        fetchJson: vi.fn().mockResolvedValue({ status: "0", infocode: "10001", info: "INVALID_USER_KEY" })
      }).searchPoi("外滩", "上海")
    ).rejects.toThrow("10001");
  });

  it("routes public, drive, and walk modes with mapped endpoints and parsed duration/distance", async () => {
    const fetchJson = vi.fn().mockResolvedValue({ status: "1", route: { paths: [{ duration: "600", distance: "3200" }] } });
    const provider = new AmapRestProvider({ env: { AMAP_REST_KEY: "k" }, fetchJson });

    await expect(provider.route({ lng: 1, lat: 2 }, { lng: 3, lat: 4 }, "drive")).resolves.toEqual({ durationMin: 10, distanceKm: 3.2 });
    await provider.route({ lng: 1, lat: 2 }, { lng: 3, lat: 4 }, "walk");
    await provider.route({ lng: 1, lat: 2 }, { lng: 3, lat: 4 }, "public");

    expect(fetchJson.mock.calls[0][0]).toContain("/direction/driving");
    expect(fetchJson.mock.calls[1][0]).toContain("/direction/walking");
    expect(fetchJson.mock.calls[2][0]).toContain("/direction/transit/integrated");
  });

  it("falls back to straight-line walk estimate when route returns empty path", async () => {
    // 高德对极近距离/无公交方案返回空 transits,应降级估算而非抛错
    const fetchJson = vi.fn().mockResolvedValue({ status: "1", route: { transits: [] } });
    const provider = new AmapRestProvider({ env: { AMAP_REST_KEY: "k" }, fetchJson });

    const result = await provider.route({ lng: 114.175, lat: 22.315 }, { lng: 114.173, lat: 22.307 }, "public");
    expect(result.distanceKm).toBeGreaterThan(0);
    expect(result.durationMin).toBeGreaterThanOrEqual(5);
  });

  it("retries with backoff on QPS-exceeded infocode then succeeds", async () => {
    const fetchJson = vi
      .fn()
      .mockResolvedValueOnce({ status: "0", infocode: "10021", info: "CUQPS_HAS_EXCEEDED_THE_LIMIT" })
      .mockResolvedValueOnce({ status: "1", route: { paths: [{ duration: "600", distance: "3200" }] } });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const provider = new AmapRestProvider({ env: { AMAP_REST_KEY: "k" }, fetchJson, sleep });

    await expect(provider.route({ lng: 1, lat: 2 }, { lng: 3, lat: 4 }, "drive")).resolves.toEqual({ durationMin: 10, distanceKm: 3.2 });
    expect(fetchJson).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("limits concurrent HTTP calls to three", async () => {
    let active = 0;
    let maxActive = 0;
    const fetchJson = vi.fn(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return { status: "1", pois: [] };
    });
    const provider = new AmapRestProvider({ env: { AMAP_REST_KEY: "k" }, fetchJson });

    await Promise.all(Array.from({ length: 8 }, (_, index) => provider.searchPoi(`p${index}`, "上海")));

    expect(maxActive).toBeLessThanOrEqual(3);
  });
});
