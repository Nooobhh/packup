import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContentFetcher } from "./types";
import { XhsHttpFetcher } from "./xhs-http";

const tmpDirs: string[] = [];

async function tmpWorkDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "xhs-http-fetcher-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("XhsHttpFetcher", () => {
  it("implements ContentFetcher", () => {
    const fetcher: ContentFetcher = new XhsHttpFetcher();
    expect(fetcher).toBeInstanceOf(XhsHttpFetcher);
  });

  it("parses SSR INITIAL_STATE with undefined literals and downloads images as relative paths", async () => {
    const workDir = await tmpWorkDir();
    const fetchPage = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      url: "https://www.xiaohongshu.com/discovery/item/note123?xsec_token=t",
      text: async () => htmlWithState("note123")
    });
    const fetchBinary = vi.fn().mockResolvedValue(new Uint8Array([7, 8, 9]).buffer);

    const notes = await new XhsHttpFetcher({ fetchPage, fetchBinary, sleep: vi.fn() }).fetch(["http://xhslink.com/o/abc"], workDir);

    expect(notes).toEqual([
      expect.objectContaining({
        id: "note123",
        url: "http://xhslink.com/o/abc",
        title: "外滩散步",
        body: "早上人少\n江风舒服",
        images: ["images/note123/1.jpg"],
        fetchStatus: "ok"
      })
    ]);
    expect(fetchPage).toHaveBeenCalledWith(
      "http://xhslink.com/o/abc",
      expect.objectContaining({ "user-agent": expect.stringContaining("Chrome") })
    );
    await expect(readFile(path.join(workDir, "images/note123/1.jpg"))).resolves.toEqual(Buffer.from([7, 8, 9]));
  });

  it("marks login wall or risk-control pages as failed notes", async () => {
    const workDir = await tmpWorkDir();
    const notes = await new XhsHttpFetcher({
      fetchPage: vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        url: "https://www.xiaohongshu.com/login",
        text: async () => "<html>请登录后继续访问</html>"
      }),
      fetchBinary: vi.fn(),
      sleep: vi.fn()
    }).fetch(["http://xhslink.com/o/login"], workDir);

    expect(notes[0]).toMatchObject({
      url: "http://xhslink.com/o/login",
      fetchStatus: "failed"
    });
    expect(notes[0].failReason).toContain("登录墙/风控");
  });

  it("marks one failed link and continues serially with subsequent links", async () => {
    const workDir = await tmpWorkDir();
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        url: "https://www.xiaohongshu.com/discovery/item/bad",
        text: async () => "<script>window.__INITIAL_STATE__ = {note:{noteDetailMap:{}}}</script>"
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        url: "https://www.xiaohongshu.com/discovery/item/note456",
        text: async () => htmlWithState("note456", { title: "第二篇", desc: "正文", imageUrl: undefined })
      });
    const sleep = vi.fn().mockResolvedValue(undefined);

    const notes = await new XhsHttpFetcher({ fetchPage, fetchBinary: vi.fn(), sleep }).fetch(
      ["http://xhslink.com/o/bad", "http://xhslink.com/o/ok"],
      workDir
    );

    expect(notes[0]).toMatchObject({ fetchStatus: "failed" });
    expect(notes[0].failReason).toContain("解析失败");
    expect(notes[1]).toMatchObject({ id: "note456", title: "第二篇", fetchStatus: "ok" });
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1000);
  });
});

function htmlWithState(noteId: string, opts: { title?: string; desc?: string; imageUrl?: string } = {}) {
  const imageUrl = opts.imageUrl === undefined ? "https://sns-webpic-qc.xhscdn.com/a/b/c.jpg" : opts.imageUrl;
  const imageList = imageUrl ? `[{urlDefault:"${imageUrl}",traceId:undefined}]` : "[]";
  return `<html><script>window.__INITIAL_STATE__ = {
    note: {
      noteDetailMap: {
        "${noteId}": {
          note: {
            title: "${opts.title ?? "外滩散步"}",
            desc: "${opts.desc ?? "早上人少\\n江风舒服"}",
            type: "normal",
            imageList: ${imageList},
            tagList: [{name:"上海"}, {name:undefined}]
          }
        }
      }
    }
  }</script><script>after()</script></html>`;
}

describe("XhsHttpFetcher robustness", () => {
  const html = `<html><script>window.__INITIAL_STATE__={"note":{"noteDetailMap":{"n1":{"note":{"title":"T","desc":"body text","imageList":[{"urlDefault":"https://cdn/x.jpg"}]}}}}}</script></html>`;
  it("retries page fetch once on transient failure", async () => {
    const fetchPage = vi.fn()
      .mockRejectedValueOnce(new Error("terminated"))
      .mockResolvedValueOnce({ ok: true, status: 200, url: "https://www.xiaohongshu.com/discovery/item/n1", text: async () => html });
    const fetchBinary = vi.fn().mockResolvedValue(new ArrayBuffer(8));
    const notes = await new XhsHttpFetcher({ fetchPage, fetchBinary, sleep: async () => {} }).fetch(["http://xhslink.com/o/a"], "/tmp/xhs-retry-test");
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(notes[0].fetchStatus).toBe("ok");
  });
  it("keeps note ok when an image download fails", async () => {
    const fetchPage = vi.fn().mockResolvedValue({ ok: true, status: 200, url: "https://www.xiaohongshu.com/discovery/item/n1", text: async () => html });
    const fetchBinary = vi.fn().mockRejectedValue(new Error("image 403"));
    const notes = await new XhsHttpFetcher({ fetchPage, fetchBinary, sleep: async () => {} }).fetch(["http://xhslink.com/o/a"], "/tmp/xhs-img-test");
    expect(notes[0].fetchStatus).toBe("ok");
    expect(notes[0].images).toEqual([]);
  });
});
