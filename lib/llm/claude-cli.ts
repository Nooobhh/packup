import { execFile } from "node:child_process";
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
  private readonly env: Record<string, string | undefined>;

  constructor(opts: { execClaude?: ExecClaude; env?: Record<string, string | undefined> } = {}) {
    this.execClaude = opts.execClaude ?? defaultExecClaude;
    this.env = opts.env ?? process.env;
  }

  async run(opts: Parameters<LLMRunner["run"]>[0]): Promise<string> {
    try {
      const prompt = withImageReferences(opts.prompt, opts.images ?? []);
      const model = opts.model ?? this.env.PACKUP_CLAUDE_MODEL ?? "sonnet";
      const args = ["-p", prompt, "--output-format", "json", "--model", model];
      // claude CLI 2.1.195 的 --json-schema 参数要求内联 JSON 字符串(传文件路径会被当 JSON 解析而报错)
      if (opts.jsonSchema) args.push("--json-schema", JSON.stringify(opts.jsonSchema));
      if (opts.mcpConfig) args.push("--mcp-config", opts.mcpConfig);
      if (opts.allowedTools?.length) args.push("--allowedTools", opts.allowedTools.join(","));

      const result = await this.execClaude(args, { timeoutMs: opts.timeoutMs });
      return unwrapClaudeJson(result.stdout);
    } catch (error) {
      if (isTimeout(error)) throw new LLMTimeoutError(`claude CLI timed out after ${opts.timeoutMs}ms`);
      const errObj = (typeof error === "object" && error ? error : {}) as { stderr?: unknown; stdout?: unknown };
      const stderr = String(errObj.stderr ?? "").trim();
      if (stderr) throw new Error(`claude CLI failed: ${summarize(stderr)}`);
      // claude 非零退出时错误常在 stdout 的 JSON(如 usage limit),提取出来别让报错只剩命令回显
      const stdoutTail = extractErrorFromStdout(String(errObj.stdout ?? ""));
      throw new Error(`claude CLI failed: ${summarize(stdoutTail || "nonzero exit")}`);
    }
  }
}

function defaultExecClaude(args: string[], options: { timeoutMs: number }): Promise<{ stdout: string; stderr?: string }> {
  return new Promise((resolve, reject) => {
    // 用 AbortController + SIGKILL 硬超时:execFile 内置 timeout 发 SIGTERM,
    // 但 claude CLI 优雅关闭时会挂起忽略 SIGTERM,故到点直接 SIGKILL 强杀。
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs);

    const child = execFile(
      "claude",
      args,
      { signal: controller.signal, killSignal: "SIGKILL", maxBuffer: 20 * 1024 * 1024 },
      (error, stdout, stderr) => {
        clearTimeout(timer);
        if (error) {
          reject(Object.assign(error, { stderr, timedOut: timedOut || Boolean((error as NodeJS.ErrnoException & { killed?: boolean }).killed) }));
          return;
        }
        resolve({ stdout, stderr });
      }
    );
    // 立即关 stdin,避免 claude -p 等待 stdin 3 秒
    child.stdin?.end();
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
      // --json-schema 模式下结构化结果在 structured_output(已解析对象),优先取用
      if (obj.structured_output && typeof obj.structured_output === "object") {
        return JSON.stringify(obj.structured_output);
      }
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

function extractErrorFromStdout(stdout: string) {
  const trimmed = stdout.trim();
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const result = typeof parsed.result === "string" ? parsed.result : "";
    if (parsed.is_error || result) return result.slice(0, 200) || JSON.stringify(parsed).slice(0, 200);
  } catch {
    return trimmed.slice(-200);
  }
  return "";
}

function summarize(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 200);
}

function isTimeout(error: unknown) {
  return Boolean(error && typeof error === "object" && "timedOut" in error && (error as { timedOut?: boolean }).timedOut);
}
