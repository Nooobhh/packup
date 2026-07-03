export const BUDGETS = {
  fetchTotalMs: 25_000,
  extractStageMs: 120_000,
  extractPerNoteMs: 120_000,
  groundStageMs: 40_000,
  planLlmMs: 90_000,
  planRoutesMs: 25_000,
  parseQueryMs: 20_000,
  routeCallMs: 5_000
} as const;
