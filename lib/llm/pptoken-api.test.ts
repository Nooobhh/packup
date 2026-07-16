import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { LLMTimeoutError } from "./claude-cli";
import { LLMApiError } from "./deepseek-api";
import { PptokenApiRunner } from "./pptoken-api";

function okResponse(content: string) {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] })
  } as unknown as Response;
}

describe("PptokenApiRunner", () => {
  it("requires PACKUP_PPTOKEN_API_KEY", () => {
    const original = process.env.PACKUP_PPTOKEN_API_KEY;
    delete process.env.PACKUP_PPTOKEN_API_KEY;
    try {
      expect(() => new PptokenApiRunner()).toThrow("PACKUP_PPTOKEN_API_KEY");
    } finally {
      if (original !== undefined) process.env.PACKUP_PPTOKEN_API_KEY = original;
    }
  });

  it("posts to pptoken chat completions with bearer key and injected model", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(" hello "));
    const runner = new PptokenApiRunner({ apiKey: "pk", fetchImpl });

    await expect(runner.run({ prompt: "hi", model: "gpt-5.6", timeoutMs: 1000 })).resolves.toBe("hello");

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.pptoken.cc/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer pk");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("gpt-5.6");
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  it("passes reasoning_effort through and omits it when unset", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse("ok"));
    const runner = new PptokenApiRunner({ apiKey: "pk", fetchImpl });

    await runner.run({ prompt: "hi", reasoningEffort: "low", timeoutMs: 1000 });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).reasoning_effort).toBe("low");

    await runner.run({ prompt: "hi", timeoutMs: 1000 });
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).not.toHaveProperty("reasoning_effort");
  });

  it("injects json schema via system message and response_format", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse("{}"));
    const runner = new PptokenApiRunner({ apiKey: "pk", fetchImpl });

    await runner.run({ prompt: "hi", jsonSchema: { type: "object" }, timeoutMs: 1000 });

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain('"type":"object"');
  });

  it("inlines local image files as base64 data URLs in multimodal content", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pptoken-test-"));
    const imagePath = path.join(dir, "note.jpg");
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
    await writeFile(imagePath, bytes);
    const fetchImpl = vi.fn().mockResolvedValue(okResponse("ok"));
    const runner = new PptokenApiRunner({ apiKey: "pk", fetchImpl });

    await runner.run({ prompt: "读图", images: [imagePath], timeoutMs: 1000 });

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    const content = body.messages.at(-1).content;
    expect(content[0]).toEqual({ type: "text", text: "读图" });
    expect(content[1]).toEqual({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${bytes.toString("base64")}` } });
  });

  it("throws LLMApiError with status on non-2xx responses", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "bad key" } as unknown as Response);
    const runner = new PptokenApiRunner({ apiKey: "pk", fetchImpl });

    await expect(runner.run({ prompt: "hi", timeoutMs: 1000 })).rejects.toThrow(LLMApiError);
    await expect(runner.run({ prompt: "hi", timeoutMs: 1000 })).rejects.toThrow("401");
  });

  it("maps abort into LLMTimeoutError", async () => {
    const fetchImpl = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    });
    const runner = new PptokenApiRunner({ apiKey: "pk", fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(runner.run({ prompt: "hi", timeoutMs: 5 })).rejects.toThrow(LLMTimeoutError);
  });
});
