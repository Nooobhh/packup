import type { Note } from "@/lib/pipeline/types";

export interface ContentFetcher {
  fetch(links: string[], workDir: string): Promise<Note[]>;
}
