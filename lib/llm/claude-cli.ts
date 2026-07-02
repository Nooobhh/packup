import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { LLMRunner } from "./types";

type ExecClaude = (args: string[], options: { timeoutMs: number }) => Promise<{ stdout: string; stderr?: string }>;

export class LLMTimeoutError extends Error {
  constructor(message = "claude CLI timed out") {
    super(message);
    this.name = "LLMTimeoutError";
  }
}

export class ClaudeCliRunner implements LLMRunner {
  private readonly execClaude: ExecClaude;
  private readonly scratchDir: string;
  private readonly env: Record<string, string | undefined>;

  constructor(opts: { execClaude?: ExecClaude; scratchDir?: string; env?: Record<string, string | undefined> } = {}) {
    this.execClaude = opts.execClaude ?? defaultExecClaude;
    this.scratchDir = opts.scratchDir ?? path.join(os.tmpdir(), "packup-claude");
    this.env = opts.env ?? process.env;
  }

  async run(opts: Parameters<LLMRunner["run"]>[0]): Promise<string> {
    await mkdir(this.scratchDir, { recursive: true });
    let schemaPath: string | undefined;

    try {
      const prompt = withImageReferences(opts.prompt, opts.images ?? []);
      const args = ["-p", prompt, "--output-format", "json", "--model", this.env.PACKUP_CLAUDE_MODEL || "sonnet"];
      if (opts.jsonSchema) {
        schemaPath = path.join(this.scratchDir, `schema-${randomUUID()}.json`);
        await writeFile(schemaPath, JSON.stringify(opts.jsonSchema), "utf8");
        args.push("--json-schema", schemaPath);
      }
      if (opts.mcpConfig) args.push("--mcp-config", opts.mcpConfig);
      if (opts.allowedTools?.length) args.push("--allowedTools", opts.allowedTools.join(","));

      const result = await this.execClaude(args, { timeoutMs: opts.timeoutMs });
      return unwrapClaudeJson(result.stdout);
    } catch (error) {
      if (isTimeout(error)) throw new LLMTimeoutError(error instanceof Error ? error.message : undefined);
      const stderr = typeof error === "object" && error && "stderr" in error ? String((error as { stderr?: unknown }).stderr ?? "") : "";
      if (stderr.trim()) throw new Error(stderr.trim());
      throw error;
    } finally {
      if (schemaPath) await rm(schemaPath, { force: true });
    }
  }
}

function defaultExecClaude(args: string[], options: { timeoutMs: number }): Promise<{ stdout: string; stderr?: string }> {
  return new Promise((resolve, reject) => {
    execFile("claude", args, { timeout: options.timeoutMs, maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stderr, timedOut: Boolean((error as NodeJS.ErrnoException & { killed?: boolean }).killed) }));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function withImageReferences(prompt: string, images: string[]) {
  if (images.length === 0) return prompt;
  return `${prompt}\n\n本地图片路径:\n${images.map((image) => `- ${image}`).join("\n")}`;
}

function unwrapClaudeJson(stdout: string) {
  const trimmed = stdout.trim();
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === "string") return parsed;
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      for (const key of ["result", "output", "text", "message"]) {
        if (typeof obj[key] === "string") return obj[key] as string;
      }
      const content = obj.content;
      if (typeof content === "string") return content;
      if (Array.isArray(content)) {
        return content
          .map((part) => (part && typeof part === "object" && "text" in part ? String((part as { text: unknown }).text) : ""))
          .join("")
          .trim();
      }
    }
  } catch {
    return trimmed;
  }
  return trimmed;
}

function isTimeout(error: unknown) {
  return Boolean(error && typeof error === "object" && "timedOut" in error && (error as { timedOut?: boolean }).timedOut);
}
