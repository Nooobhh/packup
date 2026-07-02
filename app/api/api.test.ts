import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./generate/route";
import { GET } from "./trips/[id]/route";
import type { StageEvent } from "@/lib/pipeline/types";

let dataRoot: string;
const oldEnv = process.env.PACKUP_DATA_DIR;

beforeEach(async () => {
  dataRoot = await mkdtemp(path.join(os.tmpdir(), "api-"));
  process.env.PACKUP_DATA_DIR = dataRoot;
});

afterEach(async () => {
  process.env.PACKUP_DATA_DIR = oldEnv;
  (globalThis as typeof globalThis & { __packupGeneratePipelineForTest?: unknown }).__packupGeneratePipelineForTest = undefined;
  await rm(dataRoot, { recursive: true, force: true });
});

describe("POST /api/generate", () => {
  it("returns 400 for invalid input", async () => {
    const res = await POST(new Request("http://test/api/generate", { method: "POST", body: JSON.stringify({ links: [] }) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty("error");
  });

  it("streams stage events and a final done event with tripId", async () => {
    (globalThis as typeof globalThis & { __packupGeneratePipelineForTest?: unknown }).__packupGeneratePipelineForTest = async (_input: unknown, _deps: unknown, opts: { onEvent?: (event: StageEvent) => void }) => {
      opts.onEvent?.({ stage: "fetch", status: "start", at: "2026-07-02T00:00:00.000Z" });
      return { tripId: "trip-api" };
    };
    const res = await POST(
      new Request("http://test/api/generate", {
        method: "POST",
        body: JSON.stringify({ links: ["https://xhslink.com/1"], destination: "上海" })
      })
    );
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(text).toContain('"stage":"fetch"');
    expect(text).toContain('"stage":"done"');
    expect(text).toContain('"tripId":"trip-api"');
  });
});

describe("GET /api/trips/[id]", () => {
  it("aggregates plan, failedLinks, and input", async () => {
    await writeTrip("trip-ok", {
      input: { id: "trip-ok", links: ["u1", "u2"], destination: "上海", transport: "public", pace: "moderate" },
      notes: [
        { id: "n1", url: "u1", title: "", body: "", images: [], fetchStatus: "failed", failReason: "fetch fail" },
        { id: "n2", url: "u2", title: "ok", body: "ok", images: [], fetchStatus: "ok" }
      ],
      pois: { pois: [], filtered: [], failedNotes: [{ noteId: "n2", reason: "extract fail" }] },
      plan: { days: [{ index: 1, items: [{ name: "外滩", startTime: "09:00", durationMin: 60 }] }], filtered: [], warnings: [] }
    });

    const res = await GET(new Request("http://test/api/trips/trip-ok"), { params: Promise.resolve({ id: "trip-ok" }) });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.input.destination).toBe("上海");
    expect(json.failedLinks).toEqual([
      { url: "u1", reason: "fetch fail" },
      { url: "u2", reason: "extract fail" }
    ]);
  });

  it("returns 404 for missing trip and 409 when an error checkpoint exists without a plan", async () => {
    expect((await GET(new Request("http://test/api/trips/missing"), { params: Promise.resolve({ id: "missing" }) })).status).toBe(404);
    const dir = path.join(dataRoot, "trip-error");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "plan.error.json"), JSON.stringify({ error: "bad plan" }), "utf8");
    const res = await GET(new Request("http://test/api/trips/trip-error"), { params: Promise.resolve({ id: "trip-error" }) });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "bad plan" });
  });
});

async function writeTrip(
  id: string,
  files: {
    input: unknown;
    notes: unknown;
    pois: unknown;
    plan: unknown;
  }
) {
  const dir = path.join(dataRoot, id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "00-input.json"), JSON.stringify(files.input), "utf8");
  await writeFile(path.join(dir, "10-notes.json"), JSON.stringify(files.notes), "utf8");
  await writeFile(path.join(dir, "20-pois.json"), JSON.stringify(files.pois), "utf8");
  await writeFile(path.join(dir, "40-plan.json"), JSON.stringify(files.plan), "utf8");
  await readFile(path.join(dir, "40-plan.json"), "utf8");
}
