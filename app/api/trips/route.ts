import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import { z } from "zod";
import { TransportPrefsSchema, TripInputSchema, TripPlanSchema } from "@/lib/pipeline/types";

const CreateTripSchema = z.object({
  destination: z.string().trim().min(1),
  days: z.object({ base: z.number().int().min(1).max(15) }),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  preferences: z.array(z.string().min(1)).max(12).optional()
});

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = CreateTripSchema.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "Invalid trip", issues: parsed.error.issues }, { status: 400 });

  const tripId = nanoid(10);
  const input = TripInputSchema.parse({
    id: tripId,
    links: [],
    destination: parsed.data.destination,
    days: { base: parsed.data.days.base },
    startDate: parsed.data.startDate,
    preferences: parsed.data.preferences,
    transport: "public",
    pace: "moderate"
  });
  const plan = TripPlanSchema.parse({
    tripId,
    destination: input.destination,
    days: Array.from({ length: input.days?.base ?? 1 }, (_, index) => ({ index: index + 1, items: [] })),
    pool: [],
    filtered: [],
    warnings: [],
    transportPrefs: TransportPrefsSchema.parse({})
  });

  const dir = path.join(process.env.PACKUP_DATA_DIR ?? path.join(process.cwd(), "data/trips"), tripId);
  await mkdir(dir, { recursive: true });
  await writeJson(path.join(dir, "00-input.json"), input);
  await writeJson(path.join(dir, "40-plan.json"), plan);

  return Response.json({ tripId }, { status: 201 });
}

async function writeJson(file: string, value: unknown) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
