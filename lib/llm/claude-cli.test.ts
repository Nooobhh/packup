import { describe, expect, it, vi } from "vitest";
import type { LLMRunner } from "./types";
import { ClaudeCliRunner, LLMTimeoutError } from "./claude-cli";

describe("ClaudeCliRunner", () => {
  it("implements LLMRunner", () => {
    const runner: LLMRunner = new ClaudeCliRunner();
    expect(runner).toBeInstanceOf(ClaudeCliRunner);
  });

  it("assembles claude arguments with model override, inline json schema, tools, mcp, and image references", async () => {
    const execClaude = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({ result: "structured output" }),
      stderr: ""
    });
    const runner = new ClaudeCliRunner({ execClaude, env: { PACKUP_CLAUDE_MODEL: "opus" } });

    await expect(
      runner.run({
        prompt: "提取 POI",
        images: ["/abs/a.jpg", "/abs/b.jpg"],
        jsonSchema: { type: "object", properties: { ok: { type: "boolean" } } },
        mcpConfig: "/tmp/mcp.json",
        allowedTools: ["Read"],
        timeoutMs: 1000
      })
    ).resolves.toBe("structured output");

    const [args, options] = execClaude.mock.calls[0];
    expect(args).toEqual(
      expect.arrayContaining([
        "-p",
        expect.stringContaining("/abs/a.jpg"),
        "--output-format",
        "json",
        "--model",
        "opus",
        "--mcp-config",
        "/tmp/mcp.json",
        "--allowedTools",
        "Read"
      ])
    );
    const schemaFlagIndex = args.indexOf("--json-schema");
    expect(schemaFlagIndex).toBeGreaterThan(-1);
    // 内联 JSON 字符串,不是文件路径(claude CLI 会把该值直接当 JSON 解析)
    const schemaValue = args[schemaFlagIndex + 1];
    expect(JSON.parse(schemaValue)).toEqual({ type: "object", properties: { ok: { type: "boolean" } } });
    expect(options.timeoutMs).toBe(1000);
  });

  it("prefers structured_output over result when schema mode returns both", async () => {
    const execClaude = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({ result: "{\"escaped\":true}", structured_output: { pois: [], filtered: [] } })
    });
    await expect(
      new ClaudeCliRunner({ execClaude }).run({ prompt: "x", jsonSchema: { type: "object" }, timeoutMs: 1 })
    ).resolves.toBe(JSON.stringify({ pois: [], filtered: [] }));
  });

  it("throws LLMTimeoutError on timeout", async () => {
    const runner = new ClaudeCliRunner({
      execClaude: vi.fn().mockRejectedValue(Object.assign(new Error("timed out"), { timedOut: true }))
    });

    await expect(runner.run({ prompt: "x", timeoutMs: 1 })).rejects.toBeInstanceOf(LLMTimeoutError);
  });

  it("throws an error containing stderr on nonzero exit", async () => {
    const runner = new ClaudeCliRunner({
      execClaude: vi.fn().mockRejectedValue(Object.assign(new Error("exit 1"), { stderr: "bad schema" }))
    });

    await expect(runner.run({ prompt: "x", timeoutMs: 1 })).rejects.toThrow("bad schema");
  });

  it("returns text from common claude JSON wrapper shapes", async () => {
    await expect(
      new ClaudeCliRunner({ execClaude: vi.fn().mockResolvedValue({ stdout: JSON.stringify({ content: [{ text: "hello" }] }) }) }).run({
        prompt: "x",
        timeoutMs: 1
      })
    ).resolves.toBe("hello");
  });
});
