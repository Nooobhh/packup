import type { LLMRunner } from "./types";

export class DeepseekApiRunner implements LLMRunner {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: { apiKey?: string; fetchImpl?: typeof fetch } = {}) {
    const key = opts.apiKey ?? process.env.PACKUP_DEEPSEEK_API_KEY;
    if (!key) throw new Error("PACKUP_DEEPSEEK_API_KEY is required");
    this.apiKey = key;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async run(_opts: Parameters<LLMRunner["run"]>[0]): Promise<string> {
    throw new Error("not implemented");
  }
}
