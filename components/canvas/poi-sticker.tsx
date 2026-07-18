"use client";

import React from "react";
import type { ItemGroup } from "./canvas-layout";
import { STICKER_W, dayColor, stickerTilt } from "./canvas-layout";

const TYPE_STICKER: Record<string, string> = {
  sight: "/stickers/poi-sight.png",
  food: "/stickers/poi-food.png",
  shop: "/stickers/poi-shop.png",
  stay: "/stickers/poi-stay.png",
  experience: "/stickers/poi-experience.png",
  other: "/stickers/poi-other.png"
};

export function stickerSrc(type: string | undefined): string {
  return TYPE_STICKER[type ?? "other"] ?? TYPE_STICKER.other;
}

/** 地点贴纸卡:die-cut 涂鸦贴纸 + 名称签。位置/拖拽由父层管理。 */
export function PoiSticker({
  group,
  dayNumber,
  selected,
  dragging,
  dropTarget,
  faded,
  order
}: {
  group: ItemGroup;
  dayNumber?: number;
  selected?: boolean;
  dragging?: boolean;
  /** 作为 reorder 目标被悬停 */
  dropTarget?: boolean;
  /** 其他文件夹展开时淡出 */
  faded?: boolean;
  /** 展开态序号(1 起);undefined 不显示 */
  order?: number;
}) {
  const item = group.items[0];
  const name = item.name ?? item.poi?.name ?? "未命名";
  const type = (item.type ?? item.poi?.type ?? "other") as string;
  const unverified = (item.verified ?? item.poi?.verified) === false;
  const totalMin = group.items.reduce((sum, it) => sum + (it.durationMin ?? 0), 0);
  const tilt = stickerTilt(group.id);

  return (
    <div
      data-canvas-item="poi"
      data-item-id={group.id}
      className={`group select-none ${faded ? "pointer-events-none opacity-10" : ""} ${dragging ? "z-50" : selected ? "z-30" : "z-10"}`}
      style={{ width: STICKER_W, transition: faded !== undefined ? "opacity 180ms ease-out" : undefined }}
    >
      <div
        className="relative flex flex-col items-center"
        style={{
          transform: `rotate(${dragging ? 0 : tilt}deg) scale(${dragging ? 1.07 : 1})`,
          transition: "transform 180ms ease-out"
        }}
      >
        {order !== undefined ? (
          <span
            className="absolute -left-1 -top-1 z-10 flex h-7 w-7 items-center justify-center rounded-full border-2 border-ink bg-white text-sm font-bold text-ink hard-shadow"
            style={{ transform: `rotate(${-tilt}deg)` }}
          >
            {order}
          </span>
        ) : null}
        <img
          src={stickerSrc(type)}
          alt={type}
          draggable={false}
          className={`sticker-drop h-24 w-24 object-contain ${dragging ? "" : "transition-transform duration-200 group-hover:-translate-y-1"}`}
        />
        <div
          className={`-mt-2 w-full rounded-[10px] border bg-white px-2.5 py-1.5 text-center ${
            selected ? "border-accent shadow-[0_0_0_3px_var(--accent-soft)]" : dropTarget ? "border-accent" : "border-line"
          } ${dragging ? "shadow-[0_10px_28px_rgba(27,27,31,0.18)]" : "hard-shadow"}`}
        >
          <p className="truncate text-[13px] font-semibold leading-tight text-ink" title={name}>
            {shortName(name)}
          </p>
          <div className="mt-0.5 flex items-center justify-center gap-1.5 text-[11px] text-ink-soft">
            {dayNumber ? (
              <span className="inline-block h-2 w-2 rounded-full border border-ink/50" style={{ background: dayColor(dayNumber) }} />
            ) : null}
            <span>{totalMin ? `${totalMin} 分钟` : type}</span>
            {unverified ? (
              <span className="rounded-full bg-warn px-1.5 py-px font-medium text-warn-ink">未验证</span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 「杭州西湖风景名胜区-断桥残雪」→「断桥残雪」:取最后一段更适合小签 */
export function shortName(name: string): string {
  const parts = name.split(/[-·—]/).filter(Boolean);
  const last = parts.at(-1)?.trim();
  return last && last.length >= 2 ? last : name;
}

/** docked 叠放态的迷你贴纸(渲染于文件夹内部) */
export function MiniSticker({ group, index }: { group: ItemGroup; index: number }) {
  const item = group.items[0];
  const type = (item.type ?? item.poi?.type ?? "other") as string;
  const tilt = stickerTilt(`${group.id}:mini`, 14);
  return (
    <div
      data-canvas-item="poi"
      data-item-id={group.id}
      className="absolute select-none"
      style={{
        left: 34 + index * 26,
        top: 8 - (index % 2) * 6,
        transform: `rotate(${tilt}deg)`,
        zIndex: 5 + index
      }}
      title={item.name ?? item.poi?.name}
    >
      <img src={stickerSrc(type)} alt={type} draggable={false} className="sticker-drop h-14 w-14 object-contain" />
    </div>
  );
}
