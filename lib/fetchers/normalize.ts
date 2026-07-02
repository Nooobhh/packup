const URL_RE = /https?:\/\/[^\s"'<>]+/gi;
const XHS_HOSTS = ["xiaohongshu.com", "xhslink.com"];
const TRAILING_PUNCTUATION = /[),，。！？；;:：]+$/;

export function normalizeLinks(raw: string): string[] {
  const seen = new Set<string>();
  const links: string[] = [];

  for (const match of raw.matchAll(URL_RE)) {
    const candidate = match[0].replace(TRAILING_PUNCTUATION, "");
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      continue;
    }

    if (!XHS_HOSTS.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))) {
      continue;
    }

    const normalized = parsed.toString();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      links.push(normalized);
    }
  }

  return links;
}
