import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TripForm } from "./trip-form";
import { DayTimeline } from "./day-timeline";
import { DayMap } from "./day-map";
import { FailedLinksSection, FilteredSection } from "./filtered-section";

describe("TripForm", () => {
  it("validates required destination, counts normalized links, and disables themes when days are empty", async () => {
    render(<TripForm />);

    fireEvent.change(screen.getByLabelText("小红书链接"), { target: { value: "hello https://xhslink.com/a and https://example.com/no" } });
    expect(screen.getByText("识别到 1 条小红书链接")).toBeInTheDocument();
    expect(screen.getByLabelText("第 1 天主题")).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "生成行程" }));
    expect(await screen.findByText("请填写目的地")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("天数"), { target: { value: "2" } });
    expect(screen.getByLabelText("第 1 天主题")).not.toBeDisabled();
    expect(screen.getByLabelText("第 2 天主题")).not.toBeDisabled();
  });
});

describe("DayTimeline", () => {
  it("renders address, unknown openHours, unverified badge, and planning note", () => {
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
    expect(screen.getByText("中山东一路")).toBeInTheDocument();
    expect(screen.getByText("未知")).toBeInTheDocument();
    expect(screen.getByText("未验证")).toBeInTheDocument();
    expect(screen.getByText("覆盖笔记建议")).toBeInTheDocument();
    expect(screen.getByText(/15 min/)).toBeInTheDocument();
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
    render(<DayMap day={{ index: 1, items: [] }} />);
    expect(screen.getByText("地图 key 未配置")).toBeInTheDocument();
  });
});
