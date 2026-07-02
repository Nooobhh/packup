import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Note } from "@/lib/pipeline/types";
import { NoteSchema } from "@/lib/pipeline/types";
import type { ContentFetcher } from "./types";

export class ManualFetcher implements ContentFetcher {
  async fetch(_links: string[], workDir: string): Promise<Note[]> {
    const manualDir = path.join(workDir, "manual");
    const entries = await safeReadDir(manualDir);
    if (entries.length === 0) return [];

    const markdownFiles = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));

    const notes: Note[] = [];
    for (const fileName of markdownFiles) {
      const noteId = fileName.replace(/\.md$/, "");
      const markdown = await readFile(path.join(manualDir, fileName), "utf8");
      const lines = markdown.replace(/\r\n/g, "\n").trimEnd().split("\n");
      const firstLine = lines[0] ?? "";
      const title = firstLine.startsWith("# ") ? firstLine.slice(2).trim() : noteId;
      const body = (firstLine.startsWith("# ") ? lines.slice(1) : lines).join("\n").trim();
      const imageEntries = await safeReadDir(path.join(manualDir, noteId));
      const images = imageEntries
        .filter((entry) => entry.isFile())
        .map((entry) => `manual/${noteId}/${entry.name}`)
        .sort((a, b) => a.localeCompare(b));

      notes.push(
        NoteSchema.parse({
          id: noteId,
          url: `manual://${noteId}`,
          title,
          body,
          images,
          fetchStatus: "ok"
        })
      );
    }

    return notes;
  }
}

async function safeReadDir(dir: string) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
