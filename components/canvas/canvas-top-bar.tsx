"use client";

import React, { useEffect, useRef, useState } from "react";
import { Minus, Plus, Scan, Search, Settings2, Sparkles, Trash2, Wand2 } from "lucide-react";
import type { AmapPoi } from "@/lib/map/types";
import type { TransportMode, TransportPrefs, TripPlan } from "@/lib/pipeline/types";
import { dayColor } from "./canvas-layout";

/** 画布顶栏:logo 贴纸 + 标题 + 搜索 + Day 工具 + 视图控件 */
export function CanvasTopBar({
  plan,
  tripId,
  scale,
  message,
  expandedDay,
  onAddDay,
  onZoom,
  onFit,
  onSavePrefs,
  onOptimizeDay,
  onDeleteDay,
  onSetTheme,
  onAddPoi
}: {
  plan: TripPlan;
  tripId: string;
  scale: number;
  message: string;
  expandedDay: number | null;
  onAddDay: () => void;
  onZoom: (factor: number) => void;
  onFit: () => void;
  onSavePrefs: (prefs: TransportPrefs) => void;
  onOptimizeDay?: () => void;
  onDeleteDay?: () => void;
  onSetTheme?: (theme: string) => void;
  onAddPoi: (poi: AmapPoi) => void;
}) {
  const title = plan.destination ?? "行程画布";

  return (
    <>
      <header
        data-canvas-ui
        className="fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-3 border-b-2 border-ink bg-paper/95 px-4"
      >
        <a href="/" className="flex items-center" aria-label="回到首页">
          <img src="/stickers/logo-wordmark.png" alt="packup" className="sticker-drop h-8 select-none" draggable={false} />
        </a>
        <h1 className="font-display truncate text-xl font-bold text-ink">{title}</h1>
        <span className="hidden text-[11px] text-ink-soft lg:block">拖动空白平移 · ⌘+滚轮缩放 · 双击空白复位</span>

        <div className="ml-auto flex items-center gap-2">
          <PoiSearch tripId={tripId} onAddPoi={onAddPoi} />
          <TransportPrefsButton prefs={plan.transportPrefs} onSave={onSavePrefs} />
          <button
            type="button"
            onClick={onAddDay}
            className="flex items-center gap-1 rounded-full bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-white transition-transform hover:-translate-y-px"
          >
            <Plus size={14} /> 新增 Day
          </button>
        </div>
      </header>

      {/* 展开态 Day 工具签 */}
      {expandedDay !== null && onSetTheme ? (
        <DayToolbar
          key={expandedDay}
          dayNumber={expandedDay}
          theme={plan.days[expandedDay - 1]?.theme ?? ""}
          onSetTheme={onSetTheme}
          onOptimize={onOptimizeDay}
          onDelete={onDeleteDay}
        />
      ) : null}

      {message ? (
        <p data-canvas-ui className="fixed left-1/2 top-16 z-50 -translate-x-1/2 rounded-full border-2 border-ink bg-warn px-4 py-1.5 text-[13px] font-medium text-warn-ink hard-shadow">
          {message}
        </p>
      ) : null}

      {/* 左下角视图控件 */}
      <div
        data-canvas-ui
        className="fixed bottom-5 left-5 z-40 flex items-center gap-1 rounded-full border-2 border-ink bg-white px-1.5 py-1 hard-shadow"
      >
        <IconButton label="缩小" onClick={() => onZoom(1 / 1.25)}>
          <Minus size={14} />
        </IconButton>
        <span className="w-11 text-center text-[12px] font-semibold tabular-nums text-ink">{Math.round(scale * 100)}%</span>
        <IconButton label="放大" onClick={() => onZoom(1.25)}>
          <Plus size={14} />
        </IconButton>
        <i className="mx-0.5 h-4 w-px bg-line" />
        <IconButton label="整体视图" onClick={onFit}>
          <Scan size={14} />
        </IconButton>
      </div>
    </>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-full text-ink transition-colors hover:bg-accent-soft"
    >
      {children}
    </button>
  );
}

function DayToolbar({
  dayNumber,
  theme,
  onSetTheme,
  onOptimize,
  onDelete
}: {
  dayNumber: number;
  theme: string;
  onSetTheme: (theme: string) => void;
  onOptimize?: () => void;
  onDelete?: () => void;
}) {
  const [value, setValue] = useState(theme);
  useEffect(() => setValue(theme), [theme]);
  return (
    <div
      data-canvas-ui
      className="fixed left-1/2 top-16 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border-2 border-ink bg-white py-1.5 pl-2 pr-1.5 hard-shadow"
    >
      <span className="flex items-center gap-1.5 rounded-full px-2 py-0.5 font-display text-[14px] font-bold text-ink" style={{ background: dayColor(dayNumber) }}>
        Day {dayNumber}
      </span>
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => value !== theme && onSetTheme(value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
        }}
        placeholder="主题,如「西湖环线」"
        className="w-36 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-soft/60"
      />
      {onOptimize ? (
        <button type="button" onClick={onOptimize} title="按就近顺序智能排程" className="flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 text-[12px] font-medium text-accent hover:bg-accent hover:text-white">
          <Wand2 size={12} /> 智能排程
        </button>
      ) : null}
      {onDelete ? (
        <button type="button" onClick={onDelete} title="删除这一天" className="flex h-7 w-7 items-center justify-center rounded-full text-ink-soft hover:bg-warn hover:text-warn-ink">
          <Trash2 size={13} />
        </button>
      ) : null}
    </div>
  );
}

const SHORT_KM_OPTIONS = [0.5, 1, 2, 3];

const MODES: Array<{ value: TransportMode; label: string; emoji: string }> = [
  { value: "walk", label: "步行", emoji: "🚶" },
  { value: "bike", label: "骑行", emoji: "🚲" },
  { value: "public", label: "公交", emoji: "🚌" },
  { value: "drive", label: "驾车", emoji: "🚗" }
];

/** 交通偏好:全部选择式,零输入 */
function TransportPrefsButton({ prefs, onSave }: { prefs?: TransportPrefs; onSave: (prefs: TransportPrefs) => void }) {
  const [open, setOpen] = useState(false);
  const [shortKm, setShortKm] = useState(prefs?.shortKm ?? 1);
  const [shortMode, setShortMode] = useState<TransportMode>(prefs?.shortMode ?? "walk");
  const [longMode, setLongMode] = useState<TransportMode>(prefs?.longMode ?? "public");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1 rounded-full border border-line bg-white px-3 py-1.5 text-[13px] font-medium text-ink transition-colors hover:border-accent hover:text-accent"
      >
        <Settings2 size={14} /> 交通偏好
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 space-y-3 rounded-[14px] border-2 border-ink bg-white p-3.5 hard-shadow">
          <PrefRow title="多近算短途">
            {SHORT_KM_OPTIONS.map((km) => (
              <Pill key={km} active={shortKm === km} onClick={() => setShortKm(km)}>
                {km < 1 ? `${km * 1000}m` : `${km}km`} 内
              </Pill>
            ))}
          </PrefRow>
          <PrefRow title="短途怎么走">
            {MODES.map((mode) => (
              <Pill key={mode.value} active={shortMode === mode.value} onClick={() => setShortMode(mode.value)}>
                {mode.emoji} {mode.label}
              </Pill>
            ))}
          </PrefRow>
          <PrefRow title="长途怎么走">
            {MODES.map((mode) => (
              <Pill key={mode.value} active={longMode === mode.value} onClick={() => setLongMode(mode.value)}>
                {mode.emoji} {mode.label}
              </Pill>
            ))}
          </PrefRow>
          <button
            type="button"
            onClick={() => {
              onSave({ shortKm, shortMode, longMode });
              setOpen(false);
            }}
            className="w-full rounded-full bg-accent py-2 text-[13px] font-semibold text-white transition-transform hover:-translate-y-px"
          >
            保存偏好
          </button>
        </div>
      ) : null}
    </div>
  );
}

function PrefRow({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 font-display text-[13px] font-bold text-ink">{title}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors ${
        active ? "border-ink bg-accent text-white" : "border-line bg-white text-ink hover:bg-accent-soft"
      }`}
    >
      {children}
    </button>
  );
}

function PoiSearch({ tripId, onAddPoi }: { tripId: string; onAddPoi: (poi: AmapPoi) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AmapPoi[]>([]);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  async function search() {
    if (!query.trim() || searching) return;
    setSearching(true);
    setOpen(true);
    setFailed(false);
    try {
      const response = await fetch(`/api/pois/search?tripId=${encodeURIComponent(tripId)}&q=${encodeURIComponent(query.trim())}`);
      if (!response.ok) throw new Error(`search ${response.status}`);
      setResults(await response.json());
      setAdded(new Set());
    } catch {
      setFailed(true);
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center gap-1 rounded-full border border-line bg-white py-1 pl-3 pr-1">
        <Search size={14} className="shrink-0 text-ink-soft" />
        <input
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void search();
          }}
          placeholder="搜地点…"
          className="w-32 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-soft/60"
          aria-label="搜索地点"
        />
        <button
          type="button"
          onClick={() => void search()}
          className="shrink-0 rounded-full bg-accent-soft px-2.5 py-1 text-[12px] font-semibold text-accent transition-colors hover:bg-accent hover:text-white"
        >
          搜索
        </button>
      </div>
      {open && (searching || failed || results.length > 0) ? (
        <div className="absolute right-0 top-full z-50 mt-2 max-h-96 w-80 overflow-y-auto overscroll-contain rounded-[14px] border-2 border-ink bg-white p-2 hard-shadow">
          {searching ? (
            <div className="flex items-center gap-2 p-2 text-[12px] text-ink-soft">
              <Sparkles size={13} className="animate-pulse" /> 搜索中…
            </div>
          ) : failed ? (
            <div className="p-2 text-[12px] text-warn-ink">搜索没成功(网络波动),再点一次「搜索」试试</div>
          ) : (
            <div className="space-y-1.5">
              {results.map((poi) => {
                const isAdded = added.has(poi.amapId);
                return (
                  <div key={poi.amapId} className="flex items-center gap-2 rounded-[10px] border border-line p-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold text-ink">{poi.name}</p>
                      {poi.address ? <p className="mt-0.5 truncate text-[11px] text-ink-soft">{poi.address}</p> : null}
                    </div>
                    <button
                      type="button"
                      disabled={isAdded}
                      onClick={() => {
                        onAddPoi(poi);
                        setAdded((prev) => new Set(prev).add(poi.amapId));
                      }}
                      className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                        isAdded ? "bg-muted text-ink-soft" : "bg-accent-soft text-accent hover:bg-accent hover:text-white"
                      }`}
                    >
                      {isAdded ? "已加入 ✓" : "加入待安排"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
