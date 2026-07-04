import { z } from "zod";
import { runForStage } from "@/lib/llm/router";
import { BUDGETS } from "./budgets";

const ParsedQuerySchema = z.object({
  destination: z.string().optional(),
  days: z.number().int().min(1).max(15).optional(),
  preferences: z.array(z.string()).default([])
});

export async function parseQuery(query: string): Promise<{ destination: string; days?: number; preferences: string[] }> {
  const ruled = parseByRules(query);
  if (ruled.destination && ruled.destination.length <= 10) return ruled;

  const raw = await runForStage("parseQuery", {
    prompt: `从旅行需求中提取目的地、天数和偏好,只返回 JSON。需求: ${query}`,
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        destination: { type: "string" },
        days: { type: "number" },
        preferences: { type: "array", items: { type: "string" } }
      },
      required: ["destination", "preferences"]
    },
    timeoutMs: BUDGETS.parseQueryMs
  });

  try {
    const parsed = ParsedQuerySchema.parse(JSON.parse(raw));
    const destination = parsed.destination?.trim();
    if (!destination) throw new Error("empty destination");
    return { destination, days: parsed.days, preferences: parsed.preferences.filter(Boolean) };
  } catch {
    throw new Error("无法识别目的地,请在输入中明确城市或国家");
  }
}

function parseByRules(query: string): { destination: string; days?: number; preferences: string[] } {
  const normalized = query.trim();
  if (/帮我|规划|假期|行程/.test(normalized)) return { destination: "", preferences: [] };

  const dayMatch = normalized.match(/(\d{1,2})\s*天(?:\s*\d{1,2}\s*晚)?/);
  const parsedDays = dayMatch ? Number(dayMatch[1]) : undefined;
  const days = parsedDays && parsedDays >= 1 && parsedDays <= 15 ? parsedDays : undefined;

  let cleaned = normalized
    .replace(/(\d{1,2})\s*天(?:\s*\d{1,2}\s*晚)?/g, " ")
    .replace(/旅游|旅行|攻略|游玩|出行|自由行|之旅/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  cleaned = trimDelimiters(cleaned);
  const destinationMatch = cleaned.match(/^([\p{Script=Han}]{1,10}|[A-Za-z][A-Za-z-]{0,20})(.*)$/u);
  const destination = trimDelimiters(destinationMatch?.[1] ?? "");
  const rest = trimDelimiters(destinationMatch?.[2] ?? "");

  return {
    destination,
    days,
    preferences: splitPreferences(rest)
  };
}

function splitPreferences(value: string): string[] {
  return value
    .split(/[+、,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function trimDelimiters(value: string): string {
  return value.replace(/^[\s+、,，。:：-]+|[\s+、,，。:：-]+$/g, "");
}
