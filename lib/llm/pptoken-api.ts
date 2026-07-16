import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LLMRunner } from "./types";
import { LLMTimeoutError } from "./claude-cli";
import { LLMApiError } from "./deepseek-api";

const ENDPOINT = "https://api.pptoken.cc/v1/chat/completions";
const DEFAULT_MODEL = "gpt-5.6";

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif"
};

type MessageContent = string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;

export class PptokenApiRunner implements LLMRunner {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: { apiKey?: string; fetchImpl?: typeof fetch } = {}) {
    const key = opts.apiKey ?? process.env.PACKUP_PPTOKEN_API_KEY;
    if (!key) throw new Error("PACKUP_PPTOKEN_API_KEY is required");
    this.apiKey = key;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async run(opts: Parameters<LLMRunner["run"]>[0]): Promise<string> {
    const body: Record<string, unknown> = {
      model: opts.model ?? DEFAULT_MODEL,
      messages: await buildMessages(opts.prompt, opts.jsonSchema, opts.images)
    };
    if (opts.reasoningEffort) body.reasoning_effort = opts.reasoningEffort;
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
        throw new LLMApiError(res.status, `pptoken API ${res.status}: ${summarize(text)}`);
      }
      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      return json.choices?.[0]?.message?.content?.trim() ?? "";
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new LLMTimeoutError(`pptoken API timed out after ${opts.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

async function buildMessages(prompt: string, jsonSchema?: object, images?: string[]) {
  const messages: { role: string; content: MessageContent }[] = [];
  if (jsonSchema) {
    messages.push({
      role: "system",
      content:
        "输出必须是符合以下 JSON schema 的合法 JSON 对象。只返回 JSON，不要 markdown code fence。\n\n" +
        JSON.stringify(jsonSchema)
    });
  }
  if (images?.length) {
    const parts: Exclude<MessageContent, string> = [{ type: "text", text: prompt }];
    for (const image of images) {
      parts.push({ type: "image_url", image_url: { url: await imageDataUrl(image) } });
    }
    messages.push({ role: "user", content: parts });
  } else {
    messages.push({ role: "user", content: prompt });
  }
  return messages;
}

async function imageDataUrl(file: string) {
  const mime = IMAGE_MIME[path.extname(file).toLowerCase()] ?? "image/jpeg";
  const bytes = await readFile(file);
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

function summarize(v: string) {
  return v.replace(/\s+/g, " ").trim().slice(0, 200);
}
