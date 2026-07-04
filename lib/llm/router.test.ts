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
});
