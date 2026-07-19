"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AmapPoi } from "@/lib/map/types";
import { poiTypeFromAmap } from "@/lib/map/poi-type";
import type { GroundedPoi, PlanItem, PoiType, TransportMode, TripPlan } from "@/lib/pipeline/types";
import { applyIntent, type WorkbenchIntent } from "@/components/workbench/workbench-reducer";
import {
  FOLDER_H,
  FOLDER_W,
  STICKER_H,
  STICKER_W,
  contentBounds,
  dayColor,
  expandedPos,
  folderPos,
  groupAdjacent,
  loadPersist,
  poolPos,
  poolZoneRect,
  savePersist,
  type CanvasPersist,
  type ItemGroup,
  type XY
} from "./canvas-layout";
import { useCanvasView } from "./use-canvas-view";
import { PoiSticker } from "./poi-sticker";
import { DayFolder } from "./day-folder";
import { RouteLayer, segmentMid, type RoutePoint } from "./canvas-connections";
import { MapDock } from "./map-dock";
import { CanvasDrawer, type DrawerNote } from "./canvas-drawer";
import { CanvasTopBar } from "./canvas-top-bar";

type CardEntry = {
  key: string;
  group: ItemGroup;
  dayNumber?: number;
  origin: "pool" | "day";
  pos: XY;
  mode: "scatter" | "expanded";
  order?: number;
};

type FolderEntry = { dayNumber: number; pos: XY; dockedGroups: ItemGroup[] };

type DragState =
  | { kind: "pan"; pointerId: number; startScreen: XY; startView: { tx: number; ty: number; scale: number }; moved: boolean }
  | { kind: "poi"; pointerId: number; key: string; origin: "pool" | "day"; fromDay?: number; startScreen: XY; grabOffset: XY; pos: XY; moved: boolean }
  | { kind: "folder"; pointerId: number; day: number; startScreen: XY; grabOffset: XY; pos: XY; moved: boolean };

export function CanvasWorkbench({ initialPlan, initialNotes, tripId }: { initialPlan: TripPlan; initialNotes: DrawerNote[]; tripId: string }) {
  const [plan, setPlan] = useState(initialPlan);
  const planRef = useRef(initialPlan);
  const queueRef = useRef<Array<{ intent: WorkbenchIntent; options: { recalcAfterPrefs?: boolean } }>>([]);
  const processingRef = useRef(false);

  const viewportRef = useRef<HTMLDivElement>(null);
  const { view, setView, toWorld, zoomAt, fitBounds } = useCanvasView(viewportRef);
  const [positions, setPositions] = useState<Record<string, XY>>({});
  const [expandedDay, setExpandedDay] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dropDay, setDropDay] = useState<number | null>(null);
  const [dropCard, setDropCard] = useState<string | null>(null);
  const [dropToPool, setDropToPool] = useState(false);
  const [activeSegment, setActiveSegment] = useState<{ day: number; groupGap: number } | null>(null);
  const [message, setMessage] = useState("");
  const [ready, setReady] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(false);
  // 双击目标在 React 重渲染中被替换时,dblclick 的 target 会漂到画布根节点;记录最近一次卡片/文件夹交互兜底
  const lastItemPointerRef = useRef(0);

  /**
   * 浮动地图占用的右侧宽度,fit 时从可用区扣除。
   * collapsed 状态地图是右下角浮层(不是右侧栏),fit 应把编辑区居中到整个 viewport,
   * 让内容中心≈屏幕中心;expanded 状态才占满右侧,fit 让内容避让右栏。
   */
  const mapPadRight = useCallback(() => {
    if (!mapExpanded) return 0;
    const vw = viewportRef.current?.clientWidth ?? window.innerWidth;
    return Math.min(vw * 0.38, 720) + 44;
  }, [mapExpanded]);

  /* ---------- 数据流(与旧工作台同源:乐观更新 + PATCH + 409 刷新) ---------- */

  const commitPlan = useCallback((next: TripPlan) => {
    planRef.current = next;
    setPlan(next);
  }, []);

  const runIntent = useCallback(
    async (intent: WorkbenchIntent, options: { recalcAfterPrefs?: boolean } = {}) => {
      setMessage("");
      const snapshot = planRef.current;
      const result = applyIntent(snapshot, intent);
      if ("error" in result) {
        setMessage(result.error);
        return;
      }
      commitPlan(result.optimisticPlan);
      const response = await fetch(`/api/trips/${tripId}/plan`, { method: "PATCH", body: JSON.stringify(result.patchBody) });
      if (response.ok) {
        const payload = await response.json();
        commitPlan("days" in payload ? payload : payload.plan);
        if (options.recalcAfterPrefs && window.confirm("立即全程重算交通?")) {
          await runIntent({ type: "recalc-transport" });
        }
        return;
      }
      commitPlan(snapshot);
      if (response.status === 409) {
        setMessage("行程已更新,正在刷新");
        const fresh = await fetch(`/api/trips/${tripId}`);
        if (fresh.ok) {
          const payload = await fresh.json();
          commitPlan(payload.plan);
        }
      } else {
        setMessage("保存失败,已回滚");
      }
    },
    [commitPlan, tripId]
  );

  const execute = useCallback(
    (intent: WorkbenchIntent, options: { recalcAfterPrefs?: boolean } = {}) => {
      queueRef.current.push({ intent, options });
      if (processingRef.current) return;
      processingRef.current = true;
      void (async () => {
        try {
          while (queueRef.current.length > 0) {
            const next = queueRef.current.shift()!;
            await runIntent(next.intent, next.options);
          }
        } finally {
          processingRef.current = false;
        }
      })();
    },
    [runIntent]
  );

  /* ---------- 持久化(视图/散布位置/收纳态) ---------- */

  useEffect(() => {
    const persist = loadPersist(tripId);
    setPositions(persist.positions);
    if (persist.view) {
      setView(persist.view);
      setReady(true);
    } else {
      fitBounds(...boundsArgs(planRef.current, persist.positions), { onSettled: () => setReady(true), padRight: mapPadRight() });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅挂载时恢复一次
  }, [tripId]);

  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => savePersist(tripId, { view, positions } satisfies CanvasPersist), 300);
    return () => clearTimeout(t);
  }, [tripId, view, positions, ready]);

  /* ---------- 布局 ---------- */

  const layout = useMemo(() => computeLayout(plan, positions, expandedDay), [plan, positions, expandedDay]);

  const routePoints = useMemo<RoutePoint[]>(() => {
    if (expandedDay === null) return [];
    return layout.cards
      .filter((card) => card.mode === "expanded")
      .map((card) => ({ key: card.key, x: card.pos.x + STICKER_W / 2, y: card.pos.y + STICKER_H / 2 }));
  }, [layout, expandedDay]);

  /* ---------- 指针交互(委托) ---------- */

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      // 浮动 UI(顶栏/地图/抽屉/提示)自行处理事件,画布不捕获指针
      if ((event.target as HTMLElement).closest("[data-canvas-ui]")) return;
      setActiveSegment(null);
      const target = (event.target as HTMLElement).closest<HTMLElement>("[data-canvas-item]");
      const screen = { x: event.clientX, y: event.clientY };
      viewportRef.current?.setPointerCapture(event.pointerId);
      if (target) lastItemPointerRef.current = Date.now();
      if (target?.dataset.canvasItem === "poi") {
        const key = target.dataset.itemId!;
        const card = layout.cards.find((c) => c.key === key);
        const world = toWorld(screen);
        const pos = card?.pos ?? { x: world.x - STICKER_W / 2, y: world.y - 48 };
        const grabOffset = card ? { x: world.x - card.pos.x, y: world.y - card.pos.y } : { x: STICKER_W / 2, y: 48 };
        const stackedGroup = layout.folders.flatMap((f) => f.dockedGroups.map((g) => ({ day: f.dayNumber, id: g.id }))).find((g) => g.id === key);
        const origin: "pool" | "day" = card?.origin ?? (stackedGroup ? "day" : "pool");
        const fromDay = card?.dayNumber ?? stackedGroup?.day;
        setDrag({ kind: "poi", pointerId: event.pointerId, key, origin, fromDay, startScreen: screen, grabOffset, pos, moved: false });
        return;
      }
      if (target?.dataset.canvasItem === "folder") {
        const day = Number(target.dataset.day);
        const folder = layout.folders.find((f) => f.dayNumber === day)!;
        const world = toWorld(screen);
        setDrag({ kind: "folder", pointerId: event.pointerId, day, startScreen: screen, grabOffset: { x: world.x - folder.pos.x, y: world.y - folder.pos.y }, pos: folder.pos, moved: false });
        return;
      }
      setDrag({ kind: "pan", pointerId: event.pointerId, startScreen: screen, startView: view, moved: false });
    },
    [layout, toWorld, view]
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const screen = { x: event.clientX, y: event.clientY };
      const moved = drag.moved || Math.hypot(screen.x - drag.startScreen.x, screen.y - drag.startScreen.y) > 5;
      if (drag.kind === "pan") {
        setDrag({ ...drag, moved });
        setView({ ...drag.startView, tx: drag.startView.tx + screen.x - drag.startScreen.x, ty: drag.startView.ty + screen.y - drag.startScreen.y });
        return;
      }
      const world = toWorld(screen);
      const pos = { x: world.x - drag.grabOffset.x, y: world.y - drag.grabOffset.y };
      setDrag({ ...drag, pos, moved });
      if (drag.kind === "poi" && moved) {
        const center = { x: pos.x + STICKER_W / 2, y: pos.y + STICKER_H / 2 };
        if (expandedDay !== null) {
          // 展开态:只允许天内重排,或拖出摊开区移回待安排;禁止投递到其他文件夹
          setDropDay(null);
          const targetCard = layout.cards.find(
            (card) => card.mode === "expanded" && card.key !== drag.key && within(center, card.pos, STICKER_W, STICKER_H, 0)
          );
          setDropCard(targetCard?.key ?? null);
          if (drag.origin === "day") {
            const folderTopLeft = positions[`folder:${expandedDay}`] ?? folderPos(expandedDay);
            const count = groupAdjacent(planRef.current.days[expandedDay - 1]?.items ?? []).length;
            const [bMin, bMax] = expandedBounds(folderTopLeft, count);
            setDropToPool(!targetCard && !within(center, bMin, bMax.x - bMin.x, bMax.y - bMin.y, 0));
          }
          return;
        }
        const folder = layout.folders.find((f) => within(center, f.pos, FOLDER_W, FOLDER_H, 26));
        setDropDay(folder?.dayNumber ?? null);
        setDropCard(null);
        // 收起态把文件夹里的卡拖到空白 = 移回待安排
        setDropToPool(!folder && drag.origin === "day");
      }
    },
    [drag, layout, toWorld, setView, expandedDay, positions]
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const current = drag;
      setDrag(null);
      setDropDay(null);
      setDropCard(null);
      setDropToPool(false);

      if (!current.moved) {
        if (current.kind === "poi") setSelectedId((value) => (value === current.key ? null : current.key));
        if (current.kind === "folder") {
          const nextDay = expandedDay === current.day ? null : current.day;
          setExpandedDay(nextDay);
          setSelectedId(null);
          if (nextDay !== null) {
            const folderTopLeft = positions[`folder:${nextDay}`] ?? folderPos(nextDay);
            const count = groupAdjacent(planRef.current.days[nextDay - 1]?.items ?? []).length;
            fitBounds(...expandedBounds(folderTopLeft, count), { animateMs: 300, padRight: mapPadRight() });
          }
        }
        if (current.kind === "pan" && expandedDay !== null) {
          // 展开态点击摊开区(虚线框)外的空白 = 收起当天
          const world = toWorld({ x: event.clientX, y: event.clientY });
          const folderTopLeft = positions[`folder:${expandedDay}`] ?? folderPos(expandedDay);
          const count = groupAdjacent(planRef.current.days[expandedDay - 1]?.items ?? []).length;
          const [bMin, bMax] = expandedBounds(folderTopLeft, count);
          if (!within(world, bMin, bMax.x - bMin.x, bMax.y - bMin.y, 0)) setExpandedDay(null);
        }
        return;
      }

      if (current.kind === "folder") {
        setPositions((prev) => ({ ...prev, [`folder:${current.day}`]: current.pos }));
        return;
      }

      if (current.kind === "poi") {
        const returnToPool = () => {
          if (current.fromDay === undefined) return;
          execute({ type: "return-item-to-pool", day: current.fromDay, itemId: current.key });
          setPositions((prev) => omit(prev, current.key)); // 回池后落待安排区网格
        };

        if (expandedDay !== null && current.origin === "day" && current.fromDay === expandedDay) {
          // 展开态:重排 or 拖出摊开区移回待安排,其余弹回
          if (dropCard) {
            const day = plan.days[expandedDay - 1];
            if (day) {
              const ids = groupAdjacent(day.items).map((group) => group.id).filter((id) => id !== current.key);
              const at = ids.indexOf(dropCard);
              if (at >= 0) {
                ids.splice(at, 0, current.key);
                execute({ type: "reorder-day", day: expandedDay, orderedItemIds: ids });
              }
            }
            return;
          }
          if (dropToPool) returnToPool();
          return;
        }

        if (dropDay !== null) {
          if (current.origin === "pool") {
            execute({ type: "place-pool-item", poolItemId: current.key, day: dropDay });
            setPositions((prev) => omit(prev, current.key));
          } else if (current.fromDay !== undefined && current.fromDay !== dropDay) {
            execute({ type: "move-day-item", fromDay: current.fromDay, toDay: dropDay, itemId: current.key });
          }
          return;
        }

        if (current.origin === "day") {
          // 收起态从文件夹拖出到空白 = 移回待安排
          returnToPool();
          return;
        }

        // 池卡在画布上自由摆放
        setPositions((prev) => ({ ...prev, [current.key]: current.pos }));
      }
    },
    [drag, dropDay, dropCard, dropToPool, expandedDay, plan, execute, positions, fitBounds, toWorld, mapPadRight]
  );

  const onDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      // 浮动 UI 与卡片/文件夹上的双击不复位;React 重渲染换掉目标节点时 target 会漂到画布根,用最近交互时间兜底
      if ((event.target as HTMLElement).closest("[data-canvas-item], [data-canvas-ui]")) return;
      if (Date.now() - lastItemPointerRef.current < 500) return;
      fitBounds(...boundsArgs(planRef.current, positions), { animateMs: 300, padRight: mapPadRight() });
    },
    [fitBounds, mapPadRight, positions]
  );

  /* ---------- 派生 ---------- */

  const selected = useMemo(() => {
    if (!selectedId) return undefined;
    for (let index = 0; index < plan.days.length; index++) {
      const group = groupAdjacent(plan.days[index].items).find((g) => g.id === selectedId);
      if (group) return { item: group.items[0], dayNumber: index + 1 };
    }
    const poolGroup = groupAdjacent(plan.pool).find((g) => g.id === selectedId);
    return poolGroup ? { item: poolGroup.items[0], dayNumber: undefined } : undefined;
  }, [selectedId, plan]);

  const selectedNote = useMemo(() => {
    const noteId = selected?.item.poi?.sourceNoteId;
    return noteId ? initialNotes.find((note) => note.id === noteId) : undefined;
  }, [selected, initialNotes]);

  const expandedDayData = expandedDay !== null ? plan.days[expandedDay - 1] : undefined;
  const expandedGroups = expandedDayData ? groupAdjacent(expandedDayData.items) : [];

  // 拖动文件夹时,摊开的卡片/路线/边界框实时跟随
  const dragShift = (() => {
    if (drag?.kind !== "folder" || !drag.moved) return null;
    const folder = layout.folders.find((f) => f.dayNumber === drag.day);
    if (!folder) return null;
    return { day: drag.day, dx: drag.pos.x - folder.pos.x, dy: drag.pos.y - folder.pos.y };
  })();

  const shiftedRoutePoints =
    dragShift && expandedDay === dragShift.day
      ? routePoints.map((point) => ({ ...point, x: point.x + dragShift.dx, y: point.y + dragShift.dy }))
      : routePoints;

  // 展开态摊开区边界(拖出即移回待安排),随文件夹拖拽平移
  const expandedZone = (() => {
    if (expandedDay === null) return null;
    const base = positions[`folder:${expandedDay}`] ?? folderPos(expandedDay);
    const folderTopLeft = dragShift?.day === expandedDay ? { x: base.x + dragShift.dx, y: base.y + dragShift.dy } : base;
    const [min, max] = expandedBounds(folderTopLeft, expandedGroups.length);
    return { min, max };
  })();

  return (
    <div
      ref={viewportRef}
      className="canvas-grab fixed inset-0 touch-none select-none overflow-hidden bg-paper"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
    >
      {/* 世界层 */}
      <div
        className="absolute left-0 top-0"
        style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`, transformOrigin: "0 0", opacity: ready ? 1 : 0 }}
      >
        {/* 点阵底 */}
        <div
          className="pointer-events-none absolute"
          style={{
            left: -20000,
            top: -20000,
            width: 40000,
            height: 40000,
            backgroundImage: "radial-gradient(circle, #e4e1da 1.4px, transparent 1.4px)",
            backgroundSize: "26px 26px"
          }}
        />

        {/* 待安排池区 */}
        <PoolZone poolCount={layout.poolGroups.length} dayCount={plan.days.length} faded={expandedDay !== null} />

        {/* 展开态摊开区边界:拖出虚线框 = 移回待安排 */}
        {expandedZone && expandedDay !== null ? (
          <div
            className="pointer-events-none absolute rounded-[26px] border-2 border-dashed"
            style={{
              left: expandedZone.min.x,
              top: expandedZone.min.y,
              width: expandedZone.max.x - expandedZone.min.x,
              height: expandedZone.max.y - expandedZone.min.y,
              borderColor: `color-mix(in srgb, ${dayColor(expandedDay)} 55%, transparent)`,
              background: `color-mix(in srgb, ${dayColor(expandedDay)} 4%, transparent)`
            }}
          >
            <span
              className="absolute -top-3.5 right-6 rounded-full border border-line bg-white px-2.5 py-0.5 text-[11px] font-medium"
              style={{ color: "var(--ink-soft)" }}
            >
              把卡片拖出虚线框,移回待安排
            </span>
          </div>
        ) : null}

        {/* 展开态路线 */}
        {expandedDay !== null ? <RouteLayer points={shiftedRoutePoints} color={dayColor(expandedDay)} /> : null}

        {/* 文件夹 */}
        {layout.folders.map((folder) => {
          const pos = drag?.kind === "folder" && drag.day === folder.dayNumber && drag.moved ? drag.pos : folder.pos;
          return (
            <div key={folder.dayNumber} className="absolute" style={{ left: pos.x, top: pos.y, zIndex: 5 }}>
              <DayFolder
                day={plan.days[folder.dayNumber - 1]}
                dayNumber={folder.dayNumber}
                expanded={expandedDay === folder.dayNumber}
                dropHover={dropDay === folder.dayNumber}
                dockedGroups={folder.dockedGroups}
                faded={expandedDay !== null && expandedDay !== folder.dayNumber}
              />
            </div>
          );
        })}

        {/* 地点贴纸卡 */}
        {layout.cards.map((card) => {
          const dragging = drag?.kind === "poi" && drag.key === card.key && drag.moved;
          let pos = dragging ? (drag as Extract<DragState, { kind: "poi" }>).pos : card.pos;
          if (!dragging && dragShift && card.mode === "expanded" && card.dayNumber === dragShift.day) {
            pos = { x: pos.x + dragShift.dx, y: pos.y + dragShift.dy };
          }
          const faded = expandedDay !== null && !(card.mode === "expanded") && !dragging;
          return (
            <div key={card.key} className="absolute" style={{ left: pos.x, top: pos.y, zIndex: dragging ? 50 : 10 }}>
              <PoiSticker
                group={card.group}
                dayNumber={card.dayNumber}
                selected={selectedId === card.key}
                dragging={dragging}
                dropTarget={dropCard === card.key}
                faded={faded}
                order={card.order}
              />
            </div>
          );
        })}

        {/* 从文件夹拖出的收纳卡(不在 layout.cards 里)跟手渲染 */}
        {drag?.kind === "poi" && drag.moved && !layout.cards.some((card) => card.key === drag.key) ? (
          <DraggedGhost plan={plan} dragKey={drag.key} pos={drag.pos} />
        ) : null}

        {/* 拖拽去向提示 */}
        {drag?.kind === "poi" && drag.moved && dropToPool ? (
          <div
            className="pointer-events-none absolute z-50 whitespace-nowrap rounded-full border-2 border-ink bg-warn px-3 py-1 text-[12px] font-semibold text-warn-ink hard-shadow"
            style={{ left: drag.pos.x + STICKER_W / 2, top: drag.pos.y - 26, transform: "translateX(-50%)" }}
          >
            松手移回待安排
          </div>
        ) : null}

        {/* 交通徽章(展开态组间) */}
        {expandedDay !== null && expandedGroups.length > 1
          ? expandedGroups.slice(0, -1).map((group, gapIndex) => {
              const a = shiftedRoutePoints[gapIndex];
              const b = shiftedRoutePoints[gapIndex + 1];
              if (!a || !b) return null;
              const mid = segmentMid(a, b, `${a.key}->${b.key}`);
              const segItemIndex = group.index + group.items.length - 1;
              const segment = expandedDayData!.items[segItemIndex]?.transportToNext;
              return (
                <TransportBadge
                  key={`${group.id}:gap`}
                  mid={mid}
                  segment={segment}
                  active={activeSegment?.groupGap === gapIndex}
                  onToggle={() => setActiveSegment((value) => (value?.groupGap === gapIndex ? null : { day: expandedDay, groupGap: gapIndex }))}
                  onSetMode={(mode) => {
                    execute({ type: "set-transport", day: expandedDay, segmentIndex: segItemIndex, mode });
                    setActiveSegment(null);
                  }}
                  onRecalc={() => {
                    execute({ type: "recalc-transport", day: expandedDay });
                    setActiveSegment(null);
                  }}
                />
              );
            })
          : null}
      </div>

      {/* 浮层 */}
      <CanvasTopBar
        plan={plan}
        tripId={tripId}
        scale={view.scale}
        message={message}
        onAddDay={() => execute({ type: "add-day" })}
        onZoom={(factor) => {
          const el = viewportRef.current;
          if (!el) return;
          const rect = el.getBoundingClientRect();
          zoomAt({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, factor);
        }}
        onFit={() => fitBounds(...boundsArgs(plan, positions), { animateMs: 300, padRight: mapPadRight() })}
        onSavePrefs={(prefs) => execute({ type: "set-transport-prefs", prefs }, { recalcAfterPrefs: true })}
        onOptimizeDay={expandedDay !== null ? () => execute({ type: "optimize-day", day: expandedDay }) : undefined}
        onDeleteDay={
          expandedDay !== null
            ? () => {
                if (window.confirm(`删除 Day ${expandedDay}?当天地点将回到待安排池`)) {
                  setExpandedDay(null);
                  execute({ type: "remove-day", day: expandedDay });
                }
              }
            : undefined
        }
        onSetTheme={expandedDay !== null ? (theme) => execute({ type: "set-day-theme", day: expandedDay, theme }) : undefined}
        expandedDay={expandedDay}
        onAddPoi={(poi) => execute({ type: "add-poi-to-pool", poi: groundedFromAmap(poi) })}
      />

      <MapDock
        days={plan.days}
        pool={plan.pool}
        destination={plan.destination}
        tripId={tripId}
        focus={expandedDay ?? "all"}
        selectedItemId={selectedId}
        onMarkerClick={(itemId) => setSelectedId((value) => (value === itemId ? null : itemId))}
        expanded={mapExpanded}
        onToggleExpanded={() => setMapExpanded((value) => !value)}
      />

      {selected ? (
        <CanvasDrawer
          item={selected.item}
          dayNumber={selected.dayNumber}
          note={selectedNote}
          dayCount={plan.days.length}
          mapExpanded={mapExpanded}
          onClose={() => setSelectedId(null)}
          // day 省略 = 改池里的地点(手动添加的地点默认落池,类型纠正主要发生在这里)
          onEdit={(set) => execute({ type: "edit-item", day: selected.dayNumber, itemId: selectedId!, set })}
          onReturnToPool={
            selected.dayNumber
              ? () => {
                  execute({ type: "return-item-to-pool", day: selected.dayNumber!, itemId: selectedId! });
                  setSelectedId(null);
                }
              : undefined
          }
          onPlaceToDay={
            !selected.dayNumber
              ? (day) => {
                  execute({ type: "place-pool-item", poolItemId: selectedId!, day });
                  setPositions((prev) => omit(prev, selectedId!));
                  setSelectedId(null);
                }
              : undefined
          }
          onRemove={
            !selected.dayNumber
              ? () => {
                  execute({ type: "remove-pool-item", poolItemId: selectedId! });
                  setPositions((prev) => omit(prev, selectedId!));
                  setSelectedId(null);
                }
              : undefined
          }
        />
      ) : null}
    </div>
  );
}

/* ---------- 布局计算 ---------- */

function computeLayout(plan: TripPlan, positions: Record<string, XY>, expandedDay: number | null) {
  const cards: CardEntry[] = [];
  const folders: FolderEntry[] = [];
  const poolGroups = groupAdjacent(plan.pool);

  plan.days.forEach((day, index) => {
    const dayNumber = index + 1;
    const groups = groupAdjacent(day.items);
    const pos = positions[`folder:${dayNumber}`] ?? folderPos(dayNumber);
    if (expandedDay === dayNumber) {
      folders.push({ dayNumber, pos, dockedGroups: [] });
      groups.forEach((group, gi) => {
        cards.push({ key: group.id, group, dayNumber, origin: "day", pos: expandedPosFrom(pos, gi), mode: "expanded", order: gi + 1 });
      });
      return;
    }
    // 已排程地点一律收纳在文件夹上,画布上游离的只有待安排卡
    folders.push({ dayNumber, pos, dockedGroups: groups });
  });

  poolGroups.forEach((group, gi) => {
    cards.push({ key: group.id, group, origin: "pool", pos: positions[group.id] ?? poolPos(gi, group.id, plan.days.length), mode: "scatter" });
  });

  return { cards, folders, poolGroups };
}

/** 文件夹被拖过后,摊开位置跟随其当前位置 */
function expandedPosFrom(folderTopLeft: XY, index: number): XY {
  const base = expandedPos(1, index);
  const origin = folderPos(1);
  return { x: folderTopLeft.x + (base.x - origin.x), y: folderTopLeft.y + (base.y - origin.y) };
}

/* ---------- 小部件 ---------- */

function PoolZone({ poolCount, dayCount, faded }: { poolCount: number; dayCount: number; faded: boolean }) {
  const rect = poolZoneRect(dayCount, poolCount);
  return (
    <div
      className={`pointer-events-none absolute rounded-[20px] border-2 border-dashed transition-opacity duration-200 ${faded ? "opacity-20" : ""}`}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, borderColor: "#d8d4cc" }}
    >
      <span className="absolute -top-4 left-6 rounded-full border border-line bg-white px-3 py-1 font-display text-[14px] font-bold text-ink hard-shadow">
        待安排 · {poolCount}
      </span>
      {poolCount === 0 ? (
        <span className="absolute left-6 top-6 text-[13px] text-ink-soft">空啦。搜索添加地点,或把不想去的卡片拖回这里</span>
      ) : null}
    </div>
  );
}

function DraggedGhost({ plan, dragKey, pos }: { plan: TripPlan; dragKey: string; pos: XY }) {
  for (let index = 0; index < plan.days.length; index++) {
    const group = groupAdjacent(plan.days[index].items).find((g) => g.id === dragKey);
    if (group) {
      return (
        <div className="absolute" style={{ left: pos.x, top: pos.y, zIndex: 50 }}>
          <PoiSticker group={group} dayNumber={index + 1} dragging />
        </div>
      );
    }
  }
  return null;
}

const MODE_LABEL: Record<string, string> = { walk: "步行", bike: "骑行", public: "公交", drive: "驾车" };

function TransportBadge({
  mid,
  segment,
  active,
  onToggle,
  onSetMode,
  onRecalc
}: {
  mid: XY;
  segment?: { mode: string; durationMin: number; distanceKm: number };
  active: boolean;
  onToggle: () => void;
  onSetMode: (mode: TransportMode) => void;
  onRecalc: () => void;
}) {
  return (
    <div className="absolute z-20" style={{ left: mid.x, top: mid.y, transform: "translate(-50%, -50%)" }}>
      <button
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={onToggle}
        className={`whitespace-nowrap rounded-full border-2 border-ink bg-white px-2.5 py-1 text-[11px] font-semibold text-ink hard-shadow transition-transform hover:-translate-y-px ${segment ? "" : "border-dashed text-ink-soft"}`}
      >
        {segment ? `${MODE_LABEL[segment.mode] ?? segment.mode} ${Math.round(segment.durationMin)}分 · ${segment.distanceKm.toFixed(1)}km` : "交通待计算"}
      </button>
      {active ? (
        <div
          className="absolute left-1/2 top-full z-30 mt-2 flex -translate-x-1/2 items-center gap-1 rounded-full border-2 border-ink bg-white px-2 py-1.5 hard-shadow"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {(Object.keys(MODE_LABEL) as TransportMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onSetMode(mode)}
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${segment?.mode === mode ? "bg-accent text-white" : "text-ink hover:bg-accent-soft"}`}
            >
              {MODE_LABEL[mode]}
            </button>
          ))}
          <i className="mx-0.5 h-4 w-px bg-line" />
          <button type="button" onClick={onRecalc} className="rounded-full px-2 py-0.5 text-[11px] font-medium text-accent hover:bg-accent-soft">
            重算
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* ---------- 工具 ---------- */

function boundsArgs(plan: TripPlan, positions: Record<string, XY>): [XY, XY] {
  const { min, max } = contentBounds(plan, positions);
  return [min, max];
}

/** 展开态该天的视野:文件夹 + 蛇形摊开区 */
function expandedBounds(folderTopLeft: XY, count: number): [XY, XY] {
  const min = { x: folderTopLeft.x - 60, y: folderTopLeft.y - 120 };
  const max = { x: folderTopLeft.x + FOLDER_W, y: folderTopLeft.y + FOLDER_H + 40 };
  for (let index = 0; index < Math.max(1, count); index++) {
    const pos = expandedPosFrom(folderTopLeft, index);
    max.x = Math.max(max.x, pos.x + STICKER_W + 60);
    max.y = Math.max(max.y, pos.y + STICKER_H + 60);
    min.y = Math.min(min.y, pos.y - 60);
  }
  return [min, max];
}

function within(point: XY, topLeft: XY, w: number, h: number, pad: number) {
  return point.x >= topLeft.x - pad && point.x <= topLeft.x + w + pad && point.y >= topLeft.y - pad && point.y <= topLeft.y + h + pad;
}

function omit<T extends Record<string, unknown>>(obj: T, key: string): T {
  if (!(key in obj)) return obj;
  const next = { ...obj };
  delete next[key];
  return next;
}

function groundedFromAmap(poi: AmapPoi): GroundedPoi {
  return {
    id: poi.amapId,
    name: poi.name,
    // 高德分类映射;映射不到旅行语义的(地铁站/写字楼/道路名)落 other,用户可在详情抽屉改
    type: poiTypeFromAmap(poi.typecode),
    reason: "手动添加",
    sourceNoteId: "manual",
    sourceType: "manual",
    verified: true,
    amapId: poi.amapId,
    location: poi.location,
    address: poi.address,
    openHours: poi.openHours,
    rating: poi.rating
  };
}
