import { describe, expect, it, vi } from "vitest";
import type { LLMRunner } from "@/lib/llm/types";
import { BUDGETS } from "./budgets";
import { parseQuery } from "./parse-query";

function mockLlm(result = "{}"): LLMRunner & { run: ReturnType<typeof vi.fn> } {
  return { run: vi.fn().mockResolvedValue(result) };
}

describe("parseQuery", () => {
  it.each([
    ["香港旅游攻略", { destination: "香港", days: undefined, preferences: [] }],
    ["杭州3天旅游攻略", { destination: "杭州", days: 3, preferences: [] }],
    ["泰国3天2晚旅游攻略", { destination: "泰国", days: 3, preferences: [] }],
    ["吉隆坡5天city walk+美食", { destination: "吉隆坡", days: 5, preferences: ["city walk", "美食"] }]
  ])("parses %s by rule without calling llm", async (query, expected) => {
    const llm = mockLlm();

    await expect(parseQuery(query, llm)).resolves.toEqual(expected);
    expect(llm.run).not.toHaveBeenCalled();
  });

  it("uses the llm fallback exactly once when rules cannot identify a destination", async () => {
    const llm = mockLlm(JSON.stringify({ destination: "京都", days: 4, preferences: ["寺院", "咖啡"] }));

    await expect(parseQuery("帮我规划一个超级好玩的假期行程", llm)).resolves.toEqual({
      destination: "京都",
      days: 4,
      preferences: ["寺院", "咖啡"]
    });
    expect(llm.run).toHaveBeenCalledTimes(1);
    expect(llm.run).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: BUDGETS.parseQueryMs }));
  });

  it("throws a helpful error when fallback cannot identify a destination", async () => {
    const llm = mockLlm(JSON.stringify({ destination: "", preferences: [] }));

    await expect(parseQuery("帮我规划一个超级好玩的假期行程", llm)).rejects.toThrow("无法识别目的地");
  });
});
