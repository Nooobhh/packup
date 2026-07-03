import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { AmapRestProvider } from "@/lib/map/amap-rest";
import type { MapProvider } from "@/lib/map/types";
import { recommendLegTransport } from "@/lib/pipeline/plan";
import { TransportModeSchema, TripPlanSchema, type LngLat, type PlanItem, type TripPlan, type TransportMode } from "@/lib/pipeline/types";

const PatchSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("reorder"), day: z.number().int().positive(), orderedIds: z.array(z.string()).min(1) }),
  z.object({ op: z.literal("set-transport"), day: z.number().int().positive(), segmentIndex: z.number().int().nonnegative(), mode: TransportModeSchema })
]);

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const file = path.join(tripDir(id), "40-plan.json");
  if (!(await exists(file))) return Response.json({ error: "Trip plan not ready" }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const patch = PatchSchema.safeParse(body);
  if (!patch.success) return Response.json({ error: "Invalid patch", issues: patch.error.issues }, { status: 400 });

  const plan = TripPlanSchema.parse(await readJson(file));
  const day = plan.days[patch.data.day - 1];
  if (!day) return Response.json({ error: "day 越界" }, { status: 400 });
  const map = getMap();

  try {
    if (patch.data.op === "reorder") {
      await applyReorder(day.items, patch.data.orderedIds, map);
    } else {
      if (patch.data.segmentIndex < 0 || patch.data.segmentIndex >= day.items.length - 1) return Response.json({ error: "segmentIndex 越界" }, { status: 400 });
      await setTransport(day.items, patch.data.segmentIndex, patch.data.mode, map);
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }

  const parsed = TripPlanSchema.parse(plan);
  await writeFile(file, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  return Response.json(parsed);
}

async function applyReorder(items: PlanItem[], orderedIds: string[], map: Pick<MapProvider, "route">) {
  const groups = groupItems(items);
  const byId = new Map(groups.map((group) => [group.id, group.items]));
  if (!sameMembers(orderedIds, Array.from(byId.keys()))) throw new Error("orderedIds 与当天 items 集合不一致");

  const oldPair = new Map<string, PlanItem["transportToNext"]>();
  for (let i = 0; i < items.length - 1; i++) oldPair.set(`${itemId(items[i])}->${itemId(items[i + 1])}`, items[i].transportToNext);
  const reordered = orderedIds.flatMap((id) => byId.get(id)!);
  items.splice(0, items.length, ...reordered);

  for (let i = 0; i < items.length; i++) items[i].transportToNext = undefined;
  for (let i = 0; i < items.length - 1; i++) {
    const reused = oldPair.get(`${itemId(items[i])}->${itemId(items[i + 1])}`);
    if (reused) items[i].transportToNext = reused;
    else await recommendTransport(items, i, map);
  }
}

async function setTransport(items: PlanItem[], index: number, mode: TransportMode, map: Pick<MapProvider, "route">) {
  const from = itemLocation(items[index]);
  const to = itemLocation(items[index + 1]);
  if (!from || !to) throw new Error("segment location missing");
  const route = await map.route(from, to, mode);
  items[index].transportToNext = { ...route, mode };
}

async function recommendTransport(items: PlanItem[], index: number, map: Pick<MapProvider, "route">) {
  const route = await recommendLegTransport(items[index], items[index + 1], { transport: "public" }, map);
  if (route) items[index].transportToNext = route;
}

function groupItems(items: PlanItem[]) {
  const groups: Array<{ id: string; items: PlanItem[] }> = [];
  for (const item of items) {
    const id = item.clusterKey ?? itemId(item);
    const last = groups.at(-1);
    if (last?.id === id) last.items.push(item);
    else groups.push({ id, items: [item] });
  }
  const seen = new Set<string>();
  for (const group of groups) {
    if (seen.has(group.id)) throw new Error("同一 clusterKey 存在非相邻分段,请先重新生成行程");
    seen.add(group.id);
  }
  return groups;
}

function sameMembers(a: string[], b: string[]) {
  return a.length === b.length && a.every((id) => b.includes(id)) && b.every((id) => a.includes(id));
}

function itemId(item: PlanItem) {
  return item.clusterKey ?? item.poiId ?? item.id ?? item.name ?? "";
}

function itemLocation(item: PlanItem): LngLat | undefined {
  return item.location ?? item.poi?.location;
}

function getMap(): Pick<MapProvider, "route"> {
  return ((globalThis as typeof globalThis & { __packupPatchMapForTest?: Pick<MapProvider, "route"> }).__packupPatchMapForTest ?? new AmapRestProvider()) as Pick<MapProvider, "route">;
}

function tripDir(id: string) {
  return path.join(process.env.PACKUP_DATA_DIR ?? path.join(process.cwd(), "data/trips"), id);
}

async function exists(file: string) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function readJson(file: string) {
  return JSON.parse(await readFile(file, "utf8")) as unknown;
}
