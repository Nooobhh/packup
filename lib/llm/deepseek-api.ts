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
