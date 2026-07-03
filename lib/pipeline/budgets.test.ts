import { describe, expect, it } from "vitest";
import { BUDGETS } from "./budgets";

describe("BUDGETS", () => {
  it("keeps normal pipeline budgets within the 300s target", () => {
    expect(BUDGETS.fetchTotalMs + BUDGETS.extractStageMs + BUDGETS.groundStageMs + BUDGETS.planLlmMs + BUDGETS.planRoutesMs).toBeLessThanOrEqual(300_000);
    expect(BUDGETS.planLlmMs).toBeLessThanOrEqual(90_000);
    expect(BUDGETS.extractPerNoteMs).toBeLessThanOrEqual(BUDGETS.extractStageMs);
  });

  it("exports the expected budget keys and defaults", () => {
    expect(BUDGETS).toEqual({
      fetchTotalMs: 25_000,
      extractStageMs: 120_000,
      extractPerNoteMs: 120_000,
      groundStageMs: 40_000,
      planLlmMs: 90_000,
      planRoutesMs: 25_000,
      parseQueryMs: 20_000,
      routeCallMs: 5_000
    });
  });
});
