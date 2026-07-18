"use client";

import React, { useMemo, useState } from "react";
import { normalizeLinks } from "@/lib/fetchers/normalize";
import type { StageEvent } from "@/lib/pipeline/types";
import { ProgressStream } from "./progress-stream";

const PREF_OPTIONS: Array<{ key: string; label: string; emoji: string }> = [
  { key: "city walk", label: "city walk", emoji: "🚶" },
  { key: "美食探店", label: "美食探店", emoji: "🍜" },
  { key: "拍照打卡", label: "拍照打卡", emoji: "📸" },
  { key: "购物", label: "购物", emoji: "🛍" },
  { key: "亲子", label: "亲子", emoji: "🧸" },
  { key: "深度文化", label: "深度文化", emoji: "🏛" },
  { key: "自然户外", label: "自然户外", emoji: "🌿" },
  { key: "夜生活", label: "夜生活", emoji: "🍸" }
];

export function TripForm() {
  const [destination, setDestination] = useState("");
  const [days, setDays] = useState("3");
  const [preferences, setPreferences] = useState<Set<string>>(new Set());
  const [linksText, setLinksText] = useState("");
  const [events, setEvents] = useState<StageEvent[]>([]);
  const [error, setError] = useState("");
  const [tripId, setTripId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const links = useMemo(() => normalizeLinks(linksText), [linksText]);
  const daysNum = Number(days);
  const daysValid = Number.isInteger(daysNum) && daysNum >= 1 && daysNum <= 15;
  const hasLinks = links.length > 0;

  function togglePref(key: string) {
    setPreferences((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /**
   * 两个 CTA 常驻可点(仅 submitting 时禁用),缺失项在点击时以提示条说明并聚焦到该字段 ——
   * 置灰按钮不告诉用户「差什么」,点击后给理由比让按钮变灰更好用。
   */
  function checkBase(): boolean {
    if (destination.trim().length === 0) {
      setError("请先填写城市 / 目的地");
      document.getElementById("destination")?.focus();
      return false;
    }
    if (!daysValid) {
      setError("天数请填 1–15 之间的整数");
      document.getElementById("days")?.focus();
      return false;
    }
    return true;
  }

  async function submitEmpty() {
    if (submitting) return;
    setError("");
    if (!checkBase()) return;
    setSubmitting(true);
    try {
      const prefsArr = Array.from(preferences);
      const response = await fetch("/api/trips", {
        method: "POST",
        body: JSON.stringify({
          destination: destination.trim(),
          days: { base: daysNum },
          ...(prefsArr.length ? { preferences: prefsArr } : {})
        })
      });
      if (!response.ok) {
        setError("创建空画布失败");
        return;
      }
      const payload = await response.json();
      window.location.href = `/trip/${payload.tripId}`;
    } finally {
      setSubmitting(false);
    }
  }

  async function submitGenerate(mode: "plan" | "pool") {
    if (submitting) return;
    setError("");
    if (!checkBase()) return;
    if (!hasLinks) {
      setError(mode === "plan" ? "「打包行程」需要小红书笔记链接;没有链接就点右边开一张空画布" : "「提取地点创建画布」需要小红书笔记链接");
      document.getElementById("links")?.focus();
      return;
    }
    setTripId("");
    setEvents([]);
    setSubmitting(true);
    try {
      const prefsArr = Array.from(preferences);
      const response = await fetch("/api/generate", {
        method: "POST",
        body: JSON.stringify({
          destination: destination.trim(),
          days: { base: daysNum },
          links,
          mode,
          ...(prefsArr.length ? { preferences: prefsArr } : {})
        })
      });
      if (!response.ok || !response.body) {
        setError("生成请求失败");
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const line = chunk.split("\n").find((item) => item.startsWith("data: "));
          if (!line) continue;
          const payload = JSON.parse(line.slice(6));
          if (typeof payload.tripId === "string") setTripId(payload.tripId);
          if (payload.status === "await-selection") {
            window.location.href = `/trip/${payload.tripId}/select`;
            return;
          }
          if (payload.status === "pool-ready") {
            window.location.href = `/trip/${payload.tripId}`;
            return;
          }
          if (payload.status === "error") setError("已完成段保留,可重跑");
          if (isStageEvent(payload)) setEvents((old) => [...old, payload]);
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-paper">
      {/* 极淡点阵底 */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{ backgroundImage: "radial-gradient(circle, #e9e6df 1.3px, transparent 1.3px)", backgroundSize: "26px 26px" }}
      />
      <StickerDecor />

      <div className="relative mx-auto max-w-2xl px-6 pb-28 pt-12">
        {/* logo 贴纸 */}
        <div className="flex justify-center">
          <img src="/stickers/logo-wordmark.png" alt="packup" className="sticker-drop h-12 -rotate-1 select-none" draggable={false} />
        </div>

        {/* hero */}
        <h1 className="font-display mt-12 text-center text-[44px] font-bold leading-[1.15] text-ink sm:text-[52px]">
          把想去的地方,
          <br />
          打包成一张行程画布
        </h1>
        <p className="font-display mx-auto mt-5 max-w-md text-center text-[16px] leading-relaxed text-ink-soft">
          填城市/天数/偏好,粘小红书链接 3 分钟摊开可拖拽的旅行计划;没链接也能直接开一张空画布慢慢摆。
        </p>

        {/* 主输入卡 */}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            // 回车默认走「首个可用主 CTA」:有链接=打包行程;无链接=空白画布
            if (hasLinks) void submitGenerate("plan");
            else void submitEmpty();
          }}
          className="mt-12 space-y-6 rounded-[18px] border-[3px] border-ink bg-white p-6 hard-shadow"
        >
          {/* 城市 + 天数 */}
          <div className="grid gap-4 sm:grid-cols-[1fr_128px]">
            <label className="block">
              <span className="font-display text-[15px] font-bold text-ink">城市 / 目的地</span>
              <input
                id="destination"
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
                placeholder="如「杭州」「香港」「东京」"
                aria-label="目的地"
                className="mt-2 w-full rounded-[10px] border border-line bg-paper px-3.5 py-3 text-[14px] text-ink outline-none transition-colors placeholder:text-ink-soft/50 focus:border-accent focus:bg-white"
              />
            </label>
            <label className="block">
              <span className="font-display text-[15px] font-bold text-ink">天数</span>
              <input
                id="days"
                type="number"
                min={1}
                max={15}
                value={days}
                onChange={(event) => setDays(event.target.value)}
                aria-label="天数"
                className="mt-2 w-full rounded-[10px] border border-line bg-paper px-3.5 py-3 text-[14px] text-ink outline-none transition-colors focus:border-accent focus:bg-white"
              />
            </label>
          </div>

          {/* 偏好 chips */}
          <div>
            <div className="flex items-baseline justify-between">
              <span className="font-display text-[15px] font-bold text-ink">旅行偏好</span>
              <span className="text-[11px] text-ink-soft">可多选 · 选填</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {PREF_OPTIONS.map((opt) => {
                const active = preferences.has(opt.key);
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => togglePref(opt.key)}
                    aria-pressed={active}
                    className={`rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors ${
                      active ? "border-ink bg-accent-soft text-accent" : "border-line bg-paper text-ink-soft hover:border-ink hover:text-ink"
                    }`}
                  >
                    <span className="mr-1">{opt.emoji}</span>
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 小红书链接(选填) */}
          <div>
            <div className="flex items-baseline justify-between">
              <label htmlFor="links" className="font-display text-[15px] font-bold text-ink">
                小红书链接
              </label>
              <span
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                  hasLinks ? "bg-accent-soft text-accent" : "bg-muted text-ink-soft"
                }`}
              >
                {hasLinks ? `识别到 ${links.length} 条` : "选填"}
              </span>
            </div>
            <textarea
              id="links"
              value={linksText}
              onChange={(event) => setLinksText(event.target.value)}
              placeholder={"有链接 = 从笔记打包好行程;没链接 = 开一张空画布自己搜地点。\nhttp://xhslink.com/…\nhttps://www.xiaohongshu.com/explore/…"}
              className="mt-2 min-h-32 w-full resize-y rounded-[10px] border border-line bg-paper px-3.5 py-3 text-[13px] leading-relaxed text-ink outline-none transition-colors placeholder:text-ink-soft/50 focus:border-accent focus:bg-white"
            />
          </div>

          {error ? (
            <p className="rounded-full border-2 border-ink bg-warn px-4 py-1.5 text-center text-[13px] font-medium text-warn-ink">{error}</p>
          ) : null}
          {tripId ? (
            <p className="rounded-[10px] bg-paper px-3 py-2 text-[13px] text-ink-soft">
              行程 ID:{tripId},中断后可访问{" "}
              <a className="text-accent underline decoration-dotted underline-offset-2" href={`/trip/${tripId}/select`}>
                /trip/{tripId}/select
              </a>{" "}
              继续
            </p>
          ) : null}

          {/* 两个入口常驻同行,尺寸/视觉不随输入变化 —— 副按钮文案随 hasLinks 切换:
              有链接=提取地点创建画布(走 pool mode);没链接=空白画布(走 /api/trips)。 */}
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => void submitGenerate("plan")}
              disabled={submitting}
              className={`font-display rounded-full border-2 py-3 text-[15px] font-bold transition-transform ${
                submitting ? "cursor-wait border-accent/70 bg-accent/70 text-white" : "border-accent bg-accent text-white hover:-translate-y-0.5"
              }`}
            >
              {submitting && hasLinks ? "打包中,别走开…" : "打包行程"}
            </button>
            <button
              type="button"
              onClick={() => (hasLinks ? void submitGenerate("pool") : void submitEmpty())}
              disabled={submitting}
              className={`font-display rounded-full border-2 py-3 text-[15px] font-bold transition-transform ${
                submitting
                  ? "cursor-not-allowed border-line bg-muted text-ink-soft/60"
                  : "border-ink bg-white text-ink hover:bg-accent-soft hover:-translate-y-0.5"
              }`}
            >
              {hasLinks ? "提取地点创建画布" : "空白画布"}
            </button>
          </div>
        </form>

        <ProgressStream events={events} />
      </div>
    </main>
  );
}

/** 页面四角的涂鸦贴纸装饰(纯装饰,窄屏隐藏) */
function StickerDecor() {
  const stickers = [
    { src: "/stickers/poi-sight.png", className: "left-[6%] top-[16%] w-24 -rotate-[8deg]" },
    { src: "/stickers/poi-food.png", className: "right-[7%] top-[13%] w-28 rotate-6" },
    { src: "/stickers/folder.png", className: "left-[8%] top-[58%] w-28 -rotate-6" },
    { src: "/stickers/poi-experience.png", className: "right-[6%] top-[55%] w-32 rotate-[4deg]" },
    { src: "/stickers/poi-shop.png", className: "right-[14%] top-[82%] w-20 -rotate-[10deg]" },
    { src: "/stickers/poi-stay.png", className: "left-[15%] top-[86%] w-24 rotate-[8deg]" }
  ];
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 hidden select-none lg:block">
      {stickers.map((sticker) => (
        <img key={sticker.src} src={sticker.src} alt="" className={`sticker-drop absolute ${sticker.className}`} />
      ))}
    </div>
  );
}

function isStageEvent(value: unknown): value is StageEvent {
  return typeof value === "object" && value !== null && "stage" in value && "status" in value;
}
