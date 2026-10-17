import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ClientOptions,
  createDeepSeekClient,
  FETCH_ENDPOINT,
  SEARCH_ENDPOINT,
  type SearchRequest,
  type SearchResult,
} from "../src/client.ts";
import { createFetchMock, jsonResponse, requestBody, sequence } from "./helpers.ts";

const request: SearchRequest = { query: "deepseek", count: 3, need_content: false };

const fullResult: SearchResult = {
  rerank_score: 2.4,
  title: "DeepSeek V4 model released",
  url: "https://example.com/deepseek-v4",
  snippet: "A snippet",
  summary: "A summary",
  content: "Page content",
  site_name: "Example News",
  site_icon: "https://example.com/favicon.ico",
  date: "2026-06-01T00:00:00+00:00",
  authority: 3,
};

const emptyResult: SearchResult = {
  rerank_score: 0,
  title: "",
  url: "",
  snippet: "",
  summary: "",
  content: "",
  site_name: null,
  site_icon: null,
  date: null,
  authority: -1,
};

function createSleepMock() {
  return vi.fn<(delayMs: number, signal?: AbortSignal) => Promise<void>>(async () => {});
}

function createClient(fetchMock: ReturnType<typeof createFetchMock>, options: ClientOptions = {}) {
  return createDeepSeekClient("test-key", { fetch: fetchMock, ...options });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("search", () => {
  it("sends the documented request and maps the response", async () => {
    const fetchMock = createFetchMock(async () => jsonResponse({ results: [fullResult] }));
    const client = createClient(fetchMock);

    await expect(client.search(request)).resolves.toEqual([fullResult]);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(SEARCH_ENDPOINT);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      Authorization: "Bearer test-key",
      "Content-Type": "application/json",
    });
    expect(requestBody(fetchMock)).toEqual({
      query: "deepseek",
      count: 3,
      need_content: false,
    });
  });

  it("forwards ori_question when provided", async () => {
    const fetchMock = createFetchMock(async () => jsonResponse({ results: [] }));
    const client = createClient(fetchMock);

    await client.search({ ...request, ori_question: "What is new in V4?" });

    expect(requestBody(fetchMock)).toEqual({
      query: "deepseek",
      count: 3,
      need_content: false,
      ori_question: "What is new in V4?",
    });
  });

  it("accepts an empty result set", async () => {
    const fetchMock = createFetchMock(async () => jsonResponse({ results: [] }));
    const client = createClient(fetchMock);

    await expect(client.search(request)).resolves.toEqual([]);
  });

  it("fills defaults for sparse results", async () => {
    const fetchMock = createFetchMock(async () => jsonResponse({ results: [{}] }));
    const client = createClient(fetchMock);

    await expect(client.search(request)).resolves.toEqual([emptyResult]);
  });

  it.each([
    ["a non-object payload", null],
    ["a missing results array", {}],
    ["a non-object result item", { results: [null] }],
  ])("rejects %s", async (_name, payload) => {
    const fetchMock = createFetchMock(async () => jsonResponse(payload));
    const client = createClient(fetchMock);

    await expect(client.search(request)).rejects.toThrow(
      "DeepSeek Search returned an unexpected response.",
    );
  });

  it("rejects an invalid JSON response", async () => {
    const fetchMock = createFetchMock(async () => new Response("not json", { status: 200 }));
    const client = createClient(fetchMock);

    await expect(client.search(request)).rejects.toThrow(
      "DeepSeek Search returned an invalid JSON response.",
    );
  });
});

describe("fetch", () => {
  it("sends the documented request and maps the response", async () => {
    const fetchMock = createFetchMock(async () =>
      jsonResponse({ title: "Example", content: "# Hello" }),
    );
    const client = createClient(fetchMock);

    await expect(client.fetch("https://example.com")).resolves.toEqual({
      title: "Example",
      content: "# Hello",
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(FETCH_ENDPOINT);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      Authorization: "Bearer test-key",
      "Content-Type": "application/json",
    });
    expect(requestBody(fetchMock)).toEqual({ url: "https://example.com" });
  });

  it.each([
    ["a non-object payload", null],
    ["a missing title", { content: "content" }],
    ["a missing content", { title: "title" }],
  ])("rejects %s", async (_name, payload) => {
    const fetchMock = createFetchMock(async () => jsonResponse(payload));
    const client = createClient(fetchMock);

    await expect(client.fetch("https://example.com")).rejects.toThrow(
      "DeepSeek Fetch returned an unexpected response.",
    );
  });
});

describe("HTTP errors", () => {
  it("includes the server message and does not retry a 400", async () => {
    const fetchMock = createFetchMock(async () =>
      jsonResponse({ error: { message: "bad query" } }, { status: 400 }),
    );
    const client = createClient(fetchMock);

    await expect(client.search(request)).rejects.toThrow(
      "DeepSeek Search failed with HTTP 400: bad query",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["invalid JSON", () => new Response("not json", { status: 400 })],
    ["a missing error object", () => jsonResponse({}, { status: 400 })],
    ["a non-string message", () => jsonResponse({ error: { message: 42 } }, { status: 400 })],
    ["an empty message", () => jsonResponse({ error: { message: "  " } }, { status: 400 })],
  ])("reports the status for %s", async (_name, makeResponse) => {
    const fetchMock = createFetchMock(async () => makeResponse());
    const client = createClient(fetchMock);

    await expect(client.search(request)).rejects.toThrow("DeepSeek Search failed with HTTP 400.");
  });
});

describe("transport failures", () => {
  it("wraps a network error and preserves its cause", async () => {
    const cause = new Error("connection reset");
    const fetchMock = createFetchMock(() => Promise.reject(cause));
    const client = createClient(fetchMock);

    await expect(client.search(request)).rejects.toMatchObject({
      message: "DeepSeek Search request failed: connection reset",
      cause,
    });
  });

  it("describes a non-Error rejection", async () => {
    const fetchMock = createFetchMock(() => Promise.reject("nope"));
    const client = createClient(fetchMock);

    await expect(client.search(request)).rejects.toThrow("DeepSeek Search request failed: nope");
  });

  it("reports a timeout separately from a network failure", async () => {
    const fetchMock = createFetchMock(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const client = createClient(fetchMock, { timeoutMs: 5 });

    await expect(client.search(request)).rejects.toThrow("DeepSeek Search timed out after 5 ms.");
  });

  it("reports an abort before the request without calling fetch", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = createFetchMock(async () => jsonResponse({ results: [] }));
    const client = createClient(fetchMock);

    await expect(client.search(request, controller.signal)).rejects.toThrow(
      "DeepSeek Search request was aborted.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports an abort during the request", async () => {
    const controller = new AbortController();
    const fetchMock = createFetchMock((_input, init) => {
      controller.abort();
      return Promise.reject(init?.signal?.reason);
    });
    const client = createClient(fetchMock);

    await expect(client.search(request, controller.signal)).rejects.toThrow(
      "DeepSeek Search request was aborted.",
    );
  });
});

describe("retries", () => {
  it("retries a 408 and then succeeds", async () => {
    const fetchMock = createFetchMock(
      sequence([jsonResponse({}, { status: 408 }), jsonResponse({ results: [fullResult] })]),
    );
    const sleep = createSleepMock();
    const client = createClient(fetchMock, { sleep });

    await expect(client.search(request)).resolves.toEqual([fullResult]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("honors a numeric Retry-After", async () => {
    const fetchMock = createFetchMock(
      sequence([
        jsonResponse({}, { status: 429, headers: { "Retry-After": "2" } }),
        jsonResponse({ results: [] }),
      ]),
    );
    const sleep = createSleepMock();
    const client = createClient(fetchMock, { sleep });

    await client.search(request);

    expect(sleep).toHaveBeenCalledWith(2000, undefined);
  });

  it("honors a Retry-After HTTP date", async () => {
    const nowMs = Date.parse("2026-01-01T00:00:00Z");
    const fetchMock = createFetchMock(
      sequence([
        jsonResponse(
          {},
          {
            status: 429,
            headers: { "Retry-After": new Date(nowMs + 5000).toUTCString() },
          },
        ),
        jsonResponse({ results: [] }),
      ]),
    );
    const sleep = createSleepMock();
    const client = createClient(fetchMock, { sleep, now: () => nowMs });

    await client.search(request);

    expect(sleep).toHaveBeenCalledWith(5000, undefined);
  });

  it("caps a large Retry-After at ten seconds", async () => {
    const fetchMock = createFetchMock(
      sequence([
        jsonResponse({}, { status: 429, headers: { "Retry-After": "120" } }),
        jsonResponse({ results: [] }),
      ]),
    );
    const sleep = createSleepMock();
    const client = createClient(fetchMock, { sleep });

    await client.search(request);

    expect(sleep).toHaveBeenCalledWith(10_000, undefined);
  });

  it("floors a negative Retry-After at zero", async () => {
    const fetchMock = createFetchMock(
      sequence([
        jsonResponse({}, { status: 429, headers: { "Retry-After": "-5" } }),
        jsonResponse({ results: [] }),
      ]),
    );
    const sleep = createSleepMock();
    const client = createClient(fetchMock, { sleep });

    await client.search(request);

    expect(sleep).toHaveBeenCalledWith(0, undefined);
  });

  it.each([
    ["an empty header", ""],
    ["an invalid header", "not-a-date"],
  ])("falls back to jitter for %s", async (_name, retryAfter) => {
    const fetchMock = createFetchMock(
      sequence([
        jsonResponse({}, { status: 429, headers: { "Retry-After": retryAfter } }),
        jsonResponse({ results: [] }),
      ]),
    );
    const sleep = createSleepMock();
    const client = createClient(fetchMock, { sleep });

    await client.search(request);

    const delayMs = sleep.mock.calls[0]?.[0] ?? 0;
    expect(delayMs).toBeGreaterThanOrEqual(250);
    expect(delayMs).toBeLessThanOrEqual(500);
  });

  it("stops after three attempts with jittered backoff", async () => {
    const fetchMock = createFetchMock(async () =>
      jsonResponse({ error: { message: "boom" } }, { status: 503 }),
    );
    const sleep = createSleepMock();
    const client = createClient(fetchMock, { sleep });

    await expect(client.search(request)).rejects.toThrow(
      "DeepSeek Search failed with HTTP 503: boom",
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const delays = sleep.mock.calls.map(([delayMs]) => delayMs);
    expect(delays).toHaveLength(2);
    expect(delays[0]).toBeGreaterThanOrEqual(250);
    expect(delays[0]).toBeLessThanOrEqual(500);
    expect(delays[1]).toBeGreaterThanOrEqual(500);
    expect(delays[1]).toBeLessThanOrEqual(1000);
  });

  it("uses the default sleep for a zero Retry-After", async () => {
    const fetchMock = createFetchMock(
      sequence([
        jsonResponse({}, { status: 429, headers: { "Retry-After": "0" } }),
        jsonResponse({ results: [] }),
      ]),
    );
    const client = createClient(fetchMock);

    await expect(client.search(request)).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("defaults", () => {
  it("uses the global fetch when none is injected", async () => {
    const fetchMock = createFetchMock(async () => jsonResponse({ results: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createDeepSeekClient("test-key");

    await expect(client.search(request)).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
