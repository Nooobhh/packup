export interface LLMRunner {
  run(opts: {
    prompt: string;
    images?: string[];
    jsonSchema?: object;
    mcpConfig?: string;
    allowedTools?: string[];
    timeoutMs: number;
  }): Promise<string>;
}
