# packup LLM API Router — Design Spec
> 读者：Codex（执行者）。基线：`main` 4a8f396（0.4.0 画布工作台已合入待发版）。
> 本 spec 的所有 file:line 引用以 `main` 为准。

## 0. 上下文与目标

**背景**：0.4.0 之前所有 LLM 调用走本机 `claude -p`（`lib/llm/claude-cli.ts`），是开发期临时方案；最终 pipeline 各段都要走 API。DS（DeepSeek）官方即将（2026-07-24）弃用 `deepseek-chat / deepseek-reasoner`，改名 `deepseek-v4-flash / deepseek-v4-pro`；同时 DS 无多模态能力，而 extract 段依赖多模态提取 POI。

**本 session 目标（R1 范围）**：
1. 建立 LLM Provider Router 抽象：pipeline 各段声明式挑对应 provider + model。
2. 交付一个 API provider 实现：`DeepseekApiRunner`（裸 fetch，无 SDK 依赖）。
3. `parse-query` / `plan` 两段切到 DeepSeek API。
4. `extract` 段保留 `claude-cli` provider（作为 router 的一员），下一 session 换多模态 API 时只需新增 provider 类、改一行路由表。

**非目标（本 session 不做）**：
- extract 换多模态 API（下一 session）。
- fallback 机制（主模型挂了自动切备用）。
- 每 stage 的 model 走 env 变量覆盖（决策：写死在代码里，改配置直接改代码）。
- Token / 成本上报。
- Multi-turn conversation history。

**硬约束**：
- 现有 pipeline 测试对 LLM 全 mock（`~/CLAUDE.md` 编码原则），不动。
- 现有段级超时（`BUDGETS.parseQueryMs / extractPerNoteMs / planLlmMs`）语义不动。
- `claude-cli` 现有的 `--json-schema / --mcp-config / --allowedTools` 能力位保留（ROADMAP P3 高德 MCP 试验会用）。

## 1. 决策摘要

| 决策 | 定案 |
|---|---|
| Router 覆盖范围 | R1：DS provider + parse/plan 切 DS；extract 保留 claude-cli 作 router 一员 |
| 模型映射 | parseQuery / plan → `deepseek-v4-flash`；extract → `sonnet`（claude-cli） |
| env 覆盖 model | **不开**，改 model 直接改 `router.ts` 里 STAGE_MODELS 表 |
| fallback | **不加**，调用失败直接抛，pipeline 段级"部分成功"机制接住 |
| HTTP 方案 | 裸 fetch，无新依赖；未来新 provider 逐家用官方 SDK 或裸 fetch，不强求统一 |
| API key env 命名 | `PACKUP_DEEPSEEK_API_KEY`（与 `PACKUP_CLAUDE_MODEL` 前缀一致） |
| DS endpoint | 写死 `https://api.deepseek.com/chat/completions`，无 env 覆盖 |
| DS `temperature` | `0.2`（parse/plan 都要结构化稳定输出，纯 0 有 corner case 卡死风险） |
| DS JSON 输出 | `response_format: {type: "json_object"}` + system message 携带 schema 描述（DS 无严格 json_schema 模式） |
| DS 图片输入 | 直接 throw（防止路由表配错时静默降级） |
| 单例 / 实例化时机 | Lazy 单例：首次 `runForStage` 触达该 provider 时才构造，避免只跑 extract 时被缺 DS key 卡住 |
| 测试注入 | Router 提供 `__resetProvidersForTest(overrides?)` 后门，pipeline 测试通过它安装 mock provider |

## 2. 架构

### 2.1 目录

```
lib/llm/
├── types.ts                  # LLMRunner 接口 + Stage 类型
├── claude-cli.ts             # 保留，改 3 行支持 opts.model
├── claude-cli.test.ts        # 现有 + 补一条 model 覆盖测试
├── deepseek-api.ts           # 新增
├── deepseek-api.test.ts      # 新增
├── router.ts                 # 新增
└── router.test.ts            # 新增
```

### 2.2 `LLMRunner` 接口调整

```ts
// lib/llm/types.ts
export type Stage = "parseQuery" | "extract" | "plan";

export interface LLMRunner {
  run(opts: {
    prompt: string;
    images?: string[];
    jsonSchema?: object;
    mcpConfig?: string;
    allowedTools?: string[];
    model?: string;      // ← 新增；router 分发时注入
    timeoutMs: number;
  }): Promise<string>;
}
```

- `mcpConfig / allowedTools`：仍是 optional 位，DS provider 忽略，claude-cli 照旧使用（ROADMAP P3 高德 MCP 试验用）。
- `model`：router 从 STAGE_MODELS 表里读并注入；消费者不直接指定。

### 2.3 Router

```ts
// lib/llm/router.ts
import type { LLMRunner, Stage } from "./types";
import { ClaudeCliRunner } from "./claude-cli";
import { DeepseekApiRunner } from "./deepseek-api";

const PROVIDERS: Record<string, () => LLMRunner> = {
  "deepseek":   () => new DeepseekApiRunner(),
  "claude-cli": () => new ClaudeCliRunner(),
};

const STAGE_MODELS: Record<Stage, { provider: keyof typeof PROVIDERS; model: string }> = {
  parseQuery: { provider: "deepseek",   model: "deepseek-v4-flash" },
  extract:    { provider: "claude-cli", model: "sonnet" },
  plan:       { provider: "deepseek",   model: "deepseek-v4-flash" },
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

/** 测试后门：安装 mock provider，或不带参复原为默认 lazy 工厂。 */
export function __resetProvidersForTest(overrides?: Record<string, LLMRunner>): void {
  instances.clear();
  if (overrides) for (const [k, v] of Object.entries(overrides)) instances.set(k, v);
}
```

**为什么用 lazy 单例而非 eager 全构造**：`DeepseekApiRunner` 构造函数会 fail-fast 校验 `PACKUP_DEEPSEEK_API_KEY`。如果 `npm run stage -- <id> extract` 单跑 extract，用不到 deepseek，就不该被缺 DS key 报错卡住。lazy 单例让"用到才构造"成立。

**为什么 `runForStage` 用 `Omit<..., "model">`**：语义上 model 是 router 的职责，不给消费者手滑传参绕过路由表的机会。

## 3. `DeepseekApiRunner` 实现

```ts
// lib/llm/deepseek-api.ts
import type { LLMRunner } from "./types";
import { LLMTimeoutError } from "./claude-cli";  // 复用既有 timeout 错误类

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
    const model = opts.model ?? DEFAULT_MODEL;
    const body: Record<string, unknown> = {
      model,
      messages: buildMessages(opts.prompt, opts.jsonSchema),
      temperature: 0.2,
    };
    if (opts.jsonSchema) body.response_format = { type: "json_object" };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const res = await this.fetchImpl(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new LLMApiError(res.status, `DeepSeek API ${res.status}: ${summarize(text)}`);
      }
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
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
        JSON.stringify(jsonSchema),
    });
  }
  messages.push({ role: "user", content: prompt });
  return messages;
}

function summarize(v: string) {
  return v.replace(/\s+/g, " ").trim().slice(0, 200);
}
```

### 错误分类

| 错误类 | 触发场景 | 消费者如何区分 |
|---|---|---|
| `LLMTimeoutError` | `AbortController` 触发 fetch 中断 | 与 claude-cli 保持一致，pipeline 段级超时逻辑不动 |
| `LLMApiError` | HTTP 非 2xx 响应（含 401/429/5xx） | 携带 status 码，pipeline 层可分辨鉴权/限流 |
| 裸 `Error` | 网络断开、JSON 解析失败等 | 走 pipeline 现有的通用错误捕获 |

现有 pipeline 三段的错误处理都是"抓住任何 error → 记 `failedNotes / warnings` → 部分成功"，新错误类不需要每段单独适配，但保留了未来做鉴权/限流告警时的抓手。

## 4. 消费者迁移

### 4.1 `ClaudeCliRunner` 吸收 `opts.model`

```ts
// lib/llm/claude-cli.ts:25 附近
- const args = ["-p", prompt, "--output-format", "json", "--model",
-   this.env.PACKUP_CLAUDE_MODEL || "sonnet"];
+ const model = opts.model ?? this.env.PACKUP_CLAUDE_MODEL ?? "sonnet";
+ const args = ["-p", prompt, "--output-format", "json", "--model", model];
```

`PACKUP_CLAUDE_MODEL` env 语义保留（用户可覆盖 stage 表里的默认），优先级：**opts.model > env > "sonnet"**。

### 4.2 三个 pipeline stage 签名收窄

```ts
// lib/pipeline/parse-query.ts
- export async function parseQuery(query: string, llm: LLMRunner): Promise<...>
+ export async function parseQuery(query: string): Promise<...>
    ...
-   const raw = await llm.run({ prompt, jsonSchema, timeoutMs: BUDGETS.parseQueryMs });
+   const raw = await runForStage("parseQuery", { prompt, jsonSchema, timeoutMs: BUDGETS.parseQueryMs });

// lib/pipeline/extract.ts
- export async function runExtract(notes: Note[], input: TripInput, llm: LLMRunner, opts): Promise<...>
+ export async function runExtract(notes: Note[], input: TripInput, opts): Promise<...>
- async function extractOne(note, input, llm) { ... llm.run({...}); }
+ async function extractOne(note, input)     { ... runForStage("extract", {...}); }

// lib/pipeline/plan.ts:callPlanner
- async function callPlanner(slimPois, input, llm, distanceMatrix): Promise<PlannerOutput>
+ async function callPlanner(slimPois, input, distanceMatrix): Promise<PlannerOutput>
-   const raw = await llm.run({ prompt, jsonSchema: planJsonSchema, timeoutMs: BUDGETS.planLlmMs });
+   const raw = await runForStage("plan", { prompt, jsonSchema: planJsonSchema, timeoutMs: BUDGETS.planLlmMs });
```

### 4.3 `lib/pipeline/run.ts` 顶层收窄

```ts
- export function createDefaultPipelineDeps(...): { fetcher; llm: LLMRunner; map } {
+ export function createDefaultPipelineDeps(...): { fetcher; map } {
    return {
      fetcher: ...,
-     llm: new ClaudeCliRunner(),
      map: ...,
    };
  }

- async function runExtractStage(input, llm, workDir) { ... await runExtract(notes, input, llm, { workDir }); }
+ async function runExtractStage(input, workDir)      { ... await runExtract(notes, input,      { workDir }); }

- async function runPlanStage(input, llm, map, workDir) { ... }
+ async function runPlanStage(input, map, workDir)      { ... }

// runFullPipeline 的 deps 参数类型同步收窄
- deps: { fetcher: ContentFetcher; llm: LLMRunner; map: MapProvider }
+ deps: { fetcher: ContentFetcher; map: MapProvider }
```

### 4.4 `app/api/generate/route.ts`

```ts
- const parsedQuery = await parseQuery(body.query, testMode ? testDeps().llm : new ClaudeCliRunner());
+ const parsedQuery = await parseQuery(body.query);
```

`testMode` 分支里的 `llm` 分歧删掉；测试环境改由**测试文件在 `beforeEach` 里调 `__resetProvidersForTest`** 安装 mock provider。route.ts 的 `testMode` 里 `fetcher / map` 分支保留不动（它们不走 router）。

## 5. 测试策略

### 5.1 `lib/llm/deepseek-api.test.ts`（新增）

| 用例 | 断言 |
|---|---|
| 构造缺 `PACKUP_DEEPSEEK_API_KEY` | 直接 throw `PACKUP_DEEPSEEK_API_KEY is required` |
| 构造传 apiKey opts | 不读 env，成功构造 |
| `run` 无 jsonSchema | 请求体不带 `response_format`；messages 只有 user 一条 |
| `run` 有 jsonSchema | 请求体带 `response_format: {type:"json_object"}`；messages 首条 role=system 携带序列化 schema |
| `run` opts.model 存在 | 请求体 `model` 用 opts.model，非 DEFAULT_MODEL |
| `run` opts.model 不存在 | 请求体 `model` = `deepseek-v4-flash` |
| `run` images 非空 | 立即 throw（不 fetch） |
| 401 响应 | 抛 `LLMApiError`，`status === 401`，message 含摘要 |
| 429 响应 | 抛 `LLMApiError`，`status === 429` |
| 500 响应 | 抛 `LLMApiError`，`status === 500` |
| AbortController 触发 | 抛 `LLMTimeoutError`，message 含 `timedOut after Nms` |
| 网络错误（fetch reject） | 抛裸 Error（透传） |
| 输出解析 | `choices[0].message.content` 提取；trim；缺字段则空串 |

### 5.2 `lib/llm/router.test.ts`（新增）

| 用例 | 断言 |
|---|---|
| `runForStage("parseQuery", opts)` | 分发到 deepseek provider，请求 opts 含 `model: "deepseek-v4-flash"` |
| `runForStage("extract", opts)` | 分发到 claude-cli provider，请求 opts 含 `model: "sonnet"` |
| `runForStage("plan", opts)` | 分发到 deepseek provider，请求 opts 含 `model: "deepseek-v4-flash"` |
| 同一 provider 二次调用 | `runForStage` 两次同 stage → 底层 provider mock 被调 2 次，但 `runForStage` 复用同一 provider 实例（通过 `__resetProvidersForTest({ deepseek: mock })` 安装 mock，断言 mock 是同一引用） |
| `__resetProvidersForTest({...})` | 覆盖后 `runForStage` 走 mock；不带参调用清空所有实例 |
| Unknown stage 或 provider 名 | 若 STAGE_MODELS 未包含 stage（类型层已挡）或 PROVIDERS 未注册 provider 名，`runForStage` 抛 `Unknown LLM provider: X` |

**测试实现**：router.test 全程用 `__resetProvidersForTest({ deepseek: mockA, "claude-cli": mockB })` 安装 mock，然后断言分发结果。**不单测 lazy 语义**（它是内部实现细节，`if (!instances.has)` 判断本身在代码里可见，无需额外测试证明）。

### 5.3 `lib/llm/claude-cli.test.ts`（补一条）

新增：
- `run` opts.model 存在 → args 里 `--model` 用 opts.model，压过 env 的 `PACKUP_CLAUDE_MODEL`。

现有 6 条测试保留不动。

### 5.4 Pipeline 测试迁移（机械替换）

`parse-query.test.ts` / `extract.test.ts` / `plan.test.ts` / `run.test.ts` 现在都是把 `LLMRunner` mock 传参进消费者。迁移模板：

```ts
import { __resetProvidersForTest } from "@/lib/llm/router";

let mockRun: ReturnType<typeof vi.fn>;
beforeEach(() => {
  mockRun = vi.fn().mockResolvedValue("...");
  const mock: LLMRunner = { run: mockRun };
  __resetProvidersForTest({ deepseek: mock, "claude-cli": mock });
});
afterEach(() => __resetProvidersForTest());

// 消费者调用去掉 llm 参数
await parseQuery(input);
await runExtract(notes, input, { workDir });
```

- `parse-query.test.ts` 现有 `mockLlm(result)` 工厂改成"返回 mock LLMRunner + 记 mockRun ref"；不再显式传参。
- `run.test.ts` 的 `depsForSuccess()` 返回 `{ fetcher, map }`（去掉 llm）。同时在 test 顶层 `beforeEach` 里安装 mock provider。
- `extract.test.ts` 里对 `llm.run` 的 mock 断言改成对 `mockRun` 的断言（同 spy 引用）。
- `plan.test.ts` 里现有多个 test 会构造不同行为的 `llm`（timeout / valid output / schema error）— 全部迁移到 `beforeEach` 里 `__resetProvidersForTest` 安装对应 mock。

## 6. 文档同步（收尾时一起 commit）

### 6.1 `.env.example`

现有末段（当前）：
```
# Local claude CLI model name passed to `claude -p`; defaults to `sonnet`.
PACKUP_CLAUDE_MODEL=sonnet
```

改为：
```
# DeepSeek API key，parse-query / plan 两段通过它调 DeepSeek Chat Completions（PACKUP_DEEPSEEK_API_KEY 必填）。
PACKUP_DEEPSEEK_API_KEY=

# 本机 claude CLI 模型名，extract 段（多模态）用；不填走 `sonnet`。
PACKUP_CLAUDE_MODEL=sonnet
```

### 6.2 `CLAUDE.md ## 集成点`

现有：
```
- LLM = 本机 `claude -p`（订阅内零 API 费；`PACKUP_CLAUDE_MODEL` 换模型，默认 sonnet）
```

改为：
```
- LLM = 路由（`lib/llm/router.ts` 内 STAGE_MODELS 表）：parse-query / plan → DeepSeek API（`PACKUP_DEEPSEEK_API_KEY`，模型 `deepseek-v4-flash`）；extract → 本机 `claude -p`（`PACKUP_CLAUDE_MODEL` 覆盖，默认 sonnet）
```

### 6.3 `ROADMAP.md ## Backlog`

新增一条置顶（因为它是完成 R1 后的下一步）：
```
- P2 extract 段换多模态 API：接入 gemini/glm-4v/qwen-vl 三选一，脱离 claude -p 依赖，router 加一个 provider 类。触发：DS 切换稳定后
```

### 6.4 `CHANGELOG.md [Unreleased]`

在现有 Unreleased 段追加：
```
### Added
- LLM API Router：`lib/llm/router.ts` 集中 stage→provider+model 映射，pipeline 各段通过 `runForStage(stage, opts)` 调用。
- `DeepseekApiRunner`：DeepSeek Chat Completions API 的 provider 实现（裸 fetch，`PACKUP_DEEPSEEK_API_KEY`）。

### Changed
- parse-query / plan 两段切至 DeepSeek API（默认 `deepseek-v4-flash`）；extract 段仍走本机 `claude -p`。
- 三个 pipeline stage 消费者签名收窄：不再显式传 LLMRunner，由 router 分发。
```

### 6.5 `README.md`

L10「运行前提：本机安装并登录 `claude` CLI（LLM 环节走本机订阅，零 API 费用）」改为：
```
运行前提：① 配 `PACKUP_DEEPSEEK_API_KEY`（parse-query / plan 走 DeepSeek API）；② 本机安装并登录 `claude` CLI（extract 段多模态提取仍用 `claude -p`，待下阶段替换）。当前为自用版，不部署公网。
```

L19「Extract（claude -p 多模态提取 POI，纯图笔记同路）」**保持不动**——extract 段本 session 确实不动。

## 7. 实施顺序建议

Codex 按此顺序落地可最大化局部可测：

1. `lib/llm/types.ts` 加 `Stage` 类型 + `model?` 字段。
2. `lib/llm/deepseek-api.ts` + 测试（独立可跑，无消费者依赖）。
3. `lib/llm/claude-cli.ts` 3 行修改 + 补一条测试。
4. `lib/llm/router.ts` + 测试。
5. `parse-query.ts` 签名收窄 + 测试迁移；`extract.ts` 同；`plan.ts` 同。
6. `run.ts` 顶层 deps / stage 参数收窄 + `run.test.ts` 迁移。
7. `app/api/generate/route.ts` testMode 分支简化。
8. 四件套 + `.env.example` 同步。
9. `npm run build` + `npm test` 全绿。
10. 真实链路验收：配一个 DS key 到 `.env.local`，跑一次 `npm run stage -- <id> parseQuery` 与 `plan`，观察 API 响应与耗时。

## 8. 风险与缓解

| 风险 | 缓解 |
|---|---|
| DS `response_format: json_object` 输出偶发不符 schema | 消费者层已有 zod 校验 + 重试 1 次逻辑（`extract.ts:39` 的 attempt loop 是范式），parse/plan 也走同样保护；本 spec 不动这层。 |
| DS 弃用日期（2026-07-24）本 session 后即到 | 本 spec 直接用新模型名 `deepseek-v4-flash`，无迁移债。 |
| 现有 pipeline 测试全走 mock，DS 真实响应 shape 变化不被覆盖 | 通过步骤 10 真实链路手工验收兜底；未来做 canary（out of scope）。 |
| Route 层 `testMode` 分支被隐式改动 | 保留 `fetcher / map` 分支不动，只删 `llm` 分歧；测试通过 `__resetProvidersForTest` 显式安装 provider mock，语义等价。 |
| Lazy 单例在测试间泄漏状态 | `afterEach(__resetProvidersForTest)` 强约束；router.test 自身也验证复原路径。 |

## 9. 验收清单

- [ ] `npm test` 全绿（含新增 `deepseek-api.test.ts` / `router.test.ts` 与迁移后的 pipeline 测试）
- [ ] `npm run build` 通过
- [ ] 配 `PACKUP_DEEPSEEK_API_KEY` 后，跑一次 `POST /api/generate`：parse-query 步骤走 DS API（观察 log / network），成功产出 `00-input.json`（内含 `parseQuery` 解析结果）
- [ ] `npm run stage -- <tripId> plan --force` 能触到 DS API 并重跑出 `40-plan.json`
- [ ] `npm run stage -- <tripId> extract --force` 仍走 `claude -p`（不触发 DS API）
- [ ] `.env.example` `CLAUDE.md` `ROADMAP.md` `CHANGELOG.md` 四件套同步 commit
- [ ] 真实链路：跑一次完整 `/api/generate`（一个真实小红书链接），观察 parse/plan 走 DS、extract 走 claude-cli 正常
