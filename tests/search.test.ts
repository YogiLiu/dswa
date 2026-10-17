import { describe, expect, it } from "vitest";
import { Value } from "typebox/value";
import type { SearchResult } from "../src/client.ts";
import {
  createSearchTool,
  normalizeSearchParams,
  SearchOutput,
  type SearchParams,
} from "../src/search.ts";
import {
  createFetchMock,
  createModelRegistry,
  createToolContext,
  jsonResponse,
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

const expectedText = `2 results for "deepseek"

1. DeepSeek V4 model released
   https://example.com/deepseek-v4
   rerank 2.40 · authority 3 · 2026-06-01 · Example News

   DeepSeek has released the V4 model.

2. DeepSeek V4 benchmarks
   https://example.com/benchmarks
   rerank 2.10 · authority 2 · 2026-05-28 · Example Blog

   Independent benchmarks.`;

const context = createToolContext(createModelRegistry());

function execute(tool: ReturnType<typeof createSearchTool>, params: SearchParams) {
  return tool.execute("tool-call", params, undefined, undefined, context);
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
  it("returns the documented text, details, and structured content", async () => {
    const fetchMock = createFetchMock(async () =>
      jsonResponse({ results: [firstResult, secondResult] }),
    );
    const tool = createSearchTool({ fetch: fetchMock });

    const result = await execute(tool, { query: "deepseek", count: 2, need_content: false });

    expect(requestBody(fetchMock)).toEqual({
      query: "deepseek",
      count: 2,
      need_content: false,
    });
    expect(resultText(result)).toBe(expectedText);
    expect(result.details).toEqual({
      query: "deepseek",
      count: 2,
      needContent: false,
      resultCount: 2,
      truncated: false,
    });
    expect(result.structuredContent).toEqual({
      query: "deepseek",
      count: 2,
      need_content: false,
      results: [firstResult, secondResult],
    });
    expect(Value.Check(SearchOutput, result.structuredContent)).toBe(true);
  });

  it("forwards ori_question", async () => {
    const fetchMock = createFetchMock(async () => jsonResponse({ results: [] }));
    const tool = createSearchTool({ fetch: fetchMock });

    await execute(tool, { query: "q", ori_question: "why" });

    expect(requestBody(fetchMock)).toEqual({
      query: "q",
      count: 10,
      need_content: false,
      ori_question: "why",
    });
  });

  it("reports an empty result set", async () => {
    const fetchMock = createFetchMock(async () => jsonResponse({ results: [] }));
    const tool = createSearchTool({ fetch: fetchMock });

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
    });
    expect(result.structuredContent).toMatchObject({ results: [] });
  });

  it("truncates a large result set and keeps the full structured data", async () => {
    const results = Array.from({ length: 50 }, (_, index) => ({
      ...firstResult,
      title: `Result ${index + 1}`,
      summary: "x".repeat(1500),
    }));
    const fetchMock = createFetchMock(async () => jsonResponse({ results }));
    const tool = createSearchTool({ fetch: fetchMock });

    const result = await execute(tool, { query: "q", count: 50 });

    expect(resultText(result)).toContain("[Output truncated:");
    expect(resultText(result)).toContain(
      "Use deepseek_fetch on a result URL to read the full page.]",
    );
    expect(result.details).toMatchObject({ resultCount: 50, truncated: true });

    const structured = result.structuredContent as { results: SearchResult[] };
    expect(structured.results).toHaveLength(50);
    expect(structured.results[0]?.summary).toHaveLength(1500);
    expect(Value.Check(SearchOutput, structured)).toBe(true);
  });

  it("fails before fetch when credentials are missing", async () => {
    const fetchMock = createFetchMock(async () => jsonResponse({ results: [] }));
    const tool = createSearchTool({ fetch: fetchMock });
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
    const tool = createSearchTool({ fetch: fetchMock });
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
    const tool = createSearchTool({ fetch: fetchMock });

    await expect(execute(tool, { query: "q" })).rejects.toThrow(
      "DeepSeek Search failed with HTTP 400: bad query",
    );
  });
});
