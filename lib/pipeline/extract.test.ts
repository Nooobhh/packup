import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import type { LLMRunner } from "@/lib/llm/types";
import { buildExtractPrompt } from "@/lib/prompts/extract";
import { runExtract } from "./extract";
import type { Note, TripInput } from "./types";

const input: TripInput = {
  links: ["https://xhslink.com/1"],
  destination: "上海",
  days: { base: 2, flex: 0 },
  transport: "public",
  pace: "moderate"
};

function note(id: string, images: string[] = [], body = "正文"): Note {
  return { id, url: `manual://${id}`, title: id, body, images, fetchStatus: "ok" };
}

describe("runExtract", () => {
  it("calls the LLM for text/image and pure-image notes and passes image paths", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify({ pois: [poi("外滩", "n1", "text")], filtered: [] }))
      .mockResolvedValueOnce(JSON.stringify({ pois: [poi("武康路", "n2", "image")], filtered: [] }));

    const workDir = path.join(process.cwd(), "data/trips/trip-test");
    const result = await runExtract([note("n1", ["a.jpg"]), note("n2", ["b.jpg"], "")], input, { run }, { workDir });

    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0][0].images).toEqual([path.join(workDir, "a.jpg")]);
    expect(run.mock.calls[1][0].images).toEqual([path.join(workDir, "b.jpg")]);
    expect(result.pois.map((item) => item.name)).toEqual(["外滩", "武康路"]);
  });

  it("caps per-note LLM concurrency at three", async () => {
    let active = 0;
    let maxActive = 0;
    const llm: LLMRunner = {
      run: vi.fn(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return JSON.stringify({ pois: [], filtered: [] });
      })
    };

    await runExtract([note("a"), note("b"), note("c"), note("d"), note("e")], input, llm);

    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it("normalizes filtered items to stage extract with sourceNoteId and keeps going after one note fails", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify({ pois: [], filtered: [{ name: "广告", reason: "商业内容" }] }))
      .mockRejectedValueOnce(new Error("model down"))
      .mockResolvedValueOnce(JSON.stringify({ pois: [poi("豫园", "n3", "text")], filtered: [] }));

    const result = await runExtract([note("n1"), note("n2"), note("n3")], input, { run });

    expect(result.filtered[0]).toMatchObject({ name: "广告", sourceNoteId: "n1", stage: "extract", reason: "商业内容" });
    expect(result.failedNotes).toEqual([{ noteId: "n2", reason: "model down" }]);
    expect(result.pois).toHaveLength(1);
  });

  it("retries once when LLM output fails zod validation", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify({ pois: [{ name: "" }], filtered: [] }))
      .mockResolvedValueOnce(JSON.stringify({ pois: [poi("徐家汇", "n1", "text")], filtered: [] }));

    const result = await runExtract([note("n1")], input, { run });

    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][0].prompt).toContain("上次输出未通过校验");
    expect(result.pois[0].name).toBe("徐家汇");
  });

  it("skips fetch-failed notes without adding failedNotes", async () => {
    const failed: Note = { ...note("bad"), fetchStatus: "failed", failReason: "xhs failed" };
    const result = await runExtract([failed], input, { run: vi.fn() });
    expect(result).toEqual({ pois: [], filtered: [], failedNotes: [] });
  });
});

describe("buildExtractPrompt", () => {
  it("contains destination filtering and original-voice reason instructions", () => {
    const prompt = buildExtractPrompt(note("n1"), input);
    expect(prompt).toContain("目的地");
    expect(prompt).toContain("无关内容");
    expect(prompt).toContain("原文口吻");
    expect(prompt).toContain("真实地点");
  });
});

function poi(name: string, sourceNoteId: string, sourceType: "text" | "image") {
  return {
    name,
    type: "sight",
    city: "上海",
    reason: "笔记说很值得去",
    sourceNoteId,
    sourceType
  };
}
