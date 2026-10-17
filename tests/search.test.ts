import { readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Value } from "typebox/value";
import type { SearchResult } from "../src/client.ts";
import { formatSearchSummary, SEARCH_SUMMARY_CHARS } from "../src/format.ts";
import {
  createSearchTool,
  normalizeSearchParams,
  SearchOutput,
  type SearchParams,
  type SearchToolDetails,
} from "../src/search.ts";
import { createTempFiles, type TempFiles } from "../src/temp.ts";
import {
  createFetchMock,
  createModelRegistry,
  createTempRoot,
  createToolContext,
  jsonResponse,
  removeTempRoot,
  requestBody,
  resultText,
} from "./helpers.ts";

const firstResult: SearchResult = {
  rerank_score: 2.4,
  title: "DeepSeek V4 model released",
  url: "https://example.com/deepseek-v4",
  snippet: "A snippet",
  summary: "DeepSeek has released the V4 model.",
  content: "",
  site_name: "Example News",
  site_icon: null,
  date: "2026-06-01T00:00:00+00:00",
  authority: 3,
};

const secondResult: SearchResult = {
  rerank_score: 2.1,
  title: "DeepSeek V4 benchmarks",
  url: "https://example.com/benchmarks",
  snippet: "",
  summary: "Independent benchmarks.",
  content: "",
  site_name: "Example Blog",
  site_icon: null,
  date: "2026-05-28T00:00:00+00:00",
  authority: 2,
};

let root: string;

beforeEach(async () => {
  root = await createTempRoot();
});

afterEach(async () => {
  await removeTempRoot(root);
});

function createTool(fetchMock: ReturnType<typeof createFetchMock>) {
  return createSearchTool({
    fetch: fetchMock,
    tempFilesFactory: () => createTempFiles({ root }),
  });
}

function execute(tool: ReturnType<typeof createSearchTool>, params: SearchParams) {
  return tool.execute(
    "tool-call",
    params,
    undefined,
    undefined,
    createToolContext(createModelRegistry()),
  );
}

function manifestEntry(result: SearchResult, rank: number, detailPath: string) {
  return {
    rank,
    title: result.title,
    url: result.url,
    rerank_score: result.rerank_score,
    authority: result.authority,
    date: result.date,
    site_name: result.site_name,
    summary: formatSearchSummary(result),
    full_summary_chars: Array.from(result.summary).length,
    full_snippet_chars: Array.from(result.snippet).length,
    full_content_chars: Array.from(result.content).length,
    detail_path: detailPath,
  };
}

describe("normalizeSearchParams", () => {
  it("applies defaults", () => {
    expect(normalizeSearchParams({ query: "hello" })).toEqual({
      query: "hello",
      count: 10,
      need_content: false,
      ori_question: undefined,
    });
  });

  it("keeps explicit values", () => {
    expect(
      normalizeSearchParams({ query: "q", count: 50, need_content: true, ori_question: "why" }),
    ).toEqual({ query: "q", count: 50, need_content: true, ori_question: "why" });
  });

  it("accepts a query of 128 ASCII characters", () => {
    const query = "a".repeat(128);
    expect(normalizeSearchParams({ query }).query).toHaveLength(128);
  });

  it("counts Unicode code points rather than UTF-16 units", () => {
    const query = "😀".repeat(128);
    expect(query.length).toBe(256);
    expect(normalizeSearchParams({ query }).query).toBe(query);
  });

  it.each([
    ["an empty query", { query: "" }, "'query' must contain between 1 and 128 characters."],
    ["a whitespace query", { query: "   " }, "'query' must not be all whitespace."],
    [
      "a query longer than 128 characters",
      { query: "a".repeat(129) },
      "'query' must contain between 1 and 128 characters.",
    ],
    [
      "a query longer than 128 code points",
      { query: "😀".repeat(129) },
      "'query' must contain between 1 and 128 characters.",
    ],
    [
      "an empty original question",
      { query: "q", ori_question: "" },
      "'ori_question' must contain between 1 and 128 characters.",
    ],
    [
      "a whitespace original question",
      { query: "q", ori_question: "  " },
      "'ori_question' must not be all whitespace.",
    ],
    [
      "an original question longer than 128 characters",
      { query: "q", ori_question: "a".repeat(129) },
      "'ori_question' must contain between 1 and 128 characters.",
    ],
    [
      "a count below the minimum",
      { query: "q", count: 0 },
      "'count' must be an integer between 1 and 50.",
    ],
    [
      "a count above the maximum",
      { query: "q", count: 51 },
      "'count' must be an integer between 1 and 50.",
    ],
    [
      "a non-integer count",
      { query: "q", count: 1.5 },
      "'count' must be an integer between 1 and 50.",
    ],
  ])("rejects %s", (_name, params, message) => {
    expect(() => normalizeSearchParams(params)).toThrow(message);
  });
});

describe("createSearchTool", () => {
  it("returns a compact list and writes the metadata index and per-result Markdown", async () => {
    const fetchMock = createFetchMock(async () =>
      jsonResponse({ results: [firstResult, secondResult] }),
    );
    const tool = createTool(fetchMock);

    const result = await execute(tool, { query: "deepseek", count: 2, need_content: false });
    const text = resultText(result);
    const details = result.details as SearchToolDetails;
    const detailsDir = details.detailsDir;

    expect(requestBody(fetchMock)).toEqual({
      query: "deepseek",
      count: 2,
      need_content: false,
    });
    expect(text.startsWith('2 results for "deepseek"\n\nDetails: `')).toBe(true);
    expect(detailsDir).toBeTruthy();
    expect(text).toContain(`Details: \`${detailsDir}\` (results.json and 1.md..2.md)`);
    expect(text).toContain("rerank 2.40 · authority 3 · 2026-06-01 · Example News");
    expect(text).toContain("Summary: DeepSeek has released the V4 model.");
    expect(text).toContain(`Detail: \`${join(detailsDir!, "1.md")}\``);
    expect(text).toContain(`Detail: \`${join(detailsDir!, "2.md")}\``);
    expect(details).toEqual({
      query: "deepseek",
      count: 2,
      needContent: false,
      resultCount: 2,
      truncated: false,
      detailsDir,
    });
    expect(result.structuredContent).toEqual({
      query: "deepseek",
      count: 2,
      need_content: false,
      results: [firstResult, secondResult],
      details_dir: detailsDir,
    });
    expect(Value.Check(SearchOutput, result.structuredContent)).toBe(true);

    const sidecar = JSON.parse(
      await readFile(join(detailsDir!, "results.json"), "utf8"),
    ) as unknown;
    expect(sidecar).toEqual({
      query: "deepseek",
      count: 2,
      need_content: false,
      results: [
        manifestEntry(firstResult, 1, join(detailsDir!, "1.md")),
        manifestEntry(secondResult, 2, join(detailsDir!, "2.md")),
      ],
    });
    expect(JSON.stringify(sidecar)).toContain(firstResult.summary);
    expect(JSON.stringify(sidecar)).toContain(secondResult.summary);
    expect(JSON.stringify(sidecar)).not.toContain(firstResult.snippet);

    const firstDetail = await readFile(join(detailsDir!, "1.md"), "utf8");
    expect(firstDetail).toContain("# 1. DeepSeek V4 model released");
    expect(firstDetail).toContain("## Summary");
    expect(firstDetail).toContain("## Snippet");
    expect(firstDetail).not.toContain("## Content");
  });

  it("forwards ori_question to the request and the JSON sidecar", async () => {
    const fetchMock = createFetchMock(async () => jsonResponse({ results: [firstResult] }));
    const tool = createTool(fetchMock);

    const result = await execute(tool, { query: "q", count: 1, ori_question: "why" });
    const details = result.details as SearchToolDetails;

    expect(requestBody(fetchMock)).toEqual({
      query: "q",
      count: 1,
      need_content: false,
      ori_question: "why",
    });
    const sidecar = JSON.parse(
      await readFile(join(details.detailsDir!, "results.json"), "utf8"),
    ) as {
      query: string;
      ori_question: string;
      results: Array<{ detail_path: string; summary: string; full_summary_chars: number }>;
    };
    expect(sidecar).toMatchObject({ query: "q", ori_question: "why" });
    expect(sidecar.results[0]).toMatchObject({
      detail_path: join(details.detailsDir!, "1.md"),
      summary: formatSearchSummary(firstResult),
      full_summary_chars: Array.from(firstResult.summary).length,
    });
  });

  it("never inlines page content when need_content is true", async () => {
    const content = "FULL PAGE CONTENT";
    const fetchMock = createFetchMock(async () =>
      jsonResponse({ results: [{ ...firstResult, content }] }),
    );
    const tool = createTool(fetchMock);

    const result = await execute(tool, { query: "q", count: 1, need_content: true });
    const text = resultText(result);
    const details = result.details as SearchToolDetails;

    expect(text).not.toContain(content);
    expect(text).toContain("Summary: DeepSeek has released the V4 model.");
    const detail = await readFile(join(details.detailsDir!, "1.md"), "utf8");
    expect(detail).toContain("## Content");
    expect(detail).toContain(content);
    const sidecar = JSON.parse(
      await readFile(join(details.detailsDir!, "results.json"), "utf8"),
    ) as { results: Array<{ full_content_chars: number; detail_path: string; summary: string }> };
    expect(sidecar.results).toHaveLength(1);
    expect(sidecar.results[0]).toMatchObject({
      summary: formatSearchSummary({ ...firstResult, content }),
      full_content_chars: Array.from(content).length,
      detail_path: join(details.detailsDir!, "1.md"),
    });
    expect(JSON.stringify(sidecar)).not.toContain(content);
    expect((result.structuredContent as { results: SearchResult[] }).results).toEqual([
      { ...firstResult, content },
    ]);
  });

  it("returns no artifacts for an empty result set", async () => {
    const fetchMock = createFetchMock(async () => jsonResponse({ results: [] }));
    const tool = createTool(fetchMock);

    const result = await execute(tool, { query: "missing" });

    expect(resultText(result)).toBe(
      'No results for "missing". Try a broader query or fewer operators.',
    );
    expect(result.details).toEqual({
      query: "missing",
      count: 10,
      needContent: false,
      resultCount: 0,
      truncated: false,
      detailsDir: null,
    });
    expect(result.structuredContent).toMatchObject({ results: [], details_dir: null });
    expect(Value.Check(SearchOutput, result.structuredContent)).toBe(true);
    expect(await readdir(root)).toEqual([]);
  });

  it("collapses long summaries to one line and keeps the full text in the detail file", async () => {
    const summary = `First\n${"😀".repeat(SEARCH_SUMMARY_CHARS + 5)}`;
    const fetchMock = createFetchMock(async () =>
      jsonResponse({ results: [{ ...firstResult, summary }] }),
    );
    const tool = createTool(fetchMock);

    const result = await execute(tool, { query: "q", count: 1 });
    const text = resultText(result);
    const summaryLine = text.split("\n").find((line) => line.includes("Summary:"));
    const details = result.details as SearchToolDetails;

    expect(summaryLine).toContain("Summary: First ");
    expect(summaryLine?.endsWith("...")).toBe(true);
    const detail = await readFile(join(details.detailsDir!, "1.md"), "utf8");
    expect(detail).toContain(summary);
    const sidecar = await readFile(join(details.detailsDir!, "results.json"), "utf8");
    expect(sidecar).not.toContain(summary);
    expect(sidecar).toContain(formatSearchSummary({ ...firstResult, summary }));
    expect(sidecar).toContain('"full_summary_chars"');
  });

  it("truncates a very large compact list and points at the detail directory", async () => {
    const results = Array.from({ length: 50 }, (_, index) => ({
      ...firstResult,
      title: `Result ${index + 1}`,
      url: `https://example.com/${"a".repeat(2000)}`,
      summary: "Summary",
    }));
    const fetchMock = createFetchMock(async () => jsonResponse({ results }));
    const tool = createTool(fetchMock);

    const result = await execute(tool, { query: "q", count: 50 });
    const text = resultText(result);
    const details = result.details as SearchToolDetails;

    expect(details.truncated).toBe(true);
    expect(details.detailsDir).toBeTruthy();
    expect(text).toContain("[Output truncated:");
    expect(text).toContain(`All 50 result detail files are in \`${details.detailsDir}\`.`);
    const structured = result.structuredContent as { results: SearchResult[] };
    expect(structured.results).toHaveLength(50);
    expect(Value.Check(SearchOutput, structured)).toBe(true);
  });

  it("uses the platform temp directory by default", async () => {
    const fetchMock = createFetchMock(async () => jsonResponse({ results: [firstResult] }));
    const tool = createSearchTool({ fetch: fetchMock });

    const result = await execute(tool, { query: "q", count: 1 });
    const details = result.details as SearchToolDetails;

    try {
      expect(details.detailsDir?.startsWith(tmpdir())).toBe(true);
    } finally {
      if (details.detailsDir) await removeTempRoot(details.detailsDir);
    }
  });

  it.each([
    {
      name: "an Error",
      factory: (): never => {
        throw new Error("disk full");
      },
      message: "disk full",
    },
    {
      name: "a string",
      factory: (): never => {
        throw "offline";
      },
      message: "offline",
    },
    {
      name: "an empty Error",
      factory: (): never => {
        throw new Error("");
      },
      message: "unknown error",
    },
  ])("falls back to a compact list when writing fails with $name", async ({ factory, message }) => {
    const fetchMock = createFetchMock(async () => jsonResponse({ results: [firstResult] }));
    const tool = createSearchTool({
      fetch: fetchMock,
      tempFilesFactory: factory as () => TempFiles,
    });

    const result = await execute(tool, { query: "q", count: 1 });
    const text = resultText(result);

    expect(text).toContain(
      `[Could not save search details to a temporary file: ${message}. Showing compact results only.]`,
    );
    expect(text).toContain("Summary: DeepSeek has released the V4 model.");
    expect(text).not.toContain("Detail:");
    expect(result.details).toMatchObject({ detailsDir: null, truncated: false });
    expect(result.structuredContent).toMatchObject({ details_dir: null });
    expect(Value.Check(SearchOutput, result.structuredContent)).toBe(true);
  });

  it("truncates the fallback list and suggests deepseek_fetch when writing fails", async () => {
    const results = Array.from({ length: 50 }, (_, index) => ({
      ...firstResult,
      title: `Result ${index + 1}`,
      url: `https://example.com/${"a".repeat(2000)}`,
    }));
    const fetchMock = createFetchMock(async () => jsonResponse({ results }));
    const tool = createSearchTool({
      fetch: fetchMock,
      tempFilesFactory: () => ({
        write: async () => {
          throw new Error("disk full");
        },
      }),
    });

    const result = await execute(tool, { query: "q", count: 50 });
    const text = resultText(result);

    expect(text).toContain("[Output truncated:");
    expect(text).toContain("Use deepseek_fetch on a result URL to read the full page.]");
    expect(result.details).toMatchObject({ detailsDir: null, truncated: true });
    expect(Value.Check(SearchOutput, result.structuredContent)).toBe(true);
  });

  it("fails before fetch when credentials are missing", async () => {
    const fetchMock = createFetchMock(async () => jsonResponse({ results: [] }));
    const tool = createTool(fetchMock);
    const missingCredentials = createToolContext(
      createModelRegistry({ getApiKeyForProvider: async () => undefined }),
    );

    await expect(
      tool.execute("tool-call", { query: "q" }, undefined, undefined, missingCredentials),
    ).rejects.toThrow(
      "DeepSeek credentials are not configured. Run /login deepseek in Pi, or set DEEPSEEK_API_KEY.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails before fetch when the provider base URL is not official", async () => {
    const fetchMock = createFetchMock(async () => jsonResponse({ results: [] }));
    const tool = createTool(fetchMock);
    const unsafeProvider = createToolContext(
      createModelRegistry({ getProvider: () => ({ baseUrl: "https://example.com" }) }),
    );

    await expect(
      tool.execute("tool-call", { query: "q" }, undefined, undefined, unsafeProvider),
    ).rejects.toThrow(
      "Refusing to send DeepSeek credentials because the deepseek provider base URL is not https://api.deepseek.com.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("propagates HTTP errors", async () => {
    const fetchMock = createFetchMock(async () =>
      jsonResponse({ error: { message: "bad query" } }, { status: 400 }),
    );
    const tool = createTool(fetchMock);

    await expect(execute(tool, { query: "q" })).rejects.toThrow(
      "DeepSeek Search failed with HTTP 400: bad query",
    );
  });
});
