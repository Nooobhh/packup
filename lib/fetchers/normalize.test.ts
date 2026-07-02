import { describe, expect, it } from "vitest";
import { normalizeLinks } from "./normalize";

describe("normalizeLinks", () => {
  it("extracts xhs links from mixed paste text, dedupes, and preserves order", () => {
    const text = `
      周末攻略 https://www.xiaohongshu.com/explore/abc123?xsec_token=tok&foo=bar
      noise https://example.com/not-xhs
      复制口令打开 1.23 abc:/ https://xhslink.com/aBcD77 ，更多文字
      duplicate https://www.xiaohongshu.com/explore/abc123?xsec_token=tok&foo=bar
      mobile https://www.xiaohongshu.com/discovery/item/def456?xsec_token=t2。
    `;

    expect(normalizeLinks(text)).toEqual([
      "https://www.xiaohongshu.com/explore/abc123?xsec_token=tok&foo=bar",
      "https://xhslink.com/aBcD77",
      "https://www.xiaohongshu.com/discovery/item/def456?xsec_token=t2"
    ]);
  });
});
