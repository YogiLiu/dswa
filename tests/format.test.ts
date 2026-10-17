import { readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import type { SearchResult } from "../src/client.ts";
import {
  formatFetchPage,
  formatSearchResults,
  truncateFetchOutput,
  truncateSearchOutput,
} from "../src/format.ts";

const baseResult: SearchResult = {
  rerank_score: 2.4,
  title: "Title",
  url: "https://example.com",
  snippet: "",
  summary: "",
  content: "",
  site_name: null,
  site_icon: null,
  date: null,
  authority: -1,
};

describe("formatSearchResults", () => {
  it("reports an empty result set", () => {
    expect(formatSearchResults("query", [])).toBe(
      'No results for "query". Try a broader query or fewer operators.',
    );
  });

  it("uses a singular header and omits missing fields", () => {
    const result: SearchResult = {
      ...baseResult,
      title: "",
      url: "",
    };

    expect(formatSearchResults("query", [result])).toBe(
      '1 result for "query"\n\n1. (untitled)\n   rerank 2.40',
    );
  });

  it("indents multi-line summaries and content", () => {
    const result: SearchResult = {
      ...baseResult,
      summary: "First line\nSecond line",
      content: "Page line one\nPage line two",
    };
    const text = formatSearchResults("query", [result, baseResult]);

    expect(text).toContain('2 results for "query"');
    expect(text).toContain("   First line\n   Second line");
    expect(text).toContain("   Content:\n   Page line one\n   Page line two");
  });

  it("shortens dates and includes authority and site name", () => {
    const result: SearchResult = {
      ...baseResult,
      date: "2026-06-01T00:00:00+00:00",
      authority: 3,
      site_name: "Example News",
    };

    expect(formatSearchResults("query", [result])).toContain(
      "rerank 2.40 · authority 3 · 2026-06-01 · Example News",
    );
  });
});

describe("formatFetchPage", () => {
  it("adds a heading when the title is present", () => {
    expect(formatFetchPage({ title: "Example", content: "Body" })).toBe("# Example\n\nBody");
  });

  it("returns only the content when the title is empty", () => {
    expect(formatFetchPage({ title: "", content: "Body" })).toBe("Body");
  });
});

describe("truncateSearchOutput", () => {
  it("returns short text unchanged", () => {
    const output = truncateSearchOutput("short text");

    expect(output.text).toBe("short text");
    expect(output.truncation.truncated).toBe(false);
  });

  it("appends a fetch hint when truncated", () => {
    const text = Array.from({ length: 2100 }, (_, index) => `line ${index + 1}`).join("\n");
    const output = truncateSearchOutput(text);

    expect(output.truncation.truncated).toBe(true);
    expect(output.text).toContain("[Output truncated:");
    expect(output.text).toContain("Use deepseek_fetch on a result URL to read the full page.]");
  });
});

describe("truncateFetchOutput", () => {
  it("returns short text unchanged without a temp file", async () => {
    const output = await truncateFetchOutput("short text");

    expect(output.text).toBe("short text");
    expect(output.truncation.truncated).toBe(false);
    expect(output.fullContentPath).toBeUndefined();
  });

  it("writes the full text to a temp file when truncated", async () => {
    const text = Array.from({ length: 2100 }, (_, index) => `line ${index + 1}`).join("\n");
    const output = await truncateFetchOutput(text);

    expect(output.truncation.truncated).toBe(true);
    expect(output.fullContentPath).toBeDefined();

    const path = output.fullContentPath!;
    try {
      expect(await readFile(path, "utf8")).toBe(text);
      expect(output.text).toContain(`Full content saved to: ${path}]`);
    } finally {
      await rm(dirname(path), { recursive: true, force: true });
    }
  });
});
