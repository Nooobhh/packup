"use client";

import React from "react";
import type { XY } from "./canvas-layout";
import { hash01 } from "./canvas-layout";

export type RoutePoint = XY & { key: string };

/** 二次贝塞尔控制点:中点沿法线伪随机偏移,手绘感 */
function controlPoint(a: XY, b: XY, seed: string): XY {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const k = (hash01(seed) - 0.5) * 2 * Math.min(46, len * 0.2);
  return { x: mx + (-dy / len) * k, y: my + (dx / len) * k };
}

/** 曲线中点(t=0.5),供交通徽章定位 */
export function segmentMid(a: XY, b: XY, seed: string): XY {
  const c = controlPoint(a, b, seed);
  return { x: 0.25 * a.x + 0.5 * c.x + 0.25 * b.x, y: 0.25 * a.y + 0.5 * c.y + 0.25 * b.y };
}

/** 展开态的手绘虚线路线(世界坐标 SVG 层) */
export function RouteLayer({ points, color }: { points: RoutePoint[]; color: string }) {
  if (points.length < 2) return null;
  return (
    <svg className="pointer-events-none absolute left-0 top-0 z-0 overflow-visible" width="1" height="1">
      {points.slice(0, -1).map((from, index) => {
        const to = points[index + 1];
        const c = controlPoint(from, to, `${from.key}->${to.key}`);
        return (
          <g key={`${from.key}-${to.key}`}>
            <path
              d={`M ${from.x} ${from.y} Q ${c.x} ${c.y} ${to.x} ${to.y}`}
              fill="none"
              stroke={color}
              strokeWidth={3.5}
              strokeLinecap="round"
              strokeDasharray="9 10"
            />
            <ArrowHead from={c} to={to} color={color} />
          </g>
        );
      })}
    </svg>
  );
}

function ArrowHead({ from, to, color }: { from: XY; to: XY; color: string }) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const size = 11;
  const back = { x: to.x - Math.cos(angle) * 26, y: to.y - Math.sin(angle) * 26 };
  const left = {
    x: back.x - Math.cos(angle - Math.PI / 2) * (size / 2),
    y: back.y - Math.sin(angle - Math.PI / 2) * (size / 2)
  };
  const right = {
    x: back.x + Math.cos(angle - Math.PI / 2) * (size / 2),
    y: back.y + Math.sin(angle - Math.PI / 2) * (size / 2)
  };
  const tip = { x: back.x + Math.cos(angle) * size, y: back.y + Math.sin(angle) * size };
  return <polygon points={`${tip.x},${tip.y} ${left.x},${left.y} ${right.x},${right.y}`} fill={color} />;
}
