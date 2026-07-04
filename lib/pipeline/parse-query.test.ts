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
