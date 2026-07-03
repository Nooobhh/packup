import React from "react";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { CandidateList } from "@/components/candidate-list";
import { ExtractOutputSchema, GroundOutputSchema } from "@/lib/pipeline/types";

export default async function SelectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payload = await readCandidates(id);
  if (!payload) return <main className="p-6">候选点尚未就绪</main>;
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-6 py-8">
      <h1 className="text-xl font-semibold">选择要排进日程的地点</h1>
      <CandidateList tripId={id} grounded={payload.grounded} filtered={payload.filtered} />
    </main>
  );
}

async function readCandidates(id: string) {
  const dir = path.join(process.env.PACKUP_DATA_DIR ?? path.join(process.cwd(), "data/trips"), id);
  try {
    const [groundRaw, poisRaw] = await Promise.all([
      readFile(path.join(dir, "30-grounded.json"), "utf8"),
      readFile(path.join(dir, "20-pois.json"), "utf8").catch(() => "{}")
    ]);
    const ground = GroundOutputSchema.parse(JSON.parse(groundRaw));
    const extract = ExtractOutputSchema.partial().parse(JSON.parse(poisRaw));
    return { grounded: ground.grounded, filtered: [...(extract.filtered ?? []), ...ground.filtered] };
  } catch {
    return null;
  }
}
