import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TripForm } from "./trip-form";
import { DayTimeline } from "./day-timeline";
import { DayMap, renderDayMapOverlays } from "./day-map";
import { CandidateList } from "./candidate-list";
import { FailedLinksSection, FilteredSection } from "./filtered-section";

const originalAmapKey = process.env.NEXT_PUBLIC_AMAP_JS_KEY;

afterEach(() => {
  process.env.NEXT_PUBLIC_AMAP_JS_KEY = originalAmapKey;
  delete (globalThis as typeof globalThis & { AMap?: unknown }).AMap;
  document.head.querySelector("#amap-js-sdk")?.remove();
});

describe("TripForm", () => {
  it("renders only query and links inputs and submits that body shape", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({ ok: true, body: new ReadableStream({ start: (controller) => controller.close() }) }) as typeof fetch;
    render(<TripForm />);

    expect(screen.getByPlaceholderText("香港3天2晚 city walk+美食")).toBeInTheDocument();
    expect(screen.getByLabelText("小红书链接")).toBeInTheDocument();
    expect(screen.queryByText("目的地")).not.toBeInTheDocument();
    expect(screen.queryByText("transport")).not.toBeInTheDocument();
    expect(screen.queryByText("pace")).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("香港3天2晚 city walk+美食"), { target: { value: "香港3天 city walk" } });
    fireEvent.change(screen.getByLabelText("小红书链接"), { target: { value: "hello https://xhslink.com/a and https://example.com/no" } });
    expect(screen.getByText("识别到 1 条小红书链接")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "生成行程" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body)).toEqual({
      query: "香港3天 city walk",
      links: ["https://xhslink.com/a"]
    });
    global.fetch = originalFetch;
  });
});

describe("CandidateList", () => {
  it("checks verified POIs by default, leaves unverified unchecked, and disables scheduling with no selection", () => {
    render(
      <CandidateList
        tripId="trip-1"
        grounded={[
          { id: "v1", name: "外滩", type: "sight", reason: "好看", sourceNoteId: "n1", sourceType: "text", verified: true },
          { id: "u1", name: "小店", type: "food", reason: "笔记提到", sourceNoteId: "n1", sourceType: "text", verified: false }
        ]}
        filtered={[]}
      />
    );

    expect(screen.getByLabelText("外滩")).toBeChecked();
    expect(screen.getByLabelText("小店")).not.toBeChecked();
    fireEvent.click(screen.getByLabelText("外滩"));
    expect(screen.getByRole("button", { name: "排程" })).toBeDisabled();
  });
});

describe("DayTimeline", () => {
  it("groups slot items under morning afternoon evening headings", () => {
    render(
      <DayTimeline
        day={{
          index: 1,
          items: [
            { id: "a", name: "外滩", type: "sight", slot: "morning", durationMin: 60 },
            { id: "b", name: "午餐", type: "food", slot: "afternoon", durationMin: 60 },
            { id: "c", name: "夜景", type: "sight", slot: "evening", durationMin: 60 }
          ]
        }}
      />
    );

    expect(screen.getByText("上午")).toBeInTheDocument();
    expect(screen.getByText("下午")).toBeInTheDocument();
    expect(screen.getByText("晚上")).toBeInTheDocument();
  });

  it("renders legacy startTime data without slot grouping", () => {
    render(
      <DayTimeline
        day={{
          index: 1,
          items: [
            {
              name: "外滩",
              type: "sight",
              startTime: "09:00",
              durationMin: 60,
              address: "中山东一路",
              verified: false,
              reason: "笔记说清晨人少",
              note: "覆盖笔记建议",
              transportToNext: { mode: "public", durationMin: 15, distanceKm: 2 }
            }
          ]
        }}
      />
    );
    expect(screen.getByText("09:00")).toBeInTheDocument();
    expect(screen.getByText("中山东一路")).toBeInTheDocument();
    expect(screen.getByText("未知")).toBeInTheDocument();
    expect(screen.getByText("未验证")).toBeInTheDocument();
    expect(screen.getByText("覆盖笔记建议")).toBeInTheDocument();
    expect(screen.getByText(/15 min/)).toBeInTheDocument();
  });

  it("renders adjacent same-cluster members as one combined node", () => {
    render(
      <DayTimeline
        day={{
          index: 1,
          items: [
            { id: "a", name: "A", clusterKey: "cluster-a", slot: "morning", durationMin: 30, reason: "A reason" },
            { id: "b", name: "B", clusterKey: "cluster-a", slot: "morning", durationMin: 30, reason: "B reason" }
          ]
        }}
      />
    );

    expect(screen.getByText("A + B")).toBeInTheDocument();
    expect(screen.getByText(/A reason/)).toBeInTheDocument();
    expect(screen.getByText(/B reason/)).toBeInTheDocument();
  });
});

describe("conditional sections", () => {
  it("renders filtered and failed links only when non-empty", () => {
    const { rerender } = render(<FilteredSection filtered={[]} />);
    expect(screen.queryByText("过滤项")).not.toBeInTheDocument();
    rerender(<FilteredSection filtered={[{ name: "广告", stage: "extract", reason: "无关", sourceNoteId: "n1" }]} />);
    expect(screen.getByText("过滤项")).toBeInTheDocument();
    expect(screen.getByText("广告")).toBeInTheDocument();

    rerender(<FailedLinksSection failedLinks={[]} />);
    expect(screen.queryByText("失败链接")).not.toBeInTheDocument();
    rerender(<FailedLinksSection failedLinks={[{ url: "u1", reason: "失败" }]} />);
    expect(screen.getByText("失败链接")).toBeInTheDocument();
    expect(screen.getByText("u1")).toBeInTheDocument();
  });

  it("shows a map placeholder when the JS SDK key is missing", () => {
    delete process.env.NEXT_PUBLIC_AMAP_JS_KEY;
    render(<DayMap day={{ index: 1, items: [] }} />);
    expect(screen.getByText("地图 key 未配置")).toBeInTheDocument();
  });

  it("initializes AMap and renders markers/polyline for verified POIs", async () => {
    process.env.NEXT_PUBLIC_AMAP_JS_KEY = "test-key";
    const mapInstance = {
      clearMap: vi.fn(),
      setFitView: vi.fn()
    };
    const amap = {
      Map: vi.fn(() => mapInstance),
      Marker: vi.fn((opts: unknown) => ({ kind: "marker", opts })),
      Polyline: vi.fn((opts: unknown) => ({ kind: "polyline", opts }))
    };
    (globalThis as typeof globalThis & { AMap?: unknown }).AMap = amap;
    const day = {
      index: 1,
      items: [
        { name: "外滩", startTime: "09:00", durationMin: 60, verified: true, location: { lng: 121.49, lat: 31.24 } },
        { name: "未验证", startTime: "10:00", durationMin: 60, verified: false, location: { lng: 121.5, lat: 31.25 } },
        { name: "豫园", startTime: "11:00", durationMin: 60, verified: true, location: { lng: 121.48, lat: 31.23 } }
      ]
    };

    const { rerender } = render(<DayMap day={day} />);

    await waitFor(() => expect(amap.Map).toHaveBeenCalledTimes(1));
    expect(amap.Marker).toHaveBeenCalledTimes(2);
    expect(amap.Polyline).toHaveBeenCalledTimes(1);
    expect(mapInstance.setFitView).toHaveBeenCalledTimes(1);

    rerender(<DayMap day={{ index: 2, items: [day.items[0]] }} />);

    await waitFor(() => expect(mapInstance.clearMap).toHaveBeenCalled());
    expect(amap.Marker).toHaveBeenCalledTimes(3);
  });

  it("uses route polylines for segment overlays and collapses same-cluster markers", () => {
    const map = { clearMap: vi.fn(), add: vi.fn(), setFitView: vi.fn() };
    const amap = {
      Map: vi.fn(),
      Marker: vi.fn((opts: unknown) => ({ kind: "marker", opts })),
      Polyline: vi.fn((opts: unknown) => ({ kind: "polyline", opts }))
    };
    renderDayMapOverlays(amap, map, {
      index: 1,
      items: [
        { id: "a", name: "A", clusterKey: "c1", durationMin: 30, verified: true, location: { lng: 1, lat: 1 }, transportToNext: { mode: "walk", durationMin: 1, distanceKm: 0.1 } },
        {
          id: "b",
          name: "B",
          clusterKey: "c1",
          durationMin: 30,
          verified: true,
          location: { lng: 1.001, lat: 1.001 },
          transportToNext: { mode: "public", durationMin: 10, distanceKm: 1, polyline: [{ lng: 1, lat: 1 }, { lng: 2, lat: 2 }, { lng: 3, lat: 3 }] }
        },
        { id: "c", name: "C", clusterKey: "c2", durationMin: 30, verified: true, location: { lng: 3, lat: 3 } }
      ]
    });

    expect(amap.Marker).toHaveBeenCalledTimes(2);
    expect(amap.Polyline).toHaveBeenCalledTimes(2);
    expect((amap.Polyline as ReturnType<typeof vi.fn>).mock.calls[1][0]).toMatchObject({ path: [[1, 1], [2, 2], [3, 3]] });
  });
});
