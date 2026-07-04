import { describe, expect, it } from "vitest";
import { DeepseekApiRunner } from "./deepseek-api";

describe("DeepseekApiRunner 构造", () => {
  it("缺 PACKUP_DEEPSEEK_API_KEY 时 throw", () => {
    const oldKey = process.env.PACKUP_DEEPSEEK_API_KEY;
    delete process.env.PACKUP_DEEPSEEK_API_KEY;
    try {
      expect(() => new DeepseekApiRunner()).toThrow(/PACKUP_DEEPSEEK_API_KEY/);
    } finally {
      if (oldKey !== undefined) process.env.PACKUP_DEEPSEEK_API_KEY = oldKey;
    }
  });

  it("显式传 apiKey 时不读 env", () => {
    const oldKey = process.env.PACKUP_DEEPSEEK_API_KEY;
    delete process.env.PACKUP_DEEPSEEK_API_KEY;
    try {
      expect(() => new DeepseekApiRunner({ apiKey: "sk-test" })).not.toThrow();
    } finally {
      if (oldKey !== undefined) process.env.PACKUP_DEEPSEEK_API_KEY = oldKey;
    }
  });
});
