import { ClaudeCliRunner } from "./claude-cli";
import { DeepseekApiRunner } from "./deepseek-api";
import { PptokenApiRunner } from "./pptoken-api";
import type { LLMRunner, Stage } from "./types";

const PROVIDERS: Record<string, () => LLMRunner> = {
  deepseek: () => new DeepseekApiRunner(),
  "claude-cli": () => new ClaudeCliRunner(),
  pptoken: () => new PptokenApiRunner()
};

// pptoken 为 OpenAI 兼容中转站;裸名 gpt-5.6 上游不稳,用 terra 变体;effort 按任务轻重分档(实测 low≈4s/default≈22s)
type StageConfig = { provider: keyof typeof PROVIDERS; model: string; reasoningEffort?: "minimal" | "low" | "medium" | "high" };
const STAGE_MODELS: Record<Stage, StageConfig> = {
  parseQuery: { provider: "pptoken", model: "gpt-5.6-terra", reasoningEffort: "low" },
  extract: { provider: "pptoken", model: "gpt-5.6-terra", reasoningEffort: "low" },
  plan: { provider: "pptoken", model: "gpt-5.6-terra", reasoningEffort: "medium" }
};

const instances = new Map<string, LLMRunner>();

function get(providerName: string): LLMRunner {
  if (!instances.has(providerName)) {
    const factory = PROVIDERS[providerName];
    if (!factory) throw new Error(`Unknown LLM provider: ${providerName}`);
    instances.set(providerName, factory());
  }
  return instances.get(providerName)!;
}

export async function runForStage(
  stage: Stage,
  opts: Omit<Parameters<LLMRunner["run"]>[0], "model">
): Promise<string> {
  const cfg = STAGE_MODELS[stage];
  return get(cfg.provider).run({ ...opts, model: cfg.model, reasoningEffort: cfg.reasoningEffort });
}

export function __resetProvidersForTest(overrides?: Record<string, LLMRunner>): void {
  instances.clear();
  if (overrides) for (const [k, v] of Object.entries(overrides)) instances.set(k, v);
}
