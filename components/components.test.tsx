import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TripForm } from "./trip-form";
import { DayTimeline } from "./day-timeline";
import { DayMap, renderDayMapOverlays } from "./day-map";
import { CandidateList } from "./candidate-list";
import { FailedLinksSection, FilteredSection } from "./filtered-section";
import { TripWorkbench } from "./workbench/trip-workbench";
import { DetailDrawer } from "./workbench/detail-drawer";
import { WorkbenchMap } from "./workbench/workbench-map";
import TripPage from "@/app/trip/[id]/page";

const originalAmapKey = process.env.NEXT_PUBLIC_AMAP_JS_KEY;
const originalDataDir = process.env.PACKUP_DATA_DIR;
let componentDataRoot = "";

beforeEach(() => {
  componentDataRoot = "";
});

afterEach(async () => {
  process.env.NEXT_PUBLIC_AMAP_JS_KEY = originalAmapKey;
  process.env.PACKUP_DATA_DIR = originalDataDir;
  delete (globalThis as typeof globalThis & { AMap?: unknown }).AMap;
  document.head.querySelector("#amap-js-sdk")?.remove();
  if (componentDataRoot) await rm(componentDataRoot, { recursive: true, force: true });
});

describe("TripForm", () => {
  it("has-links path posts { destination, days, preferences, links } to /api/generate", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({ ok: true, body: new ReadableStream({ start: (controller) => controller.close() }) }) as typeof fetch;
    render(<TripForm />);

    fireEvent.change(screen.getByLabelText("目的地"), { target: { value: "香港" } });
    fireEvent.change(screen.getByLabelText("天数"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: /city walk/ }));
    fireEvent.click(screen.getByRole("button", { name: /美食探店/ }));
    fireEvent.change(screen.getByLabelText("小红书链接"), { target: { value: "hello https://xhslink.com/a and https://example.com/no" } });
    expect(screen.getByText("识别到 1 条")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "打包行程" }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/generate");
    expect(JSON.parse(init.body)).toEqual({
      destination: "香港",
      days: { base: 3 },
      links: ["https://xhslink.com/a"],
      mode: "plan",
      preferences: ["city walk", "美食探店"]
    });
    global.fetch = originalFetch;
  });

  it("pool-only path posts mode=pool and follows the pool-ready SSE event to /trip/:id", async () => {
    const originalFetch = global.fetch;
    const originalLocation = window.location;
    Object.defineProperty(window, "location", { value: { href: "" }, writable: true });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"stage":"plan","status":"pool-ready","tripId":"pool-1"}\n\n'));
          controller.close();
        }
      })
    }) as typeof fetch;
    render(<TripForm />);

    fireEvent.change(screen.getByLabelText("目的地"), { target: { value: "香港" } });
    fireEvent.change(screen.getByLabelText("小红书链接"), { target: { value: "https://xhslink.com/a" } });
    fireEvent.click(screen.getByRole("button", { name: "提取地点创建画布" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body).mode).toBe("pool");
    await waitFor(() => expect(window.location.href).toBe("/trip/pool-1"));
    global.fetch = originalFetch;
    Object.defineProperty(window, "location", { value: originalLocation, writable: true });
  });

  it("shows a resumable trip link as soon as the stream sends a tripId", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"type":"init","tripId":"trip-ui"}\n\n'));
          controller.close();
        }
      })
    }) as typeof fetch;
    render(<TripForm />);

    fireEvent.change(screen.getByLabelText("目的地"), { target: { value: "香港" } });
    fireEvent.change(screen.getByLabelText("天数"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("小红书链接"), { target: { value: "https://xhslink.com/a" } });
    fireEvent.click(screen.getByRole("button", { name: "打包行程" }));

    const link = await screen.findByRole("link", { name: /trip-ui/ });
    expect(link).toHaveAttribute("href", "/trip/trip-ui/select");
    global.fetch = originalFetch;
  });

  it("no-links path posts { destination, days } to /api/trips (empty canvas)", async () => {
    const originalFetch = global.fetch;
    const originalLocation = window.location;
    Object.defineProperty(window, "location", { value: { href: "" }, writable: true });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tripId: "manual-1" }) }) as typeof fetch;
    render(<TripForm />);

    fireEvent.change(screen.getByLabelText("目的地"), { target: { value: "上海" } });
    fireEvent.change(screen.getByLabelText("天数"), { target: { value: "2" } });
    // 没链接时副按钮文案为"空白画布"
    fireEvent.click(screen.getByRole("button", { name: "空白画布" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/trips", expect.objectContaining({ method: "POST" })));
    expect(JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body)).toEqual({ destination: "上海", days: { base: 2 } });
    expect(window.location.href).toBe("/trip/manual-1");
    global.fetch = originalFetch;
    Object.defineProperty(window, "location", { value: originalLocation, writable: true });
  });

  it("keeps both CTAs clickable and explains what is missing instead of graying out", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn() as typeof fetch;
    render(<TripForm />);

    // 空表单:两个按钮都可点,点了给「缺目的地」而不是静默无反应
    const pack = screen.getByRole("button", { name: "打包行程" });
    const blank = screen.getByRole("button", { name: "空白画布" });
    expect(pack).toBeEnabled();
    expect(blank).toBeEnabled();

    fireEvent.click(blank);
    expect(screen.getByText("请先填写城市 / 目的地")).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();

    // 有目的地但没链接:打包行程要提示缺链接并引导去空白画布
    fireEvent.change(screen.getByLabelText("目的地"), { target: { value: "香港" } });
    fireEvent.click(pack);
    expect(screen.getByText(/需要小红书笔记链接/)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();

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
    expect(screen.getByText(/未选中的地点会进入工作台待计划池/)).toBeInTheDocument();
    expect(screen.getByText(/重新排程将覆盖工作台里的已有编辑/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("外滩"));
    expect(screen.getByRole("button", { name: "排程" })).toBeDisabled();
  });
});

describe("TripPage", () => {
  it("renders the workbench for a payload with pool items", async () => {
    componentDataRoot = await mkdtemp(path.join(os.tmpdir(), "trip-page-"));
    process.env.PACKUP_DATA_DIR = componentDataRoot;
    const dir = path.join(componentDataRoot, "trip-page");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "00-input.json"), JSON.stringify({ id: "trip-page", links: [], destination: "上海", transport: "public", pace: "moderate" }), "utf8");
    await writeFile(path.join(dir, "10-notes.json"), JSON.stringify([{ id: "n1", title: "笔记", url: "u", body: "外滩", images: [], fetchStatus: "ok" }]), "utf8");
    await writeFile(path.join(dir, "20-pois.json"), JSON.stringify({ pois: [], filtered: [] }), "utf8");
    await writeFile(path.join(dir, "40-plan.json"), JSON.stringify(workbenchPlan()), "utf8");

    render(await TripPage({ params: Promise.resolve({ id: "trip-page" }) }));

    expect(screen.getAllByText(/待安排 · 3/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Day 1").length).toBeGreaterThan(0);
  });
});

describe("TripWorkbench", () => {
  it("renders lanes, pool cards, and type counts", () => {
    render(<TripWorkbench tripId="trip-1" initialPlan={workbenchPlan()} initialNotes={[]} />);

    expect(screen.getByText("待计划池")).toBeInTheDocument();
    expect(screen.getByText("Day 1")).toBeInTheDocument();
    expect(screen.getByText("Day 2")).toBeInTheDocument();
    expect(screen.getByText("food 2")).toBeInTheDocument();
    expect(screen.getAllByTestId("pool-card")).toHaveLength(3);
  });

  it("shows update warning and refreshes after a 409 patch response", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: "行程已更新" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ plan: workbenchPlan(), notes: [] }) }) as typeof fetch;
    render(<TripWorkbench tripId="trip-1" initialPlan={workbenchPlan()} initialNotes={[]} />);

    fireEvent.click(screen.getAllByRole("button", { name: "加入 Day 1" })[0]);

    expect(await screen.findByText(/行程已更新/)).toBeInTheDocument();
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/trips/trip-1"));
    global.fetch = originalFetch;
  });

  it("rolls back optimistic state after a failed patch response", async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: "server error" }) }) as typeof fetch;
    render(<TripWorkbench tripId="trip-1" initialPlan={workbenchPlan()} initialNotes={[]} />);

    fireEvent.click(screen.getAllByRole("button", { name: "加入 Day 1" })[0]);

    await screen.findByText(/保存失败/);
    expect(screen.getAllByTestId("pool-card")).toHaveLength(3);
    global.fetch = originalFetch;
  });

  it("sends searched POIs to pool-add when clicking 入池", async () => {
    const originalFetch = global.fetch;
    const plan = workbenchPlan();
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [{ amapId: "poi-pool", name: "新地点", location: { lng: 121.4, lat: 31.2 }, address: "addr" }] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ...plan, pool: [...plan.pool, { id: "poi-pool", name: "新地点", durationMin: 60 }] }) }) as typeof fetch;
    render(<TripWorkbench tripId="trip-1" initialPlan={plan} initialNotes={[]} />);

    fireEvent.change(screen.getByLabelText("搜索地点"), { target: { value: "新地点" } });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    fireEvent.click(await screen.findByRole("button", { name: "入池" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[1][1].body)).toMatchObject({ op: "pool-add", poi: { amapId: "poi-pool", name: "新地点" } });
    global.fetch = originalFetch;
  });

  it("asks after saving transport prefs and confirms a full recalc-transport", async () => {
    const originalFetch = global.fetch;
    const originalConfirm = window.confirm;
    window.confirm = vi.fn().mockReturnValue(true);
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ...workbenchPlan(), transportPrefs: { shortKm: 1, shortMode: "walk", longMode: "public" } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => workbenchPlan() }) as typeof fetch;
    render(<TripWorkbench tripId="trip-1" initialPlan={workbenchPlan()} initialNotes={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "交通偏好" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    expect(window.confirm).toHaveBeenCalledWith("立即全程重算交通?");
    expect(JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body)).toMatchObject({ op: "set-transport-prefs" });
    expect(JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[1][1].body)).toEqual({ op: "recalc-transport" });
    window.confirm = originalConfirm;
    global.fetch = originalFetch;
  });

  it("renders map focus and pool visibility controls", () => {
    render(<TripWorkbench tripId="trip-1" initialPlan={workbenchPlan()} initialNotes={[]} />);

    expect(screen.getByRole("button", { name: "地图总览" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "地图 Day 1" })).toBeInTheDocument();
    expect(screen.getByLabelText("显示池点")).toBeInTheDocument();
  });

  it("serializes quick consecutive edits and sends the second patch after the first resolves", async () => {
    const originalFetch = global.fetch;
    const initial = workbenchPlan();
    const afterFirst = {
      ...initial,
      days: [{ ...initial.days[0], items: [...initial.days[0].items, initial.pool[0]] }, initial.days[1]],
      pool: initial.pool.slice(1)
    };
    const afterSecond = {
      ...afterFirst,
      days: [{ ...afterFirst.days[0], items: [...afterFirst.days[0].items, afterFirst.pool[0]] }, afterFirst.days[1]],
      pool: afterFirst.pool.slice(1)
    };
    let resolveFirst!: (response: { ok: boolean; json: () => Promise<unknown> }) => void;
    const firstResponse = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => {
      resolveFirst = resolve;
    });
    global.fetch = vi
      .fn()
      .mockReturnValueOnce(firstResponse)
      .mockResolvedValueOnce({ ok: true, json: async () => afterSecond }) as typeof fetch;
    render(<TripWorkbench tripId="trip-1" initialPlan={initial} initialNotes={[]} />);

    fireEvent.click(screen.getAllByRole("button", { name: "加入 Day 1" })[0]);
    await waitFor(() => expect(screen.getAllByTestId("pool-card")).toHaveLength(2));
    fireEvent.click(screen.getAllByRole("button", { name: "加入 Day 1" })[0]);
    await Promise.resolve();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    resolveFirst({ ok: true, json: async () => afterFirst });

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body)).toMatchObject({ op: "add-item", poolItemId: "p1" });
    expect(JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[1][1].body)).toMatchObject({ op: "add-item", poolItemId: "p2" });
    global.fetch = originalFetch;
  });
});

describe("WorkbenchMap and DetailDrawer", () => {
  it("renders detail excerpts, fallback full body, and manual source state", () => {
    const item = { id: "i1", name: "外滩", type: "sight", durationMin: 60, reason: "推荐理由", sourceNoteId: "n1" };
    const { rerender } = render(<DetailDrawer item={item} note={{ id: "n1", title: "上海笔记", url: "https://example.com", body: `前文${"很".repeat(30)}外滩${"好".repeat(30)}后文` }} onClose={() => undefined} />);
    expect(screen.getAllByText("推荐理由").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/外滩/).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "查看原笔记" })).toHaveAttribute("href", "https://example.com");

    rerender(<DetailDrawer item={{ ...item, sourceNoteId: "n1" }} note={{ id: "n1", title: "无匹配", url: "u", body: "这是一段没有地点名的正文" }} onClose={() => undefined} />);
    expect(screen.getByText("这是一段没有地点名的正文")).toBeInTheDocument();

    rerender(<DetailDrawer item={{ ...item, sourceNoteId: "manual" }} onClose={() => undefined} />);
    expect(screen.getByText("手动添加")).toBeInTheDocument();
  });

  it("renders workbench map placeholder when key is missing", () => {
    delete process.env.NEXT_PUBLIC_AMAP_JS_KEY;
    render(<WorkbenchMap days={workbenchPlan().days} pool={workbenchPlan().pool} focus="all" selectedItemId={null} showPool={false} onMarkerClick={() => undefined} />);
    expect(screen.getByText("地图 key 未配置")).toBeInTheDocument();
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

function workbenchPlan() {
  return {
    days: [
      { index: 1, date: "2026-07-10", items: [{ id: "d1", name: "外滩", type: "sight", durationMin: 60, location: { lng: 121.49, lat: 31.24 } }] },
      { index: 2, items: [{ id: "d2", name: "豫园", type: "sight", durationMin: 60, location: { lng: 121.48, lat: 31.23 } }] }
    ],
    pool: [
      { id: "p1", name: "咖啡", type: "food", durationMin: 45, location: { lng: 121.47, lat: 31.22 } },
      { id: "p2", name: "面馆", type: "food", durationMin: 45, location: { lng: 121.46, lat: 31.21 } },
      { id: "p3", name: "商店", type: "shop", durationMin: 45, location: { lng: 121.45, lat: 31.2 } }
    ],
    filtered: [],
    warnings: []
  };
}

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
