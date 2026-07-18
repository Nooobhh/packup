"use client";

import React from "react";
import type { PlanDay } from "@/lib/pipeline/types";
import type { ItemGroup } from "./canvas-layout";
import { FOLDER_H, FOLDER_W, dayColor, stickerTilt } from "./canvas-layout";
import { MiniSticker } from "./poi-sticker";

const MAX_STACK = 4;

/** 日程文件夹贴纸:收起时 docked 卡叠在封面,展开时换开盖素材 */
export function DayFolder({
  day,
  dayNumber,
  expanded,
  dropHover,
  dockedGroups,
  faded
}: {
  day: PlanDay;
  dayNumber: number;
  expanded: boolean;
  dropHover: boolean;
  dockedGroups: ItemGroup[];
  faded?: boolean;
}) {
  const tilt = stickerTilt(`folder:${dayNumber}`, 5);
  const color = dayColor(dayNumber);
  const stack = dockedGroups.slice(0, MAX_STACK);
  const overflow = dockedGroups.length - stack.length;

  return (
    <div
      data-canvas-item="folder"
      data-day={dayNumber}
      className={`select-none ${faded ? "pointer-events-none opacity-10" : ""}`}
      style={{ width: FOLDER_W, height: FOLDER_H, transition: "opacity 180ms ease-out" }}
    >
      <div
        className="relative h-full w-full"
        style={{
          transform: `rotate(${tilt}deg) scale(${dropHover ? 1.06 : 1})`,
          transition: "transform 180ms ease-out",
          filter: dropHover ? "drop-shadow(0 0 14px var(--accent-bright))" : undefined
        }}
      >
        {/* Day 色签条:贴在文件夹图形上缘 */}
        <div
          className="absolute left-4 top-3 z-20 flex max-w-[180px] items-center gap-1.5 rounded-[8px] border-2 border-ink px-2.5 py-0.5 hard-shadow"
          style={{ background: color, transform: `rotate(${-tilt * 0.6}deg)` }}
        >
          <span className="font-display text-[14px] font-bold leading-tight text-ink">Day {dayNumber}</span>
          {day.theme ? <span className="truncate text-[11px] font-medium text-ink/75">{day.theme}</span> : null}
        </div>

        {/* 叠放的迷你贴纸(压在文件夹后面,露出上缘) */}
        {!expanded && stack.length > 0 ? (
          <div className="absolute inset-x-0 -top-9 z-0 h-16">
            {stack.map((group, index) => (
              <MiniSticker key={group.id} group={group} index={index} />
            ))}
          </div>
        ) : null}

        <img
          src={expanded ? "/stickers/folder-open.png" : "/stickers/folder.png"}
          alt={`Day ${dayNumber} 文件夹`}
          draggable={false}
          className="sticker-drop relative z-10 h-full w-full object-contain"
        />

        {/* 数量角标 / 溢出角标 */}
        <div className="absolute -bottom-2 -right-2 z-20 flex items-center gap-1">
          {overflow > 0 && !expanded ? (
            <span className="rounded-full border-2 border-ink bg-white px-2 py-0.5 text-[11px] font-bold text-ink hard-shadow">+{overflow}</span>
          ) : null}
          <span
            className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-ink text-[13px] font-bold text-ink hard-shadow"
            style={{ background: day.items.length ? "var(--accent-soft)" : "#fff" }}
          >
            {day.items.length}
          </span>
        </div>

        {expanded ? (
          <span className="absolute -bottom-7 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-full border border-line bg-white px-2.5 py-0.5 text-[11px] text-ink-soft">
            再点一下收起
          </span>
        ) : null}
      </div>
    </div>
  );
}
