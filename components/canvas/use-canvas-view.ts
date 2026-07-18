"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { XY } from "./canvas-layout";

export type CanvasView = { tx: number; ty: number; scale: number };

export const MIN_SCALE = 0.3;
export const MAX_SCALE = 2.5;

/**
 * 无限画布视图变换:滚轮平移、ctrl/cmd+滚轮(触板捏合)缩放、空白拖拽平移。
 * screen = world * scale + t
 */
export function useCanvasView(viewportRef: React.RefObject<HTMLDivElement | null>) {
  const [view, setView] = useState<CanvasView>({ tx: 0, ty: 0, scale: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;

  const toWorld = useCallback((screen: XY): XY => {
    const v = viewRef.current;
    const rect = viewportRef.current?.getBoundingClientRect();
    const sx = screen.x - (rect?.left ?? 0);
    const sy = screen.y - (rect?.top ?? 0);
    return { x: (sx - v.tx) / v.scale, y: (sy - v.ty) / v.scale };
  }, [viewportRef]);

  const zoomAt = useCallback((screen: XY, factor: number) => {
    setView((v) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
      if (scale === v.scale) return v;
      const rect = viewportRef.current?.getBoundingClientRect();
      const sx = screen.x - (rect?.left ?? 0);
      const sy = screen.y - (rect?.top ?? 0);
      const k = scale / v.scale;
      return { scale, tx: sx - (sx - v.tx) * k, ty: sy - (sy - v.ty) * k };
    });
  }, [viewportRef]);

  const panBy = useCallback((dx: number, dy: number) => {
    setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
  }, []);

  /**
   * 让世界坐标包围盒适配视口;布局未就绪(尺寸 0)时按帧重试。
   * padRight 用于扣除被浮动 UI(地图小窗/右栏)占据的宽度,让内容在剩余区域居中。
   */
  const fitBounds = useCallback(
    (min: XY, max: XY, opts: { animateMs?: number; onSettled?: () => void; padRight?: number } = {}, attempt = 0) => {
      const el = viewportRef.current;
      if (!el) return;
      if ((el.clientWidth === 0 || el.clientHeight === 0) && attempt < 30) {
        requestAnimationFrame(() => fitBounds(min, max, opts, attempt + 1));
        return;
      }
      const { animateMs = 0, onSettled, padRight = 0 } = opts;
      const pad = 72;
      const vw = Math.max(240, el.clientWidth - padRight);
      const vh = el.clientHeight;
      const bw = Math.max(1, max.x - min.x);
      const bh = Math.max(1, max.y - min.y);
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min((vw - pad * 2) / bw, (vh - pad * 2) / bh, 1)));
      const tx = (vw - bw * scale) / 2 - min.x * scale;
      const ty = (vh - bh * scale) / 2 - min.y * scale;
      if (animateMs > 0) {
        animateView(viewRef.current, { tx, ty, scale }, animateMs, setView);
      } else {
        setView({ tx, ty, scale });
      }
      onSettled?.();
    },
    [viewportRef]
  );

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      // 浮动 UI(顶栏/地图/抽屉/搜索结果)内的滚动交还给浏览器
      if ((event.target as HTMLElement).closest?.("[data-canvas-ui]")) return;
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const factor = Math.exp(-event.deltaY * 0.0022);
        zoomAt({ x: event.clientX, y: event.clientY }, factor);
      } else {
        panBy(-event.deltaX, -event.deltaY);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [viewportRef, zoomAt, panBy]);

  return { view, setView, toWorld, zoomAt, panBy, fitBounds };
}

function animateView(from: CanvasView, to: CanvasView, ms: number, set: (v: CanvasView) => void) {
  const start = performance.now();
  const tick = (now: number) => {
    const t = Math.min(1, (now - start) / ms);
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2; // easeInOut
    set({
      tx: from.tx + (to.tx - from.tx) * e,
      ty: from.ty + (to.ty - from.ty) * e,
      scale: from.scale + (to.scale - from.scale) * e
    });
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
