import { access } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { LLMRunner } from "./types";
import { ClaudeCliRunner, LLMTimeoutError } from "./claude-cli";

describe("ClaudeCliRunner", () => {
  it("implements LLMRunner", () => {
    const runner: LLMRunner = new ClaudeCliRunner();
    expect(runner).toBeInstanceOf(ClaudeCliRunner);
  });

  it("assembles claude arguments with model override, schema temp file, tools, mcp, and image references", async () => {
    const execClaude = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({ result: "structured output" }),
      stderr: ""
    });
    const runner = new ClaudeCliRunner({ execClaude, scratchDir: path.join(__dirname, "__tmp__"), env: { PACKUP_CLAUDE_MODEL: "opus" } });

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
    const schemaPath = args[schemaFlagIndex + 1];
    expect(schemaPath).toContain("__tmp__");
    await expect(access(schemaPath)).rejects.toThrow();
    expect(options.timeoutMs).toBe(1000);
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
