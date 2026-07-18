"use client";

import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { PlanItem } from "@/lib/pipeline/types";
import { dayColor, itemKey } from "./canvas-layout";
import { stickerSrc } from "./poi-sticker";

export type DrawerNote = { id: string; title: string; author?: string; url: string; images: string[] };

const TYPE_LABEL: Record<string, string> = {
  sight: "景点",
  food: "美食",
  shop: "购物",
  stay: "住宿",
  experience: "体验",
  other: "地点"
};

/** 点击贴纸卡后的详情抽屉(贴纸风) */
export function CanvasDrawer({
  item,
  dayNumber,
  note,
  dayCount,
  mapExpanded,
  onClose,
  onEdit,
  onReturnToPool,
  onPlaceToDay,
  onRemove
}: {
  item: PlanItem;
  dayNumber?: number;
  note?: DrawerNote;
  dayCount: number;
  /** 地图右栏展开时,抽屉改盖在右栏下半;地图收起时占右上(地图小窗上方) */
  mapExpanded: boolean;
  onClose: () => void;
  onEdit: (set: { note?: string; startTime?: string; durationMin?: number }) => void;
  onReturnToPool?: () => void;
  onPlaceToDay?: (day: number) => void;
  onRemove?: () => void;
}) {
  const key = itemKey(item);
  const [startTime, setStartTime] = useState(item.startTime ?? "");
  const [durationMin, setDurationMin] = useState(String(item.durationMin ?? 60));
  const [noteText, setNoteText] = useState(item.note ?? "");
  useEffect(() => {
    setStartTime(item.startTime ?? "");
    setDurationMin(String(item.durationMin ?? 60));
    setNoteText(item.note ?? "");
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- 换卡时重置表单

  const name = item.name ?? item.poi?.name ?? "未命名";
  const type = (item.type ?? item.poi?.type ?? "other") as string;
  const reason = item.reason ?? item.poi?.reason;
  const address = item.address ?? item.poi?.address;
  const openHours = item.openHours ?? item.poi?.openHours;
  const rating = item.poi?.rating;
  const unverified = (item.verified ?? item.poi?.verified) === false;

  function submit() {
    onEdit({
      note: noteText || undefined,
      startTime: /^\d{2}:\d{2}$/.test(startTime) ? startTime : undefined,
      durationMin: Number(durationMin) > 0 ? Number(durationMin) : undefined
    });
  }

  return (
    <aside
      data-canvas-ui
      className="fixed z-50 flex flex-col overflow-hidden rounded-[16px] border-[3px] border-ink bg-white hard-shadow"
      style={
        mapExpanded
          ? // 右栏形态:浮在地图下半之上(覆盖,不压缩地图)
            { right: 12, bottom: 12, width: "calc(min(38vw, 720px) - 24px)", top: "52vh" }
          : // 小窗形态:与地图同宽对齐成一列(顶栏下、地图上方)
            { right: 20, top: 72, width: 420, maxHeight: "calc(100vh - 72px - 396px)" }
      }
      aria-label="地点详情"
    >
      <header className="flex items-start gap-3 border-b-2 border-ink bg-paper px-4 py-3">
        <img src={stickerSrc(type)} alt={type} className="sticker-drop h-14 w-14 shrink-0 object-contain" />
        <div className="min-w-0 flex-1 pt-0.5">
          <h2 className="font-display text-lg font-bold leading-snug text-ink">{name}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="rounded-full bg-accent-soft px-2 py-0.5 font-medium text-accent">{TYPE_LABEL[type] ?? type}</span>
            {dayNumber ? (
              <span className="flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-ink-soft">
                <i className="h-2 w-2 rounded-full border border-ink/50" style={{ background: dayColor(dayNumber) }} />
                Day {dayNumber}
              </span>
            ) : (
              <span className="rounded-full border border-line px-2 py-0.5 text-ink-soft">待安排</span>
            )}
            {unverified ? <span className="rounded-full bg-warn px-2 py-0.5 font-medium text-warn-ink">未验证</span> : null}
            {rating ? <span className="rounded-full border border-line px-2 py-0.5 text-ink-soft">评分 {rating}</span> : null}
          </div>
        </div>
        <button type="button" onClick={onClose} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line bg-white text-ink hover:bg-accent-soft" aria-label="关闭详情">
          <X size={14} />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 text-sm">
        {reason ? (
          <blockquote className="rounded-[10px] border border-line bg-paper px-3 py-2 text-[13px] leading-relaxed text-ink">“{reason}”</blockquote>
        ) : null}

        <dl className="space-y-1.5 text-[13px]">
          {address ? <Row label="地址">{address}</Row> : null}
          {openHours ? <Row label="营业">{openHours}</Row> : null}
          {note?.title ? (
            <Row label="来源">
              <a href={note.url} target="_blank" rel="noreferrer" className="text-accent underline decoration-dotted underline-offset-2">
                {note.title}
              </a>
              {note.author ? <span className="text-ink-soft"> · {note.author}</span> : null}
            </Row>
          ) : null}
        </dl>

        {note?.images.length ? (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {note.images.map((src) => (
              <img key={src} src={src} alt="来源笔记图片" loading="lazy" className="h-24 w-24 shrink-0 rounded-[10px] border border-line object-cover" />
            ))}
          </div>
        ) : null}

        <fieldset className="space-y-2 rounded-[12px] border border-line p-3">
          <legend className="px-1 text-[12px] font-semibold text-ink-soft">安排</legend>
          <div className="flex gap-2">
            <label className="flex-1 text-[12px] text-ink-soft">
              开始时间
              <input value={startTime} onChange={(event) => setStartTime(event.target.value)} placeholder="09:30" className="mt-1 w-full rounded-[8px] border border-line px-2 py-1.5 text-[13px] text-ink outline-none focus:border-accent" />
            </label>
            <label className="flex-1 text-[12px] text-ink-soft">
              停留(分钟)
              <input value={durationMin} onChange={(event) => setDurationMin(event.target.value)} className="mt-1 w-full rounded-[8px] border border-line px-2 py-1.5 text-[13px] text-ink outline-none focus:border-accent" />
            </label>
          </div>
          <label className="block text-[12px] text-ink-soft">
            备注
            <input value={noteText} onChange={(event) => setNoteText(event.target.value)} placeholder="想去的理由、提醒…" className="mt-1 w-full rounded-[8px] border border-line px-2 py-1.5 text-[13px] text-ink outline-none focus:border-accent" />
          </label>
          <button type="button" onClick={submit} className="w-full rounded-full bg-accent py-1.5 text-[13px] font-semibold text-white transition-transform hover:-translate-y-px">
            保存修改
          </button>
        </fieldset>
      </div>

      <footer className="border-t border-line bg-paper px-4 py-3">
        {dayNumber && onReturnToPool ? (
          <button type="button" onClick={onReturnToPool} className="w-full rounded-full border border-line bg-white py-1.5 text-[13px] font-medium text-ink transition-colors hover:border-accent hover:text-accent">
            移回待安排池
          </button>
        ) : null}
        {!dayNumber && onPlaceToDay && dayCount > 0 ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {Array.from({ length: dayCount }, (_, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => onPlaceToDay(index + 1)}
                  className="flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:border-accent hover:text-accent"
                >
                  <i className="h-2 w-2 rounded-full border border-ink/50" style={{ background: dayColor(index + 1) }} />
                  放入 Day {index + 1}
                </button>
              ))}
            </div>
            {onRemove ? (
              <button
                type="button"
                onClick={() => window.confirm(`删除「${name}」?此操作不可撤销`) && onRemove()}
                className="w-full rounded-full border border-warn bg-white py-1.5 text-[12px] font-medium text-warn-ink transition-colors hover:bg-warn"
              >
                删除这个地点
              </button>
            ) : null}
          </div>
        ) : null}
      </footer>
    </aside>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-9 shrink-0 text-ink-soft">{label}</dt>
      <dd className="min-w-0 flex-1 text-ink">{children}</dd>
    </div>
  );
}
