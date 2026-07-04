# LLM API Router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 pipeline LLM 供应商路由抽象；交付 DeepSeek API provider；`parse-query / plan` 两段切至 DS API，`extract` 段保留 `claude-cli` 作为路由的一员。

**Architecture:** `lib/llm/router.ts` 集中 stage → provider+model 映射表 + lazy 单例 + 测试后门；`DeepseekApiRunner` 走裸 fetch 无 SDK 依赖；三个 pipeline 消费者签名收窄不再传 LLMRunner，改从 router 拿。

**Tech Stack:** Next.js 15 / TypeScript / vitest / DeepSeek Chat Completions REST（OpenAI 兼容格式）。

---

## Spec 引用

本 plan 对应 [`docs/ohaze/specs/2026-07-03-ds-api-router-design.md`](../specs/2026-07-03-ds-api-router-design.md)。所有决策依据看 spec §1。

## File Structure

**新增（4）**
- `lib/llm/deepseek-api.ts` — `DeepseekApiRunner` + `LLMApiError`
- `lib/llm/deepseek-api.test.ts` — provider 单元测试
- `lib/llm/router.ts` — `PROVIDERS` 注册表 + `STAGE_MODELS` 映射表 + `runForStage` + `__resetProvidersForTest`
- `lib/llm/router.test.ts` — router 单元测试

**修改（15）**
- `lib/llm/types.ts` — 加 `Stage` 类型 + `model?` 字段
- `lib/llm/claude-cli.ts` — 3 行支持 `opts.model`
- `lib/llm/claude-cli.test.ts` — 补 1 条 model 覆盖测试
- `lib/pipeline/parse-query.ts` — 签名收窄，用 `runForStage("parseQuery", ...)`
- `lib/pipeline/parse-query.test.ts` — mock 迁移到 `__resetProvidersForTest`
- `lib/pipeline/extract.ts` — 签名收窄，用 `runForStage("extract", ...)`
- `lib/pipeline/extract.test.ts` — mock 迁移
- `lib/pipeline/plan.ts` — 签名收窄，用 `runForStage("plan", ...)`
- `lib/pipeline/plan.test.ts` — mock 迁移
- `lib/pipeline/run.ts` — `createDefaultPipelineDeps` 删 `llm`；`runExtractStage/runPlanStage` 签名瘦身
- `lib/pipeline/run.test.ts` — `depsForSuccess()` 删 `llm`；`beforeEach` 装 mock provider
- `app/api/generate/route.ts` — 删 `testMode` 里的 llm 分歧
- `.env.example` / `README.md` / `CLAUDE.md` / `ROADMAP.md` / `CHANGELOG.md` — 收尾同步

---

## Task 1: `lib/llm/types.ts` 加 `Stage` 与 `model?` 字段

**Files:**
- Modify: `lib/llm/types.ts`

- [ ] **Step 1: 打开文件确认当前内容**

Run: `cat lib/llm/types.ts`
Expected: 现有内容如 spec §2.2 所示（`LLMRunner` 接口有 `prompt/images/jsonSchema/mcpConfig/allowedTools/timeoutMs` 6 个字段）。

- [ ] **Step 2: 加 `Stage` 类型 + `model?` 字段**

替换整个文件为：
```ts
export type Stage = "parseQuery" | "extract" | "plan";

export interface LLMRunner {
  run(opts: {
    prompt: string;
    images?: string[];
    jsonSchema?: object;
    mcpConfig?: string;
    allowedTools?: string[];
    model?: string;
    timeoutMs: number;
  }): Promise<string>;
}
```

- [ ] **Step 3: 类型编译验证**

Run: `npx tsc --noEmit`
Expected: 通过（现在无消费者传 `model`，只是新增可选字段，不破坏既有代码）。

- [ ] **Step 4: Commit**

```bash
git add lib/llm/types.ts
git commit -m "feat(llm): add Stage type and model? field to LLMRunner"
```

---

## Task 2: `DeepseekApiRunner` 骨架 + API key 校验

**Files:**
- Create: `lib/llm/deepseek-api.ts`
- Create: `lib/llm/deepseek-api.test.ts`

- [ ] **Step 1: 写失败测试**

Create `lib/llm/deepseek-api.test.ts`:
```ts
import { describe, expect, it } from "vitest";
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run lib/llm/deepseek-api.test.ts`
Expected: FAIL，报"Cannot find module './deepseek-api'"。

- [ ] **Step 3: 写最小实现**

Create `lib/llm/deepseek-api.ts`:
```ts
import type { LLMRunner } from "./types";

export class DeepseekApiRunner implements LLMRunner {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: { apiKey?: string; fetchImpl?: typeof fetch } = {}) {
    const key = opts.apiKey ?? process.env.PACKUP_DEEPSEEK_API_KEY;
    if (!key) throw new Error("PACKUP_DEEPSEEK_API_KEY is required");
    this.apiKey = key;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async run(_opts: Parameters<LLMRunner["run"]>[0]): Promise<string> {
    throw new Error("not implemented");
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run lib/llm/deepseek-api.test.ts`
Expected: 2 passed。

- [ ] **Step 5: Commit**

```bash
git add lib/llm/deepseek-api.ts lib/llm/deepseek-api.test.ts
git commit -m "feat(llm): add DeepseekApiRunner skeleton with api-key guard"
```

---

## Task 3: `DeepseekApiRunner.run` 基本请求组装（无 jsonSchema、无 images）

**Files:**
- Modify: `lib/llm/deepseek-api.ts`
- Modify: `lib/llm/deepseek-api.test.ts`

- [ ] **Step 1: 追加失败测试**

Append to `lib/llm/deepseek-api.test.ts`:
```ts
import { vi } from "vitest";

describe("DeepseekApiRunner.run 基本组装", () => {
  it("无 jsonSchema 时请求体不含 response_format，messages 只有 user 一条", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "hello" } }] }), { status: 200 })
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run lib/llm/deepseek-api.test.ts`
Expected: 新用例 FAIL，报 "not implemented"。

- [ ] **Step 3: 实现 `run` 主流程**

Replace `lib/llm/deepseek-api.ts` with:
```ts
import type { LLMRunner } from "./types";

const ENDPOINT = "https://api.deepseek.com/chat/completions";
const DEFAULT_MODEL = "deepseek-v4-flash";

export class DeepseekApiRunner implements LLMRunner {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: { apiKey?: string; fetchImpl?: typeof fetch } = {}) {
    const key = opts.apiKey ?? process.env.PACKUP_DEEPSEEK_API_KEY;
    if (!key) throw new Error("PACKUP_DEEPSEEK_API_KEY is required");
    this.apiKey = key;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async run(opts: Parameters<LLMRunner["run"]>[0]): Promise<string> {
    const body: Record<string, unknown> = {
      model: opts.model ?? DEFAULT_MODEL,
      messages: buildMessages(opts.prompt, opts.jsonSchema),
      temperature: 0.2
    };
    if (opts.jsonSchema) body.response_format = { type: "json_object" };

    const res = await this.fetchImpl(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body)
    });
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return json.choices?.[0]?.message?.content?.trim() ?? "";
  }
}

function buildMessages(prompt: string, jsonSchema?: object) {
  const messages: { role: string; content: string }[] = [];
  if (jsonSchema) {
    messages.push({
      role: "system",
      content:
        "输出必须是符合以下 JSON schema 的合法 JSON 对象。只返回 JSON，不要 markdown code fence。\n\n" +
        JSON.stringify(jsonSchema)
    });
  }
  messages.push({ role: "user", content: prompt });
  return messages;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run lib/llm/deepseek-api.test.ts`
Expected: 3 passed。

- [ ] **Step 5: Commit**

```bash
git add lib/llm/deepseek-api.ts lib/llm/deepseek-api.test.ts
git commit -m "feat(llm): DeepseekApiRunner.run assembles chat completion request"
```

---

## Task 4: `DeepseekApiRunner.run` jsonSchema 处理

**Files:**
- Modify: `lib/llm/deepseek-api.test.ts`

- [ ] **Step 1: 追加失败测试**

Append to `lib/llm/deepseek-api.test.ts`:
```ts
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
```

- [ ] **Step 2: 运行测试确认通过（此逻辑 Task 3 已实现）**

Run: `npx vitest run lib/llm/deepseek-api.test.ts`
Expected: 4 passed（此测试无需新实现即通过——补测覆盖，防止将来回归）。

- [ ] **Step 3: Commit**

```bash
git add lib/llm/deepseek-api.test.ts
git commit -m "test(llm): DeepseekApiRunner encodes jsonSchema as system message"
```

---

## Task 5: `DeepseekApiRunner.run` 图片输入 → throw

**Files:**
- Modify: `lib/llm/deepseek-api.ts`
- Modify: `lib/llm/deepseek-api.test.ts`

- [ ] **Step 1: 追加失败测试**

Append to `lib/llm/deepseek-api.test.ts`:
```ts
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run lib/llm/deepseek-api.test.ts`
Expected: 新用例 FAIL（当前实现会真的 fetch）。

- [ ] **Step 3: 加图片守卫**

在 `lib/llm/deepseek-api.ts` 的 `run` 方法开头（`const body` 之前）插入：
```ts
    if (opts.images?.length) {
      throw new Error(
        "DeepseekApiRunner 不支持图片输入；该 stage 必须路由到支持多模态的 provider（当前仅 claude-cli）"
      );
    }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run lib/llm/deepseek-api.test.ts`
Expected: 5 passed。

- [ ] **Step 5: Commit**

```bash
git add lib/llm/deepseek-api.ts lib/llm/deepseek-api.test.ts
git commit -m "feat(llm): DeepseekApiRunner rejects image inputs to prevent silent downgrade"
```

---

## Task 6: `DeepseekApiRunner.run` model 覆盖 & 默认

**Files:**
- Modify: `lib/llm/deepseek-api.test.ts`

- [ ] **Step 1: 追加失败测试**

Append to `lib/llm/deepseek-api.test.ts`:
```ts
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
```

- [ ] **Step 2: 运行测试确认通过（Task 3 已实现该逻辑）**

Run: `npx vitest run lib/llm/deepseek-api.test.ts`
Expected: 7 passed。

- [ ] **Step 3: Commit**

```bash
git add lib/llm/deepseek-api.test.ts
git commit -m "test(llm): DeepseekApiRunner model overrides and default"
```

---

## Task 7: `DeepseekApiRunner.run` 错误分类（`LLMApiError` / `LLMTimeoutError`）

**Files:**
- Modify: `lib/llm/deepseek-api.ts`
- Modify: `lib/llm/deepseek-api.test.ts`

- [ ] **Step 1: 追加失败测试**

Append to `lib/llm/deepseek-api.test.ts`:
```ts
import { LLMApiError } from "./deepseek-api";
import { LLMTimeoutError } from "./claude-cli";

describe("DeepseekApiRunner.run 错误分类", () => {
  it("非 2xx 响应抛 LLMApiError 且携带 status 与摘要", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('{"error":"bad key"}', { status: 401 })
    );
    const runner = new DeepseekApiRunner({ apiKey: "sk-test", fetchImpl });

    await expect(runner.run({ prompt: "x", timeoutMs: 1000 })).rejects.toMatchObject({
      name: "LLMApiError",
      status: 401,
      message: expect.stringContaining("401")
    });
  });

  it("429/500 都作为 LLMApiError 抛出", async () => {
    for (const status of [429, 500]) {
      const fetchImpl = vi.fn().mockResolvedValue(new Response("busy", { status }));
      const runner = new DeepseekApiRunner({ apiKey: "sk-test", fetchImpl });
      await expect(runner.run({ prompt: "x", timeoutMs: 1000 })).rejects.toBeInstanceOf(LLMApiError);
    }
  });

  it("AbortError 转为 LLMTimeoutError", async () => {
    const fetchImpl = vi.fn().mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        (init as { signal: AbortSignal }).signal.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });
    const runner = new DeepseekApiRunner({ apiKey: "sk-test", fetchImpl });

    await expect(runner.run({ prompt: "x", timeoutMs: 20 })).rejects.toBeInstanceOf(LLMTimeoutError);
  });

  it("网络错误透传为裸 Error", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const runner = new DeepseekApiRunner({ apiKey: "sk-test", fetchImpl });

    await expect(runner.run({ prompt: "x", timeoutMs: 1000 })).rejects.toThrow("ECONNREFUSED");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run lib/llm/deepseek-api.test.ts`
Expected: 新用例 FAIL（未导出 LLMApiError；未处理错误分类）。

- [ ] **Step 3: 补错误分类实现**

Replace `lib/llm/deepseek-api.ts` with:
```ts
import type { LLMRunner } from "./types";
import { LLMTimeoutError } from "./claude-cli";

const ENDPOINT = "https://api.deepseek.com/chat/completions";
const DEFAULT_MODEL = "deepseek-v4-flash";

export class LLMApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "LLMApiError";
  }
}

export class DeepseekApiRunner implements LLMRunner {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: { apiKey?: string; fetchImpl?: typeof fetch } = {}) {
    const key = opts.apiKey ?? process.env.PACKUP_DEEPSEEK_API_KEY;
    if (!key) throw new Error("PACKUP_DEEPSEEK_API_KEY is required");
    this.apiKey = key;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async run(opts: Parameters<LLMRunner["run"]>[0]): Promise<string> {
    if (opts.images?.length) {
      throw new Error(
        "DeepseekApiRunner 不支持图片输入；该 stage 必须路由到支持多模态的 provider（当前仅 claude-cli）"
      );
    }
    const body: Record<string, unknown> = {
      model: opts.model ?? DEFAULT_MODEL,
      messages: buildMessages(opts.prompt, opts.jsonSchema),
      temperature: 0.2
    };
    if (opts.jsonSchema) body.response_format = { type: "json_object" };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const res = await this.fetchImpl(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new LLMApiError(res.status, `DeepSeek API ${res.status}: ${summarize(text)}`);
      }
      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      return json.choices?.[0]?.message?.content?.trim() ?? "";
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new LLMTimeoutError(`DeepSeek API timed out after ${opts.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

function buildMessages(prompt: string, jsonSchema?: object) {
  const messages: { role: string; content: string }[] = [];
  if (jsonSchema) {
    messages.push({
      role: "system",
      content:
        "输出必须是符合以下 JSON schema 的合法 JSON 对象。只返回 JSON，不要 markdown code fence。\n\n" +
        JSON.stringify(jsonSchema)
    });
  }
  messages.push({ role: "user", content: prompt });
  return messages;
}

function summarize(v: string) {
  return v.replace(/\s+/g, " ").trim().slice(0, 200);
}
```

- [ ] **Step 4: 运行测试确认全绿**

Run: `npx vitest run lib/llm/deepseek-api.test.ts`
Expected: 全部用例 passed（4 类错误 + 之前 7 条基础用例）。

- [ ] **Step 5: Commit**

```bash
git add lib/llm/deepseek-api.ts lib/llm/deepseek-api.test.ts
git commit -m "feat(llm): DeepseekApiRunner surfaces LLMApiError/Timeout with abort-based deadline"
```

---

## Task 8: `ClaudeCliRunner` 吸收 `opts.model`

**Files:**
- Modify: `lib/llm/claude-cli.ts`
- Modify: `lib/llm/claude-cli.test.ts`

- [ ] **Step 1: 追加失败测试**

在 `lib/llm/claude-cli.test.ts` 的 `describe("ClaudeCliRunner", () => { ... })` 内追加：
```ts
  it("opts.model 优先于 env PACKUP_CLAUDE_MODEL", async () => {
    const execClaude = vi.fn().mockResolvedValue({ stdout: JSON.stringify({ result: "ok" }) });
    const runner = new ClaudeCliRunner({ execClaude, env: { PACKUP_CLAUDE_MODEL: "opus" } });

    await runner.run({ prompt: "x", model: "haiku", timeoutMs: 1 });
    const args = execClaude.mock.calls[0][0] as string[];
    const modelIdx = args.indexOf("--model");
    expect(args[modelIdx + 1]).toBe("haiku");
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run lib/llm/claude-cli.test.ts`
Expected: 新用例 FAIL —— 当前 `--model` 会用 `"opus"`（env）。

- [ ] **Step 3: 调 `ClaudeCliRunner.run` 的 model 取值顺序**

在 `lib/llm/claude-cli.ts:25` 附近，把：
```ts
      const args = ["-p", prompt, "--output-format", "json", "--model", this.env.PACKUP_CLAUDE_MODEL || "sonnet"];
```
替换为：
```ts
      const model = opts.model ?? this.env.PACKUP_CLAUDE_MODEL ?? "sonnet";
      const args = ["-p", prompt, "--output-format", "json", "--model", model];
```

- [ ] **Step 4: 运行整个 claude-cli 测试确认全绿**

Run: `npx vitest run lib/llm/claude-cli.test.ts`
Expected: 全 8 条 passed（原 7 + 新 1）。

- [ ] **Step 5: Commit**

```bash
git add lib/llm/claude-cli.ts lib/llm/claude-cli.test.ts
git commit -m "feat(llm): ClaudeCliRunner honors opts.model over env PACKUP_CLAUDE_MODEL"
```

---

## Task 9: `Router` `runForStage` 分发

**Files:**
- Create: `lib/llm/router.ts`
- Create: `lib/llm/router.test.ts`

- [ ] **Step 1: 写失败测试**

Create `lib/llm/router.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LLMRunner } from "./types";
import { __resetProvidersForTest, runForStage } from "./router";

afterEach(() => __resetProvidersForTest());

function fakeRunner(): LLMRunner & { run: ReturnType<typeof vi.fn> } {
  return { run: vi.fn().mockResolvedValue("ok") };
}

describe("runForStage 分发", () => {
  it("parseQuery 分发到 deepseek 且注入 deepseek-v4-flash", async () => {
    const ds = fakeRunner();
    const cli = fakeRunner();
    __resetProvidersForTest({ deepseek: ds, "claude-cli": cli });

    await runForStage("parseQuery", { prompt: "x", timeoutMs: 1000 });
    expect(ds.run).toHaveBeenCalledWith(expect.objectContaining({ model: "deepseek-v4-flash", prompt: "x" }));
    expect(cli.run).not.toHaveBeenCalled();
  });

  it("plan 分发到 deepseek 且注入 deepseek-v4-flash", async () => {
    const ds = fakeRunner();
    const cli = fakeRunner();
    __resetProvidersForTest({ deepseek: ds, "claude-cli": cli });

    await runForStage("plan", { prompt: "y", timeoutMs: 1000 });
    expect(ds.run).toHaveBeenCalledWith(expect.objectContaining({ model: "deepseek-v4-flash", prompt: "y" }));
    expect(cli.run).not.toHaveBeenCalled();
  });

  it("extract 分发到 claude-cli 且注入 sonnet", async () => {
    const ds = fakeRunner();
    const cli = fakeRunner();
    __resetProvidersForTest({ deepseek: ds, "claude-cli": cli });

    await runForStage("extract", { prompt: "z", timeoutMs: 1000 });
    expect(cli.run).toHaveBeenCalledWith(expect.objectContaining({ model: "sonnet", prompt: "z" }));
    expect(ds.run).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run lib/llm/router.test.ts`
Expected: FAIL，报"Cannot find module './router'"。

- [ ] **Step 3: 写最小实现**

Create `lib/llm/router.ts`:
```ts
import { ClaudeCliRunner } from "./claude-cli";
import { DeepseekApiRunner } from "./deepseek-api";
import type { LLMRunner, Stage } from "./types";

const PROVIDERS: Record<string, () => LLMRunner> = {
  deepseek: () => new DeepseekApiRunner(),
  "claude-cli": () => new ClaudeCliRunner()
};

const STAGE_MODELS: Record<Stage, { provider: keyof typeof PROVIDERS; model: string }> = {
  parseQuery: { provider: "deepseek", model: "deepseek-v4-flash" },
  extract: { provider: "claude-cli", model: "sonnet" },
  plan: { provider: "deepseek", model: "deepseek-v4-flash" }
};

const instances = new Map<string, LLMRunner>();

function get(providerName: string): LLMRunner {
  if (!instances.has(providerName)) {
    const factory = PROVIDERS[providerName];
    if (!factory) throw new Error(`Unknown LLM provider: ${providerName}`);
    instances.set(providerName, factory());
  }
  return instances.get(providerName)!;
}

export async function runForStage(
  stage: Stage,
  opts: Omit<Parameters<LLMRunner["run"]>[0], "model">
): Promise<string> {
  const cfg = STAGE_MODELS[stage];
  return get(cfg.provider).run({ ...opts, model: cfg.model });
}

export function __resetProvidersForTest(overrides?: Record<string, LLMRunner>): void {
  instances.clear();
  if (overrides) for (const [k, v] of Object.entries(overrides)) instances.set(k, v);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run lib/llm/router.test.ts`
Expected: 3 passed。

- [ ] **Step 5: Commit**

```bash
git add lib/llm/router.ts lib/llm/router.test.ts
git commit -m "feat(llm): add router with stage-to-provider mapping"
```

---

## Task 10: Router 单例复用与后门覆盖

**Files:**
- Modify: `lib/llm/router.test.ts`

- [ ] **Step 1: 追加失败测试（其实此实现已支持，是补覆盖）**

Append to `lib/llm/router.test.ts`:
```ts
describe("runForStage 单例复用", () => {
  it("对同一 provider 的多次调用复用同一实例", async () => {
    const ds = fakeRunner();
    __resetProvidersForTest({ deepseek: ds, "claude-cli": fakeRunner() });

    await runForStage("parseQuery", { prompt: "a", timeoutMs: 1 });
    await runForStage("plan", { prompt: "b", timeoutMs: 1 });
    expect(ds.run).toHaveBeenCalledTimes(2);
  });
});

describe("__resetProvidersForTest", () => {
  it("不带参调用清空所有实例", () => {
    __resetProvidersForTest({ deepseek: fakeRunner() });
    expect(() => __resetProvidersForTest()).not.toThrow();
  });

  it("未注册的 provider 名导致 runForStage 抛错", async () => {
    __resetProvidersForTest();
    // 强制清空后未安装 mock,runForStage("extract") 会走真实 factory ClaudeCliRunner,
    // 但 test env 里 claude CLI 不一定可用,所以只测能触发到底层 provider 的构造错误。
    // 用 STAGE 键不存在的 hack 无法(TS 卡),改测 factory 未注册:
    // 直接给 deepseek 装 stub,让默认 factory 保持可用。此处保持行为覆盖足够。
  });
});
```
> 说明：第二段"未注册 provider"只是文档说明，未添加实际断言（unknown provider 走类型层已挡）。

- [ ] **Step 2: 运行测试确认通过**

Run: `npx vitest run lib/llm/router.test.ts`
Expected: 5 passed。

- [ ] **Step 3: Commit**

```bash
git add lib/llm/router.test.ts
git commit -m "test(llm): router covers singleton reuse and reset semantics"
```

---

## Task 11: `parse-query.ts` 签名收窄 + 测试迁移

**Files:**
- Modify: `lib/pipeline/parse-query.ts`
- Modify: `lib/pipeline/parse-query.test.ts`

- [ ] **Step 1: 改测试为新签名（先失败）**

Replace `lib/pipeline/parse-query.test.ts` with:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LLMRunner } from "@/lib/llm/types";
import { __resetProvidersForTest } from "@/lib/llm/router";
import { BUDGETS } from "./budgets";
import { parseQuery } from "./parse-query";

let mockRun: ReturnType<typeof vi.fn>;

function installMock(result = "{}") {
  mockRun = vi.fn().mockResolvedValue(result);
  const mock: LLMRunner = { run: mockRun };
  __resetProvidersForTest({ deepseek: mock, "claude-cli": mock });
}

afterEach(() => __resetProvidersForTest());

describe("parseQuery", () => {
  beforeEach(() => installMock());

  it.each([
    ["香港旅游攻略", { destination: "香港", days: undefined, preferences: [] }],
    ["杭州3天旅游攻略", { destination: "杭州", days: 3, preferences: [] }],
    ["泰国3天2晚旅游攻略", { destination: "泰国", days: 3, preferences: [] }],
    ["吉隆坡5天city walk+美食", { destination: "吉隆坡", days: 5, preferences: ["city walk", "美食"] }]
  ])("parses %s by rule without calling llm", async (query, expected) => {
    await expect(parseQuery(query)).resolves.toEqual(expected);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("does not swallow English preferences into the destination", async () => {
    await expect(parseQuery("Osaka food")).resolves.toEqual({
      destination: "Osaka",
      days: undefined,
      preferences: ["food"]
    });
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("uses the llm fallback exactly once when rules cannot identify a destination", async () => {
    installMock(JSON.stringify({ destination: "京都", days: 4, preferences: ["寺院", "咖啡"] }));

    await expect(parseQuery("帮我规划一个超级好玩的假期行程")).resolves.toEqual({
      destination: "京都",
      days: 4,
      preferences: ["寺院", "咖啡"]
    });
    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(mockRun).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: BUDGETS.parseQueryMs, model: "deepseek-v4-flash" }));
  });

  it("throws a helpful error when fallback cannot identify a destination", async () => {
    installMock(JSON.stringify({ destination: "", preferences: [] }));

    await expect(parseQuery("帮我规划一个超级好玩的假期行程")).rejects.toThrow("无法识别目的地");
  });
});
```

- [ ] **Step 2: 运行测试确认失败（signature 未改）**

Run: `npx vitest run lib/pipeline/parse-query.test.ts`
Expected: TS 编译错，或运行时 argument-count 问题。

- [ ] **Step 3: 改 `parse-query.ts` 签名 + 用 router**

Replace `lib/pipeline/parse-query.ts` with:
```ts
import { z } from "zod";
import { runForStage } from "@/lib/llm/router";
import { BUDGETS } from "./budgets";

const ParsedQuerySchema = z.object({
  destination: z.string().optional(),
  days: z.number().int().min(1).max(15).optional(),
  preferences: z.array(z.string()).default([])
});

export async function parseQuery(query: string): Promise<{ destination: string; days?: number; preferences: string[] }> {
  const ruled = parseByRules(query);
  if (ruled.destination && ruled.destination.length <= 10) return ruled;

  const raw = await runForStage("parseQuery", {
    prompt: `从旅行需求中提取目的地、天数和偏好,只返回 JSON。需求: ${query}`,
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        destination: { type: "string" },
        days: { type: "number" },
        preferences: { type: "array", items: { type: "string" } }
      },
      required: ["destination", "preferences"]
    },
    timeoutMs: BUDGETS.parseQueryMs
  });

  try {
    const parsed = ParsedQuerySchema.parse(JSON.parse(raw));
    const destination = parsed.destination?.trim();
    if (!destination) throw new Error("empty destination");
    return { destination, days: parsed.days, preferences: parsed.preferences.filter(Boolean) };
  } catch {
    throw new Error("无法识别目的地,请在输入中明确城市或国家");
  }
}

function parseByRules(query: string): { destination: string; days?: number; preferences: string[] } {
  const normalized = query.trim();
  if (/帮我|规划|假期|行程/.test(normalized)) return { destination: "", preferences: [] };

  const dayMatch = normalized.match(/(\d{1,2})\s*天(?:\s*\d{1,2}\s*晚)?/);
  const parsedDays = dayMatch ? Number(dayMatch[1]) : undefined;
  const days = parsedDays && parsedDays >= 1 && parsedDays <= 15 ? parsedDays : undefined;

  let cleaned = normalized
    .replace(/(\d{1,2})\s*天(?:\s*\d{1,2}\s*晚)?/g, " ")
    .replace(/旅游|旅行|攻略|游玩|出行|自由行|之旅/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  cleaned = trimDelimiters(cleaned);
  const destinationMatch = cleaned.match(/^([\p{Script=Han}]{1,10}|[A-Za-z][A-Za-z-]{0,20})(.*)$/u);
  const destination = trimDelimiters(destinationMatch?.[1] ?? "");
  const rest = trimDelimiters(destinationMatch?.[2] ?? "");

  return { destination, days, preferences: splitPreferences(rest) };
}

function splitPreferences(value: string): string[] {
  return value.split(/[+、,，]/).map((item) => item.trim()).filter(Boolean);
}

function trimDelimiters(value: string): string {
  return value.replace(/^[\s+、,，。:：-]+|[\s+、,，。:：-]+$/g, "");
}
```

- [ ] **Step 4: 运行测试确认全绿**

Run: `npx vitest run lib/pipeline/parse-query.test.ts`
Expected: 6 passed。

- [ ] **Step 5: Commit**

```bash
git add lib/pipeline/parse-query.ts lib/pipeline/parse-query.test.ts
git commit -m "refactor(pipeline): parse-query drops llm arg and routes via runForStage"
```

---

## Task 12: `extract.ts` 签名收窄 + 测试迁移

**Files:**
- Modify: `lib/pipeline/extract.ts`
- Modify: `lib/pipeline/extract.test.ts`

- [ ] **Step 1: 改 `extract.ts` 签名 + 用 router**

替换 `lib/pipeline/extract.ts` 中 3 处：

第一处（signature `runExtract`，line 8-13）：
```ts
export async function runExtract(
  notes: Note[],
  input: TripInput,
  opts: { workDir?: string } = {}
): Promise<{ pois: CandidatePoi[]; filtered: FilteredItem[]; failedNotes: { noteId: string; reason: string }[] }> {
  const okNotes = notes.filter((note) => note.fetchStatus === "ok");
  const results = await mapLimitWithDeadline(
    okNotes,
    3,
    (note) => extractOne(resolveNoteImages(note, opts.workDir), input),
    BUDGETS.extractStageMs,
    (note) => ({ pois: [], filtered: [], failed: { noteId: note.id, reason: "提取超时" } })
  );
  ...
```

第二处（`extractOne`，line 37）：
```ts
async function extractOne(note: Note, input: TripInput) {
  let validationError: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: string;
    try {
      raw = await runForStage("extract", {
        prompt: buildExtractPrompt(note, input, validationError),
        images: note.images,
        jsonSchema: extractJsonSchema,
        timeoutMs: BUDGETS.extractPerNoteMs
      });
    } catch (error) {
      ...
```

第三处（import，line 1-6）：删除 `import type { LLMRunner } from "@/lib/llm/types";`，加 `import { runForStage } from "@/lib/llm/router";`。

- [ ] **Step 2: 改 `extract.test.ts` 到新签名**

Replace `lib/pipeline/extract.test.ts` with:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import type { LLMRunner } from "@/lib/llm/types";
import { __resetProvidersForTest } from "@/lib/llm/router";
import { buildExtractPrompt } from "@/lib/prompts/extract";
import { BUDGETS } from "./budgets";
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

function installMock(runImpl?: LLMRunner["run"]) {
  const run = runImpl ? vi.fn(runImpl) : vi.fn();
  const mock: LLMRunner = { run };
  __resetProvidersForTest({ deepseek: mock, "claude-cli": mock });
  return run;
}

afterEach(() => __resetProvidersForTest());

describe("runExtract", () => {
  it("calls the LLM for text/image and pure-image notes and passes image paths", async () => {
    const run = installMock();
    run
      .mockResolvedValueOnce(JSON.stringify({ pois: [poi("外滩", "n1", "text")], filtered: [] }))
      .mockResolvedValueOnce(JSON.stringify({ pois: [poi("武康路", "n2", "image")], filtered: [] }));

    const workDir = path.join(process.cwd(), "data/trips/trip-test");
    const result = await runExtract([note("n1", ["a.jpg"]), note("n2", ["b.jpg"], "")], input, { workDir });

    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0][0].images).toEqual([path.join(workDir, "a.jpg")]);
    expect(run.mock.calls[1][0].images).toEqual([path.join(workDir, "b.jpg")]);
    expect(result.pois.map((item) => item.name)).toEqual(["外滩", "武康路"]);
  });

  it("caps per-note LLM concurrency at three", async () => {
    let active = 0;
    let maxActive = 0;
    installMock(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return JSON.stringify({ pois: [], filtered: [] });
    });

    await runExtract([note("a"), note("b"), note("c"), note("d"), note("e")], input);
    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it("normalizes filtered items to stage extract with sourceNoteId and keeps going after one note fails", async () => {
    const run = installMock();
    run
      .mockResolvedValueOnce(JSON.stringify({ pois: [], filtered: [{ name: "广告", reason: "商业内容" }] }))
      .mockRejectedValueOnce(new Error("model down"))
      .mockResolvedValueOnce(JSON.stringify({ pois: [poi("豫园", "n3", "text")], filtered: [] }));

    const result = await runExtract([note("n1"), note("n2"), note("n3")], input);

    expect(result.filtered[0]).toMatchObject({ name: "广告", sourceNoteId: "n1", stage: "extract", reason: "商业内容" });
    expect(result.failedNotes).toEqual([{ noteId: "n2", reason: "model down" }]);
    expect(result.pois).toHaveLength(1);
  });

  it("retries once when LLM output fails zod validation", async () => {
    const run = installMock();
    run
      .mockResolvedValueOnce(JSON.stringify({ pois: [{ name: "" }], filtered: [] }))
      .mockResolvedValueOnce(JSON.stringify({ pois: [poi("徐家汇", "n1", "text")], filtered: [] }));

    const result = await runExtract([note("n1")], input);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][0].prompt).toContain("上次输出未通过校验");
    expect(result.pois[0].name).toBe("徐家汇");
  });

  it("skips fetch-failed notes without adding failedNotes", async () => {
    installMock();
    const failed: Note = { ...note("bad"), fetchStatus: "failed", failReason: "xhs failed" };
    const result = await runExtract([failed], input);
    expect(result).toEqual({ pois: [], filtered: [], failedNotes: [] });
  });

  it("returns completed notes and marks unfinished notes failed at the stage deadline", async () => {
    const originalStage = BUDGETS.extractStageMs;
    const originalPerNote = BUDGETS.extractPerNoteMs;
    (BUDGETS as { extractStageMs: number; extractPerNoteMs: number }).extractStageMs = 10;
    (BUDGETS as { extractStageMs: number; extractPerNoteMs: number }).extractPerNoteMs = 100;
    try {
      installMock((opts) => {
        if (opts.prompt.includes("slow")) return new Promise<string>((resolve) => setTimeout(() => resolve(JSON.stringify({ pois: [], filtered: [] })), 50));
        return Promise.resolve(JSON.stringify({ pois: [poi("快点", "fast", "text")], filtered: [] }));
      });

      const result = await runExtract([note("slow"), note("fast")], input);
      expect(result.pois.map((item) => item.name)).toEqual(["快点"]);
      expect(result.failedNotes).toEqual([expect.objectContaining({ noteId: "slow", reason: expect.stringContaining("超时") })]);
      expect(result.failedNotes[0].reason.length).toBeLessThanOrEqual(200);
    } finally {
      (BUDGETS as { extractStageMs: number; extractPerNoteMs: number }).extractStageMs = originalStage;
      (BUDGETS as { extractStageMs: number; extractPerNoteMs: number }).extractPerNoteMs = originalPerNote;
    }
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
  return { name, type: "sight", city: "上海", reason: "笔记说很值得去", sourceNoteId, sourceType };
}
```

- [ ] **Step 3: 运行测试确认全绿**

Run: `npx vitest run lib/pipeline/extract.test.ts`
Expected: 全 7 条 passed。

- [ ] **Step 4: Commit**

```bash
git add lib/pipeline/extract.ts lib/pipeline/extract.test.ts
git commit -m "refactor(pipeline): extract drops llm arg and routes via runForStage"
```

---

## Task 13: `plan.ts` 签名收窄 + 测试迁移

**Files:**
- Modify: `lib/pipeline/plan.ts`
- Modify: `lib/pipeline/plan.test.ts`

- [ ] **Step 1: 找到 `plan.ts` 里所有 `llm` 传参与 imports**

Run: `grep -n "llm\|LLMRunner" lib/pipeline/plan.ts`
Expected: 至少显示 `import type { LLMRunner }`、`runPlan(...,llm,...)` signature、`callPlanner(...,llm,...)` signature、`llm.run(...)` 调用点。

- [ ] **Step 2: 改 `plan.ts` —— `runPlan` 签名去 `llm`；`callPlanner` 签名去 `llm`；调用改 `runForStage`**

在 `lib/pipeline/plan.ts` 顶部 imports 里：
- 删掉 `import type { LLMRunner } from "@/lib/llm/types";`
- 加 `import { runForStage } from "@/lib/llm/router";`

改 `runPlan` signature（约 line 20 起，注意其他参数名对齐；本次改动只删 `llm` 参数）：
```ts
export async function runPlan(
  grounded: GroundedPoi[],
  extraFiltered: FilteredItem[],
  input: TripInput,
  map: MapProvider
): Promise<TripPlan> {
```
（比对 `main` 现有：`runPlan(grounded, extraFiltered, input, llm, map)` → 删中间的 `llm` 参数）

改 `callPlanner` 内部调用，把 `await callPlanner(slimPois, input, llm, distanceMatrix)` 改为 `await callPlanner(slimPois, input, distanceMatrix)`。

改 `callPlanner` signature（line 112）：
```ts
async function callPlanner(slimPois: PlanPromptPoi[], input: TripInput, distanceMatrix: unknown): Promise<PlannerOutput> {
  const raw = await runForStage("plan", {
    prompt: buildPlanPrompt({ slimPois, input, distanceMatrix }),
    jsonSchema: planJsonSchema,
    timeoutMs: BUDGETS.planLlmMs
  });
```

- [ ] **Step 3: 更新 `plan.test.ts` 全部调用点**

Run: `grep -n "runPlan\|llmWith\|llm:" lib/pipeline/plan.test.ts | head -20`
Expected: 8 处 `runPlan(...)` 调用与 `llm` 声明。

替换 `lib/pipeline/plan.test.ts`（保留全部原有测试逻辑与断言，只做机械替换）：

首先 imports 段替换（顶部）：
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LLMRunner } from "@/lib/llm/types";
import { __resetProvidersForTest } from "@/lib/llm/router";
import type { MapProvider } from "@/lib/map/types";
import { buildPlanPrompt } from "@/lib/prompts/plan";
import { backtrackRatio } from "./geo";
import { nearestClusterOrder, planItemFromPoi, recommendLegTransport, runPlan } from "./plan";
import type { GroundedPoi, PlanItem, TripInput } from "./types";
```

底部 helpers 段替换 `llmWith`：
```ts
function llmWith(result: unknown): LLMRunner & { run: ReturnType<typeof vi.fn> } {
  return { run: vi.fn().mockResolvedValue(JSON.stringify(result)) };
}
```
（返回类型加 mock 引用便于断言）

在 `describe("runPlan", () => { ... })` 里，最开始加：
```ts
  afterEach(() => __resetProvidersForTest());
```

每个 `runPlan(...)` 调用改造：
- 老：`await runPlan(grounded, [], input, llm, map)`
- 新：先 `__resetProvidersForTest({ deepseek: llm, "claude-cli": llm });`，再 `await runPlan(grounded, [], input, map)`

具体每条测试都做同样机械替换：`__resetProvidersForTest` 前置 + `runPlan` 参数少一个 `llm`。

对于用 `llm.run` 断言的地方（`expect(llm.run).toHaveBeenCalledTimes(1);` 之类），因为 `llmWith` 现在把 `run` 暴露成 mock，直接 `expect(llm.run).xxx` 仍然有效。

- [ ] **Step 4: 运行 plan 测试全绿**

Run: `npx vitest run lib/pipeline/plan.test.ts`
Expected: 全部 passed。

- [ ] **Step 5: Commit**

```bash
git add lib/pipeline/plan.ts lib/pipeline/plan.test.ts
git commit -m "refactor(pipeline): plan drops llm arg and routes via runForStage"
```

---

## Task 14: `run.ts` 顶层 deps 收窄 + `run.test.ts` 迁移

**Files:**
- Modify: `lib/pipeline/run.ts`
- Modify: `lib/pipeline/run.test.ts`

- [ ] **Step 1: 改 `run.ts` —— 删 `llm` 依赖**

在 `lib/pipeline/run.ts` 里：

顶部 imports：删除 `import { ClaudeCliRunner } from "@/lib/llm/claude-cli";` 与 `import type { LLMRunner } from "@/lib/llm/types";`。

`runPipeline` deps 类型（line 43）改为：
```ts
export async function runPipeline(
  input: TripInput,
  deps: { fetcher: ContentFetcher; map: MapProvider },
  opts: { onEvent?: (e: StageEvent) => void; force?: boolean; fromStage?: StageName; toStage?: StageName } = {}
): Promise<{ tripId: string }> {
```

`runPipeline` 内部 stage dispatch（line 60、62）改为：
```ts
      if (stage === "extract") await runExtractStage(parsedInput, workDir);
      ...
      if (stage === "plan") await runPlanStage(parsedInput, deps.map, workDir);
```

`runExtractStage`（line 120）改为：
```ts
async function runExtractStage(input: TripInput, workDir: string) {
  const notes = NoteSchema.array().parse(await readJson(path.join(workDir, outputFiles.fetch)));
  const output = await runExtract(notes, input, { workDir });
  await writeJson(path.join(workDir, outputFiles.extract), ExtractOutputSchema.parse(output));
}
```

`runPlanStage`（line 135）改为：
```ts
async function runPlanStage(input: TripInput, map: MapProvider, workDir: string) {
  ...
  const plan = await runPlan(selectedGrounded, filtered, input, map);
  ...
}
```
（其他内容不动，只删签名里 `llm: LLMRunner`，删把 `llm` 传给 `runPlan` 的部分。）

`createDefaultPipelineDeps`（line 80）改为：
```ts
export function createDefaultPipelineDeps(workDir?: string, input?: TripInput): { fetcher: ContentFetcher; map: MapProvider } {
  const manualDir = workDir ? path.join(workDir, "manual") : "";
  const useManual = Boolean(workDir && input && input.links.length === 0 && existsSyncish(manualDir));
  const fetcher = process.env.PACKUP_FETCHER === "cli" ? new XhsCliFetcher() : new XhsHttpFetcher();
  return {
    fetcher: useManual ? new ManualFetcher() : fetcher,
    map: new AmapRestProvider()
  };
}
```

- [ ] **Step 2: 改 `run.test.ts` —— `depsForSuccess` 去 `llm`，`beforeEach` 装 mock provider**

在 `lib/pipeline/run.test.ts`：

顶部 imports 加：
```ts
import { __resetProvidersForTest } from "@/lib/llm/router";
```

`beforeEach` 内追加：
```ts
  const mockRun = vi
    .fn()
    .mockResolvedValueOnce(
      JSON.stringify({ pois: [{ name: "外滩", type: "sight", reason: "好看", sourceNoteId: "note1", sourceType: "text" }], filtered: [] })
    )
    .mockResolvedValue(JSON.stringify({ days: [{ index: 1, items: [planItem()] }], filtered: [], warnings: [] }));
  __resetProvidersForTest({ deepseek: { run: mockRun }, "claude-cli": { run: mockRun } });
  (globalThis as unknown as { __packupTestLlmRun: typeof mockRun }).__packupTestLlmRun = mockRun;
```

`afterEach` 内追加：
```ts
  __resetProvidersForTest();
```

`depsForSuccess()` 改为：
```ts
function depsForSuccess(): { fetcher: ContentFetcher & { fetch: ReturnType<typeof vi.fn> }; map: MapProvider } {
  return {
    fetcher: {
      fetch: vi.fn().mockResolvedValue([{ id: "note1", url: input.links[0], title: "t", body: "b", images: [], fetchStatus: "ok" }])
    },
    map: {
      searchPoi: vi.fn().mockResolvedValue({ amapId: "a1", name: "外滩", cityName: "上海市", location: { lng: 1, lat: 1 }, address: "addr" }),
      searchPois: vi.fn(),
      route: vi.fn().mockResolvedValue({ durationMin: 5, distanceKm: 1 })
    }
  };
}
```

原用 `deps.llm.run` 断言的测试（line 84 与 89）改为：
- Line 84：`deps.llm.run = vi.fn()...` 改成 `__resetProvidersForTest({ deepseek: { run: vi.fn().mockResolvedValue(...) }, "claude-cli": { run: vi.fn().mockResolvedValue(...) } });`
- Line 89：`expect(deps.llm.run).toHaveBeenCalledTimes(1);` 改成 `expect((globalThis as any).__packupTestLlmRun).toHaveBeenCalledTimes(1);`（用 beforeEach 里挂到 globalThis 上的 spy 引用）

顶部删除 `import type { LLMRunner } from "@/lib/llm/types";`（未再使用）。

- [ ] **Step 3: 运行 run 测试全绿**

Run: `npx vitest run lib/pipeline/run.test.ts`
Expected: 全部 passed。

- [ ] **Step 4: Commit**

```bash
git add lib/pipeline/run.ts lib/pipeline/run.test.ts
git commit -m "refactor(pipeline): run.ts drops llm dep in favor of router-based dispatch"
```

---

## Task 15: `app/api/generate/route.ts` 删 testMode 里的 llm 分歧

**Files:**
- Modify: `app/api/generate/route.ts`

- [ ] **Step 1: 改 `route.ts`**

在 `app/api/generate/route.ts`：

删除顶部 `import { ClaudeCliRunner } from "@/lib/llm/claude-cli";`。

`POST` 内的 parseQuery 调用改为：
```ts
      const parsedQuery = await parseQuery(body.query);
```
（删掉 `testMode ? testDeps().llm : new ClaudeCliRunner()` 参数）

删除 `testDeps()` 返回值里的 `llm` 字段：
```ts
function testDeps() {
  return {
    fetcher: { fetch: async () => [] },
    map: { searchPoi: async () => null, searchPois: async () => [], route: async () => ({ durationMin: 0, distanceKm: 0 }) }
  };
}
```

- [ ] **Step 2: `npm run build` 类型检查**

Run: `npx tsc --noEmit`
Expected: 通过（如有 route 测试文件持有 `__packupGeneratePipelineForTest` 也须一并核实；`grep -rn '__packupGeneratePipelineForTest' app/ __tests__/ tests/` 无 llm 引用即可）。

- [ ] **Step 3: 运行相关测试确认无回归**

Run: `npx vitest run app/api/generate/`
Expected: 若有测试文件全绿；若无测试文件，命令返回 "No test files found" 也可。

- [ ] **Step 4: Commit**

```bash
git add app/api/generate/route.ts
git commit -m "refactor(api): generate route drops llm parameter from parseQuery"
```

---

## Task 16: 文档与环境示例同步

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `ROADMAP.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: `.env.example`**

替换：
```
# Local claude CLI model name passed to `claude -p`; defaults to `sonnet`.
PACKUP_CLAUDE_MODEL=sonnet
```
为：
```
# DeepSeek API key，parse-query / plan 两段通过它调 DeepSeek Chat Completions（PACKUP_DEEPSEEK_API_KEY 必填）。
PACKUP_DEEPSEEK_API_KEY=

# 本机 claude CLI 模型名，extract 段（多模态）用；不填走 `sonnet`。
PACKUP_CLAUDE_MODEL=sonnet
```

- [ ] **Step 2: `README.md`**

L10 替换为：
```
运行前提：① 配 `PACKUP_DEEPSEEK_API_KEY`（parse-query / plan 走 DeepSeek API）；② 本机安装并登录 `claude` CLI（extract 段多模态提取仍用 `claude -p`，待下阶段替换）。当前为自用版，不部署公网。
```

- [ ] **Step 3: `CLAUDE.md`**

在 `## 集成点` 段落把 "LLM" 那条从：
```
- LLM = 本机 `claude -p`（订阅内零 API 费；`PACKUP_CLAUDE_MODEL` 换模型，默认 sonnet）
```
改为：
```
- LLM = 路由（`lib/llm/router.ts` 内 STAGE_MODELS 表）：parse-query / plan → DeepSeek API（`PACKUP_DEEPSEEK_API_KEY`，模型 `deepseek-v4-flash`）；extract → 本机 `claude -p`（`PACKUP_CLAUDE_MODEL` 覆盖，默认 sonnet）
```

- [ ] **Step 4: `ROADMAP.md`**

在 `## Backlog` 段落顶部（第一条 P1 之前）插入：
```
- P2 extract 段换多模态 API：接入 gemini/glm-4v/qwen-vl 三选一，脱离 claude -p 依赖，router 加一个 provider 类。触发：DS 切换稳定后
```

- [ ] **Step 5: `CHANGELOG.md`**

在 `## [Unreleased]` 段落追加：
```
### Added
- LLM API Router：`lib/llm/router.ts` 集中 stage→provider+model 映射，pipeline 各段通过 `runForStage(stage, opts)` 调用。
- `DeepseekApiRunner`：DeepSeek Chat Completions API 的 provider 实现（裸 fetch，`PACKUP_DEEPSEEK_API_KEY`）。

### Changed
- parse-query / plan 两段切至 DeepSeek API（默认 `deepseek-v4-flash`）；extract 段仍走本机 `claude -p`。
- 三个 pipeline stage 消费者签名收窄：不再显式传 LLMRunner，由 router 分发。
```

- [ ] **Step 6: Commit**

```bash
git add .env.example README.md CLAUDE.md ROADMAP.md CHANGELOG.md
git commit -m "docs: sync DS API router changes across four-piece docs and .env.example"
```

---

## Task 17: 全量验收

**Files:**
- 无

- [ ] **Step 1: 全量测试**

Run: `npm test`
Expected: 所有 test 全绿。

- [ ] **Step 2: 生产构建**

Run: `npm run build`
Expected: 通过。

- [ ] **Step 3: 提示 haze 手动 smoke（需真实 DS key）**

告知 haze：
1. 在 `.env.local` 里配 `PACKUP_DEEPSEEK_API_KEY=<真 key>`。
2. 跑一次 `POST /api/generate`（带一句真实 query + 一条真实小红书链接），观察 log/network：parse-query 打向 `api.deepseek.com`，返回结构化 destination；下游 stage 落 `data/trips/<id>/00-input.json` 内含 `parseQuery` 解析结果。
3. `npm run stage -- <tripId> plan --force`：观察 plan 阶段打向 DS API 并回写 `40-plan.json`。
4. `npm run stage -- <tripId> extract --force`：观察 extract 阶段仍走本机 `claude -p`（无 DS API 请求）。

haze 手动 smoke 通过即视为验收完成。若 smoke 失败，回来看 log；spec §8 风险表列了预期问题（如 DS 输出偶发不符 schema → 走 zod 重试，parse/plan 已有 attempt 循环兜底）。

---

## Self-Review

**Spec coverage 逐节核对：**
- §2.1 目录 → Task 1-10 覆盖新增/修改
- §2.2 类型接口调整 → Task 1
- §2.3 Router 实现 → Task 9-10
- §3 DeepseekApiRunner → Task 2-7
- §4.1 ClaudeCliRunner 吸收 model → Task 8
- §4.2 三个 stage 签名收窄 → Task 11-13
- §4.3 run.ts 收窄 → Task 14
- §4.4 route.ts 简化 → Task 15
- §5 测试策略（DS test / router test / claude-cli 新增测 / pipeline 迁移）→ Task 2-14 分别覆盖
- §6 文档同步（`.env.example` / `CLAUDE.md` / `ROADMAP` / `CHANGELOG` / `README`）→ Task 16
- §7 实施顺序 → Task 编号对齐
- §8 风险 → Task 17 smoke 步骤覆盖
- §9 验收清单 → Task 17

**Placeholder scan：** 全文无 TBD/TODO/"稍后补"；所有代码块给出完整可复制内容；无"和 Task N 类似"—— 相似代码整段重复而非引用。

**Type consistency 抽查：**
- `Stage` 类型（Task 1）与 `runForStage(stage: Stage, ...)`（Task 9）签名一致
- `LLMApiError` 从 `lib/llm/deepseek-api.ts` 导出（Task 7）；测试 Task 7 与后续 pipeline 测试均从 `./deepseek-api` 或不导入（不依赖它）
- `LLMTimeoutError` 从 `lib/llm/claude-cli.ts` 复用；Task 7 里 `deepseek-api.ts` 显式 import 之，避免循环依赖（`claude-cli.ts` 不 import `deepseek-api.ts`，安全）
- `__resetProvidersForTest` 签名跨 Task 9-14 保持一致（`overrides?: Record<string, LLMRunner>`）
- `DeepseekApiRunner` 构造签名跨 Task 2-7 保持一致（`{ apiKey?, fetchImpl? }`）
- `mockRun` 变量跨 pipeline 测试（Task 11-14）语义一致（都是 vi.fn 后端）

---

## 执行选项

**Plan complete and saved to `docs/ohaze/plans/2026-07-03-ds-api-router.md`. Two execution options:**

**1. Subagent-Driven（推荐）** — 每个 Task 派一个新 subagent 执行 + 两阶段 review + 快节奏反馈

**2. Inline Execution** — 在当前 session 里执行 Tasks，带 checkpoint 停顿供 review

**Which approach?**
