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

describe("DeepseekApiRunner.run jsonSchema 翻译", () => {
  it("有 jsonSchema 时请求体带 response_format 且首条 messages 是 system + schema 序列化", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 })
    );
    const schema = { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } };
    const runner = new DeepseekApiRunner({ apiKey: "sk-test", fetchImpl });

    await runner.run({ prompt: "输出", jsonSchema: schema, timeoutMs: 1000 });

    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toContain("JSON schema");
    expect(body.messages[0].content).toContain(JSON.stringify(schema));
    expect(body.messages[1]).toEqual({ role: "user", content: "输出" });
  });
});

describe("DeepseekApiRunner.run 图片守卫", () => {
  it("images 非空时立即 throw 并且不发 fetch", async () => {
    const fetchImpl = vi.fn();
    const runner = new DeepseekApiRunner({ apiKey: "sk-test", fetchImpl });

    await expect(
      runner.run({ prompt: "x", images: ["/a.jpg"], timeoutMs: 1000 })
    ).rejects.toThrow(/不支持图片/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("DeepseekApiRunner.run model 注入", () => {
  it("opts.model 存在时使用之", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200 })
    );
    const runner = new DeepseekApiRunner({ apiKey: "sk-test", fetchImpl });

    await runner.run({ prompt: "x", model: "deepseek-v4-pro", timeoutMs: 1000 });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(body.model).toBe("deepseek-v4-pro");
  });

  it("opts.model 缺省时用 deepseek-v4-flash", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200 })
    );
    const runner = new DeepseekApiRunner({ apiKey: "sk-test", fetchImpl });

    await runner.run({ prompt: "x", timeoutMs: 1000 });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string);
    expect(body.model).toBe("deepseek-v4-flash");
  });
});
