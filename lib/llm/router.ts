import { ClaudeCliRunner } from "./claude-cli";
import { DeepseekApiRunner } from "./deepseek-api";
import type { LLMRunner, Stage } from "./types";

const PROVIDERS: Record<string, () => LLMRunner> = {
  deepseek: () => new DeepseekApiRunner(),
  "claude-cli": () => new ClaudeCliRunner()
};

const STAGE_MODELS: Record<Stage, { provider: keyof typeof PROVIDERS; model: string }> = {
  parseQuery: { provider: "deepseek", model: "deepseek-v4-flash" },
  extract: { provider: "claude-cli", model: "sonnet" },
  plan: { provider: "deepseek", model: "deepseek-v4-flash" }
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
  return get(cfg.provider).run({ ...opts, model: cfg.model });
}

export function __resetProvidersForTest(overrides?: Record<string, LLMRunner>): void {
  instances.clear();
  if (overrides) for (const [k, v] of Object.entries(overrides)) instances.set(k, v);
}
