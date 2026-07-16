import { afterEach, describe, expect, it, vi } from "vitest";
import type { LLMRunner } from "./types";
import { __resetProvidersForTest, runForStage } from "./router";

afterEach(() => __resetProvidersForTest());

function fakeRunner(): LLMRunner & { run: ReturnType<typeof vi.fn> } {
  return { run: vi.fn().mockResolvedValue("ok") };
}

describe("runForStage 分发", () => {
  it("parseQuery 分发到 pptoken 且注入 gpt-5.6", async () => {
    const pp = fakeRunner();
    const cli = fakeRunner();
    __resetProvidersForTest({ pptoken: pp, "claude-cli": cli });

    await runForStage("parseQuery", { prompt: "x", timeoutMs: 1000 });
    expect(pp.run).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-5.6-terra", reasoningEffort: "low", prompt: "x" }));
    expect(cli.run).not.toHaveBeenCalled();
  });

  it("plan 分发到 pptoken 且注入 gpt-5.6", async () => {
    const pp = fakeRunner();
    const cli = fakeRunner();
    __resetProvidersForTest({ pptoken: pp, "claude-cli": cli });

    await runForStage("plan", { prompt: "y", timeoutMs: 1000 });
    expect(pp.run).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-5.6-terra", reasoningEffort: "medium", prompt: "y" }));
    expect(cli.run).not.toHaveBeenCalled();
  });

  it("extract 分发到 pptoken 且注入 gpt-5.6（多模态直连）", async () => {
    const pp = fakeRunner();
    const cli = fakeRunner();
    __resetProvidersForTest({ pptoken: pp, "claude-cli": cli });

    await runForStage("extract", { prompt: "z", timeoutMs: 1000 });
    expect(pp.run).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-5.6-terra", reasoningEffort: "low", prompt: "z" }));
    expect(cli.run).not.toHaveBeenCalled();
  });
});

describe("runForStage 单例复用", () => {
  it("对同一 provider 的多次调用复用同一实例", async () => {
    const pp = fakeRunner();
    __resetProvidersForTest({ pptoken: pp, "claude-cli": fakeRunner() });

    await runForStage("parseQuery", { prompt: "a", timeoutMs: 1 });
    await runForStage("plan", { prompt: "b", timeoutMs: 1 });
    expect(pp.run).toHaveBeenCalledTimes(2);
  });
});

describe("__resetProvidersForTest", () => {
  it("不带参调用清空所有实例", () => {
    __resetProvidersForTest({ deepseek: fakeRunner() });
    expect(() => __resetProvidersForTest()).not.toThrow();
  });
});
