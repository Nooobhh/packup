import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { normalizeLinks } from "../lib/fetchers/normalize";

async function main() {
  const linksPath = path.join(process.cwd(), "data/spike/links.txt");
  const notesPath = path.join(process.cwd(), "docs/ohaze/SPIKE-NOTES.md");
  await mkdir(path.dirname(notesPath), { recursive: true });

  let linksText: string;
  try {
    linksText = await readFile(linksPath, "utf8");
  } catch {
    await writeFile(
      notesPath,
      `# SPIKE-NOTES\n\n## Spike A — xhs-cli\n\nBLOCKED-BY-INPUT: data/spike/links.txt 不存在,真实小红书提取实测延后。\n`,
      "utf8"
    );
    return;
  }

  const links = normalizeLinks(linksText);
  const sections: string[] = ["# SPIKE-NOTES", "", "## Spike A — xhs-cli", ""];
  if (links.length === 0) {
    sections.push("BLOCKED-BY-INPUT: data/spike/links.txt 存在但未包含可识别的小红书链接。");
    await writeFile(notesPath, `${sections.join("\n")}\n`, "utf8");
    return;
  }

  for (let index = 0; index < links.length; index++) {
    const link = links[index];
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, 2500));
    sections.push(`### Link ${index + 1}`, "", `- url: ${link}`);
    try {
      const stdout = await runXhs(link);
      const imageUrls = stdout.match(/https?:\/\/[^\s"'<>]+?\.(?:jpg|jpeg|png|webp)(?:\?[^\s"'<>]+)?/gi) ?? [];
      const imageChecks = await Promise.all(
        imageUrls.slice(0, 3).map(async (imageUrl) => {
          try {
            const response = await fetch(imageUrl);
            return `${imageUrl} -> ${response.ok ? "downloadable" : `HTTP ${response.status}`}`;
          } catch (error) {
            return `${imageUrl} -> failed: ${(error as Error).message}`;
          }
        })
      );
      sections.push(
        "- result: success",
        `- image url count: ${imageUrls.length}`,
        `- image checks: ${imageChecks.length ? imageChecks.join("; ") : "no image urls detected"}`,
        "",
        "Raw output sample:",
        "",
        "```text",
        stdout.slice(0, 4000),
        "```",
        ""
      );
    } catch (error) {
      sections.push(
        "- result: failed",
        `- evidence: ${(error as Error).message}`,
        "- 获取层走向需 haze 决策",
        ""
      );
    }
  }

  await writeFile(notesPath, `${sections.join("\n")}\n`, "utf8");
}

function runXhs(link: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("xhs", ["read", link], { timeout: 30_000, maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

main().catch(async (error) => {
  const notesPath = path.join(process.cwd(), "docs/ohaze/SPIKE-NOTES.md");
  await mkdir(path.dirname(notesPath), { recursive: true });
  await writeFile(
    notesPath,
    `# SPIKE-NOTES\n\n## Spike A — xhs-cli\n\n真实调用失败: ${(error as Error).message}\n\n获取层走向需 haze 决策。\n`,
    "utf8"
  );
  process.exitCode = 1;
});
