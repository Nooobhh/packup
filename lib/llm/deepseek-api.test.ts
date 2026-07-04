import { describe, expect, it, vi } from "vitest";
import { DeepseekApiRunner } from "./deepseek-api";

describe("DeepseekApiRunner 构造", () => {
  it("缺 PACKUP_DEEPSEEK_API_KEY 时 throw", () => {
    const oldKey = process.env.PACKUP_DEEPSEEK_API_KEY;
    delete process.env.PACKUP_DEEPSEEK_API_KEY;
    try {
      expect(() => new DeepseekApiRunner()).toThrow(/PACKUP_DEEPSEEK_API_KEY/);
    } finally {
      if (oldKey !== undefined) process.env.PACKUP_DEEPSEEK_API_KEY = oldKey;
    }
  });

  it("显式传 apiKey 时不读 env", () => {
    const oldKey = process.env.PACKUP_DEEPSEEK_API_KEY;
    delete process.env.PACKUP_DEEPSEEK_API_KEY;
    try {
      expect(() => new DeepseekApiRunner({ apiKey: "sk-test" })).not.toThrow();
    } finally {
      if (oldKey !== undefined) process.env.PACKUP_DEEPSEEK_API_KEY = oldKey;
    }
  });
});

describe("DeepseekApiRunner.run 基本组装", () => {
  it("无 jsonSchema 时请求体不含 response_format，messages 只有 user 一条", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "hello" } }] }), {
        status: 200
      })
    );
    const runner = new DeepseekApiRunner({ apiKey: "sk-test", fetchImpl });

    const result = await runner.run({ prompt: "问一下", timeoutMs: 1000 });

    expect(result).toBe("hello");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Authorization).toBe("Bearer sk-test");
    const body = JSON.parse(init.body as string);
    expect(body.temperature).toBe(0.2);
    expect(body.response_format).toBeUndefined();
    expect(body.messages).toEqual([{ role: "user", content: "问一下" }]);
  });
});
