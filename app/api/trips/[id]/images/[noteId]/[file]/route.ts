import { readFile } from "node:fs/promises";
import path from "node:path";

const FILE_RE = /^\d+\.(jpg|jpeg|png|webp)$/i;
const MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

/** serve data/trips/<id>/images/<noteId>/<n>.<ext> 的本地缓存笔记图片 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; noteId: string; file: string }> }) {
  const { id, noteId, file } = await params;
  if ([id, noteId].some((part) => !/^[\w-]+$/.test(part)) || !FILE_RE.test(file)) {
    return new Response("bad request", { status: 400 });
  }
  const dir = process.env.PACKUP_DATA_DIR ?? path.join(process.cwd(), "data/trips");
  try {
    const buf = await readFile(path.join(dir, id, "images", noteId, file));
    const ext = file.split(".").at(-1)!.toLowerCase();
    return new Response(new Uint8Array(buf), {
      headers: { "Content-Type": MIME[ext] ?? "application/octet-stream", "Cache-Control": "public, max-age=86400" }
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
