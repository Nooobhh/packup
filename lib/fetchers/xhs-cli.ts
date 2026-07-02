import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NoteSchema, type Note } from "@/lib/pipeline/types";
import type { ContentFetcher } from "./types";

type ExecResult = { stdout: string; stderr?: string };
type ExecXhs = (url: string) => Promise<ExecResult>;
type FetchBinary = (url: string) => Promise<ArrayBuffer>;

export type XhsCliFetcherOptions = {
  execXhs?: ExecXhs;
  fetchBinary?: FetchBinary;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
};

export class XhsCliFetcher implements ContentFetcher {
  private readonly execXhs: ExecXhs;
  private readonly fetchBinary: FetchBinary;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: XhsCliFetcherOptions = {}) {
    this.execXhs = opts.execXhs ?? ((url) => runXhsRead(url, opts.timeoutMs ?? 30_000));
    this.fetchBinary = opts.fetchBinary ?? defaultFetchBinary;
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async fetch(links: string[], workDir: string): Promise<Note[]> {
    const notes: Note[] = [];

    for (let i = 0; i < links.length; i++) {
      if (i > 0) await this.sleep(2500);
      const url = links[i];
      try {
        const result = await this.execXhs(url);
        const parsed = parseXhsOutput(result.stdout, url);
        const imageDir = path.join(workDir, "images", parsed.id);
        await mkdir(imageDir, { recursive: true });
        const images: string[] = [];

        for (let imageIndex = 0; imageIndex < parsed.imageUrls.length; imageIndex++) {
          const imageUrl = parsed.imageUrls[imageIndex];
          const ext = imageExtension(imageUrl);
          const fileName = `${imageIndex + 1}${ext}`;
          const relative = `images/${parsed.id}/${fileName}`;
          const binary = await this.fetchBinary(imageUrl);
          await writeFile(path.join(workDir, relative), Buffer.from(new Uint8Array(binary)));
          images.push(relative);
        }

        notes.push(
          NoteSchema.parse({
            id: parsed.id,
            url,
            title: parsed.title,
            body: parsed.body,
            images,
            author: parsed.author,
            fetchStatus: "ok"
          })
        );
      } catch (error) {
        notes.push(failedNote(url, error));
      }
    }

    return notes;
  }
}

function runXhsRead(url: string, timeoutMs: number): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile("xhs", ["read", url], { timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const message = stderr?.trim() || error.message;
        reject(new Error(message));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function defaultFetchBinary(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`image download failed ${response.status}`);
  }
  return response.arrayBuffer();
}

function parseXhsOutput(stdout: string, url: string) {
  const text = stdout.trim();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    value = null;
  }

  if (value && typeof value === "object") {
    const obj = unwrapJson(value as Record<string, unknown>);
    const title = stringField(obj, ["title", "name"]);
    const body = stringField(obj, ["body", "content", "desc", "description", "text"]);
    const images = arrayField(obj, ["images", "imageUrls", "image_urls", "pics", "pictures"]);
    if (title || body || images.length > 0) {
      return {
        id: stringField(obj, ["id", "noteId", "note_id"]) || noteIdFromUrl(url),
        title: title || "Untitled XHS note",
        body: body || "",
        author: stringField(obj, ["author", "nickname"]),
        imageUrls: images
      };
    }
  }

  const title = matchLine(text, /^(?:title|标题)[:：]\s*(.+)$/im);
  const body = matchBlock(text, /(?:body|content|正文)[:：]\s*([\s\S]*?)(?:\n(?:images|图片)[:：]|$)/i);
  const imageLine = matchLine(text, /^(?:images|图片)[:：]\s*(.+)$/im);
  const imageUrls = imageLine?.match(/https?:\/\/[^\s,，]+/g) ?? [];
  if (title || body || imageUrls.length > 0) {
    return {
      id: noteIdFromUrl(url),
      title: title || "Untitled XHS note",
      body: (body ?? "").trim(),
      author: undefined,
      imageUrls
    };
  }

  throw new Error("parse failed: unsupported xhs output");
}

function unwrapJson(obj: Record<string, unknown>): Record<string, unknown> {
  for (const key of ["data", "note", "result"]) {
    const nested = obj[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      return nested as Record<string, unknown>;
    }
  }
  return obj;
}

function stringField(obj: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function arrayField(obj: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = obj[key];
    if (Array.isArray(value)) {
      return value
        .map((item) => {
          if (typeof item === "string") return item;
          if (item && typeof item === "object") return stringField(item as Record<string, unknown>, ["url", "src"]);
          return undefined;
        })
        .filter((item): item is string => Boolean(item));
    }
  }
  return [];
}

function matchLine(text: string, re: RegExp) {
  return text.match(re)?.[1]?.trim();
}

function matchBlock(text: string, re: RegExp) {
  return text.match(re)?.[1]?.trim();
}

function noteIdFromUrl(url: string) {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split("/").filter(Boolean).at(-1);
    if (last) return sanitizeId(last);
  } catch {
    // Fall through to deterministic sanitized fallback.
  }
  return sanitizeId(Buffer.from(url).toString("base64url").slice(0, 12));
}

function sanitizeId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_") || "xhs-note";
}

function imageExtension(url: string) {
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    if ([".jpg", ".jpeg", ".png", ".webp"].includes(ext)) return ext;
  } catch {
    // Ignore malformed extension source.
  }
  return ".jpg";
}

function failedNote(url: string, error: unknown): Note {
  return NoteSchema.parse({
    id: noteIdFromUrl(url),
    url,
    title: "",
    body: "",
    images: [],
    fetchStatus: "failed",
    failReason: error instanceof Error ? error.message : String(error)
  });
}
