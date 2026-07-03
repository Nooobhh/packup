import { z } from "zod";

export const TransportModeSchema = z.enum(["public", "drive", "walk"]);
export type TransportMode = z.infer<typeof TransportModeSchema>;

export const PaceSchema = z.enum(["packed", "moderate", "relaxed"]);
export type Pace = z.infer<typeof PaceSchema>;

export const SlotSchema = z.enum(["morning", "afternoon", "evening"]);
export type Slot = z.infer<typeof SlotSchema>;

export const LngLatSchema = z.object({
  lng: z.number(),
  lat: z.number()
});
export type LngLat = z.infer<typeof LngLatSchema>;

export const TripInputSchema = z
  .object({
    id: z.string().optional(),
    links: z.array(z.string().min(1)).min(1).max(10),
    destination: z.string().min(1),
    days: z
      .object({
        base: z.number().int().positive(),
        flex: z.number().int().nonnegative().optional().default(0)
      })
      .optional(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    dailyThemes: z.array(z.string().nullable()).optional(),
    query: z.string().optional(),
    preferences: z.array(z.string()).optional(),
    transport: TransportModeSchema.default("public"),
    pace: PaceSchema.default("moderate")
  })
  .superRefine((input, ctx) => {
    if (input.days && input.days.base + (input.days.flex ?? 0) > 15) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["days"],
        message: "days.base + days.flex must be <= 15"
      });
    }
    if (!input.days && input.dailyThemes && input.dailyThemes.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dailyThemes"],
        message: "dailyThemes cannot be provided when days is omitted"
      });
    }
    if (input.days && input.dailyThemes && input.dailyThemes.length > input.days.base) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dailyThemes"],
        message: "dailyThemes length must be <= days.base"
      });
    }
  });
export type TripInput = z.infer<typeof TripInputSchema>;

export const NoteSchema = z.object({
  id: z.string(),
  url: z.string(),
  title: z.string(),
  body: z.string(),
  images: z.array(z.string()).default([]),
  author: z.string().optional(),
  fetchStatus: z.enum(["ok", "failed"]),
  failReason: z.string().optional()
});
export type Note = z.infer<typeof NoteSchema>;

export const PoiTypeSchema = z.enum(["sight", "food", "shop", "stay", "experience", "other"]);
export type PoiType = z.infer<typeof PoiTypeSchema>;

export const CandidatePoiSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  type: PoiTypeSchema,
  city: z.string().optional(),
  reason: z.string().min(1),
  suggestedDuration: z.string().optional(),
  timeHint: z.string().optional(),
  sourceNoteId: z.string(),
  sourceType: z.enum(["text", "image"])
});
export type CandidatePoi = z.infer<typeof CandidatePoiSchema>;

export const GroundedPoiSchema = CandidatePoiSchema.extend({
  id: z.string().optional(),
  verified: z.boolean(),
  amapId: z.string().optional(),
  location: LngLatSchema.optional(),
  address: z.string().optional(),
  openHours: z.string().optional(),
  rating: z.string().optional()
});
export type GroundedPoi = z.infer<typeof GroundedPoiSchema>;

export const FilteredStageSchema = z.enum(["extract", "ground", "plan"]);
export type FilteredStage = z.infer<typeof FilteredStageSchema>;

export const FilteredItemSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().min(1),
    sourceNoteId: z.string().optional(),
    stage: FilteredStageSchema,
    reason: z.string().optional(),
    why: z.string().optional()
  })
  .transform((item) => ({
    ...item,
    reason: item.reason ?? item.why ?? ""
  }))
  .pipe(
    z.object({
      id: z.string().optional(),
      name: z.string(),
      sourceNoteId: z.string().optional(),
      stage: FilteredStageSchema,
      reason: z.string().min(1),
      why: z.string().optional()
    })
  );
export type FilteredItem = z.infer<typeof FilteredItemSchema>;

export const TransportToNextSchema = z.object({
  mode: TransportModeSchema.or(z.string()),
  durationMin: z.number().nonnegative(),
  distanceKm: z.number().nonnegative(),
  polyline: z.array(LngLatSchema).optional()
});
export type TransportToNext = z.infer<typeof TransportToNextSchema>;

export const PlanItemSchema = z.object({
  id: z.string().optional(),
  poiId: z.string().optional(),
  poi: GroundedPoiSchema.optional(),
  name: z.string().optional(),
  type: PoiTypeSchema.or(z.string()).optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  slot: SlotSchema.optional(),
  clusterKey: z.string().optional(),
  durationMin: z.number().int().positive(),
  address: z.string().optional(),
  openHours: z.string().optional(),
  verified: z.boolean().optional(),
  location: LngLatSchema.optional(),
  reason: z.string().optional(),
  note: z.string().optional(),
  transportToNext: TransportToNextSchema.optional()
});
export type PlanItem = z.infer<typeof PlanItemSchema>;

export const PlanDaySchema = z.object({
  index: z.number().int().positive().optional(),
  day: z.number().int().positive().optional(),
  date: z.string().optional(),
  theme: z.string().optional(),
  items: z.array(PlanItemSchema)
});
export type PlanDay = z.infer<typeof PlanDaySchema>;

export const DaysDecisionSchema = z.union([
  z.string(),
  z.object({
    requested: z.string().optional(),
    actualDays: z.number().int().positive().optional(),
    reason: z.string().min(1)
  })
]);
export type DaysDecision = z.infer<typeof DaysDecisionSchema>;

export const TripPlanSchema = z.object({
  tripId: z.string().optional(),
  destination: z.string().optional(),
  days: z.array(PlanDaySchema).min(1),
  filtered: z.array(FilteredItemSchema).default([]),
  daysDecision: DaysDecisionSchema.optional(),
  warnings: z.array(z.string()).default([])
});
export type TripPlan = z.infer<typeof TripPlanSchema>;

export const ExtractOutputSchema = z.object({
  pois: z.array(CandidatePoiSchema),
  filtered: z.array(FilteredItemSchema),
  failedNotes: z.array(z.object({ noteId: z.string(), reason: z.string() })).default([])
});
export type ExtractOutput = z.infer<typeof ExtractOutputSchema>;

export const GroundOutputSchema = z.object({
  grounded: z.array(GroundedPoiSchema),
  filtered: z.array(FilteredItemSchema)
});
export type GroundOutput = z.infer<typeof GroundOutputSchema>;

export const StageNameSchema = z.enum(["fetch", "extract", "ground", "plan"]);
export type StageName = z.infer<typeof StageNameSchema>;

export const SelectionSchema = z.object({
  selectedPoiIds: z.array(z.string()).min(1),
  selectedAt: z.string()
});
export type Selection = z.infer<typeof SelectionSchema>;

export const StageEventSchema = z.object({
  stage: StageNameSchema,
  status: z.enum(["start", "done", "error", "await-selection"]),
  detail: z.string().optional(),
  at: z.string()
});
export type StageEvent = z.infer<typeof StageEventSchema>;
