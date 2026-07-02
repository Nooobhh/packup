import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NoteSchema, type Note } from "@/lib/pipeline/types";
import type { ContentFetcher } from "./types";

type HttpPage = {
  ok: boolean;
  status: number;
  url: string;
  text(): Promise<string>;
};
type FetchPage = (url: string, headers: Record<string, string>) => Promise<HttpPage>;
type FetchBinary = (url: string) => Promise<ArrayBuffer>;

export type XhsHttpFetcherOptions = {
  fetchPage?: FetchPage;
  fetchBinary?: FetchBinary;
  sleep?: (ms: number) => Promise<void>;
  delayMs?: number;
};

const desktopChromeUa =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export class XhsHttpFetcher implements ContentFetcher {
  private readonly fetchPage: FetchPage;
  private readonly fetchBinary: FetchBinary;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly delayMs: number;

  constructor(private readonly opts: XhsHttpFetcherOptions = {}) {
    this.fetchPage = opts.fetchPage ?? defaultFetchPage;
    this.fetchBinary = opts.fetchBinary ?? defaultFetchBinary;
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.delayMs = opts.delayMs ?? 1000;
  }

  async fetch(links: string[], workDir: string): Promise<Note[]> {
    const notes: Note[] = [];
    for (let index = 0; index < links.length; index++) {
      if (index > 0) await this.sleep(this.delayMs);
      const url = links[index];
      try {
        const page = await this.fetchPage(url, { "user-agent": desktopChromeUa });
        if (!page.ok) throw new Error(`HTTP ${page.status}`);
        const html = await page.text();
        const parsed = parseXhsHtml(html, page.url || url);
        const images: string[] = [];
        await mkdir(path.join(workDir, "images", parsed.id), { recursive: true });
        for (let imageIndex = 0; imageIndex < parsed.imageUrls.length; imageIndex++) {
          const imageUrl = parsed.imageUrls[imageIndex];
          const fileName = `${imageIndex + 1}${imageExtension(imageUrl)}`;
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

async function defaultFetchPage(url: string, headers: Record<string, string>): Promise<HttpPage> {
  const response = await fetch(url, { headers, redirect: "follow" });
  return {
    ok: response.ok,
    status: response.status,
    url: response.url,
    text: () => response.text()
  };
}

async function defaultFetchBinary(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`image download failed ${response.status}`);
  return response.arrayBuffer();
}

function parseXhsHtml(html: string, landedUrl: string) {
  const stateText = extractInitialState(html);
  if (!stateText) {
    throw new Error(isLoginWall(html, landedUrl) ? "登录墙/风控: INITIAL_STATE 缺失" : "解析失败: INITIAL_STATE 缺失");
  }
  const state = parseState(stateText);
  const noteMap = getObject(getObject(getObject(state, "note"), "noteDetailMap"));
  const noteId = noteIdFromUrl(landedUrl);
  const detail = getObject(noteMap, noteId) ?? firstObjectValue(noteMap);
  const note = getObject(detail, "note") ?? detail;
  if (!note) throw new Error("解析失败: noteDetailMap 为空");
  const title = stringField(note, "title") || "Untitled XHS note";
  const body = stringField(note, "desc") || "";
  const imageUrls = arrayField(note, "imageList")
    .map((item) => getObject(item))
    .map((item) => item && stringField(item, "urlDefault"))
    .filter((item): item is string => Boolean(item));
  return { id: noteId || stringField(note, "id") || "xhs-note", title, body, imageUrls };
}

function extractInitialState(html: string) {
  const marker = "window.__INITIAL_STATE__";
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return undefined;
  const start = html.indexOf("{", markerIndex);
  const scriptEnd = html.indexOf("</script>", start);
  if (start < 0 || scriptEnd < 0) return undefined;
  return html.slice(start, scriptEnd).replace(/;\s*$/, "").trim();
}

function parseState(text: string) {
  const normalized = text
    .replace(/\bundefined\b/g, "null")
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3');
  try {
    return JSON.parse(normalized) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`解析失败: INITIAL_STATE JSON 无法解析 (${error instanceof Error ? error.message : String(error)})`);
  }
}

function isLoginWall(html: string, landedUrl: string) {
  return /login|登录|验证码|verify|风控|安全验证/i.test(`${landedUrl}\n${html}`);
}

function getObject(value: unknown, key?: string): Record<string, unknown> | undefined {
  const target = key && value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : value;
  return target && typeof target === "object" && !Array.isArray(target) ? (target as Record<string, unknown>) : undefined;
}

function firstObjectValue(value: unknown) {
  const object = getObject(value);
  if (!object) return undefined;
  return Object.values(object).find((item): item is Record<string, unknown> => Boolean(getObject(item)));
}

function stringField(obj: Record<string, unknown>, key: string) {
  const value = obj[key];
  return typeof value === "string" ? value : undefined;
}

function arrayField(obj: Record<string, unknown>, key: string) {
  const value = obj[key];
  return Array.isArray(value) ? value : [];
}

function noteIdFromUrl(url: string) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const itemIndex = parts.indexOf("item");
    if (itemIndex >= 0 && parts[itemIndex + 1]) return sanitizeId(parts[itemIndex + 1]);
    const last = parts.at(-1);
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
