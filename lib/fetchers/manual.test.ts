import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ContentFetcher } from "./types";
import { ManualFetcher } from "./manual";

describe("ManualFetcher", () => {
  it("implements ContentFetcher", () => {
    const fetcher: ContentFetcher = new ManualFetcher();
    expect(fetcher).toBeInstanceOf(ManualFetcher);
  });

  it("reads markdown notes and colocated images from workDir/manual", async () => {
    const workDir = path.join(__dirname, "__fixtures__/manual/two-notes");
    const notes = await new ManualFetcher().fetch([], workDir);

    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatchObject({
      id: "note-a",
      title: "第一篇标题",
      body: "正文第一行\n正文第二行",
      fetchStatus: "ok"
    });
    expect(notes[0].images).toEqual(["manual/note-a/photo-1.jpg"]);
    expect(notes[1]).toMatchObject({
      id: "note-b",
      title: "第二篇标题",
      images: []
    });
  });

  it("returns an empty array when manual directory is missing or empty", async () => {
    await expect(new ManualFetcher().fetch([], path.join(__dirname, "__fixtures__/missing"))).resolves.toEqual([]);
    await expect(new ManualFetcher().fetch([], path.join(__dirname, "__fixtures__/manual/empty"))).resolves.toEqual([]);
  });
});
