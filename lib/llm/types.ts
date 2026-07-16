export type Stage = "parseQuery" | "extract" | "plan";

export interface LLMRunner {
  run(opts: {
    prompt: string;
    images?: string[];
    jsonSchema?: object;
    mcpConfig?: string;
    allowedTools?: string[];
    model?: string;
    reasoningEffort?: "minimal" | "low" | "medium" | "high";
    timeoutMs: number;
  }): Promise<string>;
}
