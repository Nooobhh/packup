import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContentFetcher } from "./types";
import { XhsCliFetcher } from "./xhs-cli";

const tmpDirs: string[] = [];

async function tmpWorkDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "xhs-fetcher-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("XhsCliFetcher", () => {
  it("implements ContentFetcher", () => {
    const fetcher: ContentFetcher = new XhsCliFetcher();
    expect(fetcher).toBeInstanceOf(XhsCliFetcher);
  });

  it("parses successful xhs output and downloads images as relative paths", async () => {
    const workDir = await tmpWorkDir();
    const execXhs = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        id: "note123",
        title: "外滩散步",
        body: "早上人少",
        images: ["https://img.example/a.jpg"]
      })
    });
    const fetchBinary = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);

    const notes = await new XhsCliFetcher({ execXhs, fetchBinary, sleep: vi.fn() }).fetch(
      ["https://www.xiaohongshu.com/explore/note123"],
      workDir
    );

    expect(notes).toEqual([
      expect.objectContaining({
        id: "note123",
        url: "https://www.xiaohongshu.com/explore/note123",
        title: "外滩散步",
        body: "早上人少",
        images: ["images/note123/1.jpg"],
        fetchStatus: "ok"
      })
    ]);
    await expect(readFile(path.join(workDir, "images/note123/1.jpg"))).resolves.toEqual(Buffer.from([1, 2, 3]));
  });

  it("marks a failed link and continues with subsequent links", async () => {
    const workDir = await tmpWorkDir();
    const execXhs = vi
      .fn()
      .mockRejectedValueOnce(new Error("login required"))
      .mockResolvedValueOnce({ stdout: JSON.stringify({ title: "第二篇", body: "正文", images: [] }) });

    const notes = await new XhsCliFetcher({ execXhs, fetchBinary: vi.fn(), sleep: vi.fn() }).fetch(
      ["https://xhslink.com/fail", "https://xhslink.com/ok"],
      workDir
    );

    expect(notes[0]).toMatchObject({
      url: "https://xhslink.com/fail",
      fetchStatus: "failed",
      failReason: "login required"
    });
    expect(notes[1]).toMatchObject({ title: "第二篇", fetchStatus: "ok" });
  });

  it("waits at least 2.5s between serial xhs calls", async () => {
    const workDir = await tmpWorkDir();
    const sleep = vi.fn().mockResolvedValue(undefined);
    const execXhs = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({ title: "ok", body: "body", images: [] })
    });

    await new XhsCliFetcher({ execXhs, fetchBinary: vi.fn(), sleep }).fetch(
      ["https://xhslink.com/1", "https://xhslink.com/2", "https://xhslink.com/3"],
      workDir
    );

    expect(execXhs).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 2500);
    expect(sleep).toHaveBeenNthCalledWith(2, 2500);
  });

  it("marks unparseable output as a failed note without throwing", async () => {
    const workDir = await tmpWorkDir();
    const notes = await new XhsCliFetcher({
      execXhs: vi.fn().mockResolvedValue({ stdout: "not a supported shape" }),
      fetchBinary: vi.fn(),
      sleep: vi.fn()
    }).fetch(["https://xhslink.com/bad"], workDir);

    expect(notes[0]).toMatchObject({ fetchStatus: "failed" });
    expect(notes[0].failReason).toContain("parse");
  });
});
