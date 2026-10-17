import { setTimeout as delay } from "node:timers/promises";
import { DswaError, invalidResponseError, isRecord, serverErrorMessage } from "./errors.ts";

/** Official DeepSeek Search endpoint. */
export const SEARCH_ENDPOINT = "https://api.deepseek.com/v1/tools/search";

/** Official DeepSeek Fetch endpoint. */
export const FETCH_ENDPOINT = "https://api.deepseek.com/v1/tools/fetch";

/** Per-attempt timeout used when the caller does not provide one. */
export const DEFAULT_TIMEOUT_MS = 60_000;

const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 10_000;
const SEARCH_LABEL = "DeepSeek Search";
const FETCH_LABEL = "DeepSeek Fetch";

/** Request body accepted by the DeepSeek Search API. */
export type SearchRequest = {
  query: string;
  count: number;
  need_content: boolean;
  ori_question?: string;
};

/** One normalized Search result. */
export type SearchResult = {
  rerank_score: number;
  title: string;
  url: string;
  snippet: string;
  summary: string;
  content: string;
  site_name: string | null;
  site_icon: string | null;
  date: string | null;
  authority: number;
};

/** Successful DeepSeek Fetch response. */
export type FetchPage = {
  title: string;
  content: string;
};

/** Injectable dependencies and limits for the DeepSeek HTTP client. */
export type ClientOptions = {
  fetch?: typeof fetch;
  timeoutMs?: number;
  sleep?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
};

/** Transport used by both tools. One call makes exactly one logical request. */
export type DeepSeekClient = {
  search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResult[]>;
  fetch(url: string, signal?: AbortSignal): Promise<FetchPage>;
};

type ResolvedClientOptions = {
  fetch: typeof fetch;
  timeoutMs: number;
  sleep: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  now: () => number;
};

/** Create a client bound to one resolved DeepSeek API key. */
export function createDeepSeekClient(apiKey: string, options: ClientOptions = {}): DeepSeekClient {
  const resolved = resolveOptions(options);

  return {
    async search(request, signal) {
      const body: Record<string, unknown> = {
        query: request.query,
        count: request.count,
        need_content: request.need_content,
      };
      if (request.ori_question !== undefined) body.ori_question = request.ori_question;

      const payload = await postJson(SEARCH_ENDPOINT, body, apiKey, SEARCH_LABEL, signal, resolved);
      return parseSearchResponse(payload);
    },

    async fetch(url, signal) {
      const payload = await postJson(
        FETCH_ENDPOINT,
        { url },
        apiKey,
        FETCH_LABEL,
        signal,
        resolved,
      );
      return parseFetchResponse(payload);
    },
  };
}

function resolveOptions(options: ClientOptions): ResolvedClientOptions {
  return {
    fetch: options.fetch ?? globalThis.fetch,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    sleep: options.sleep ?? defaultSleep,
    now: options.now ?? Date.now,
  };
}

function defaultSleep(delayMs: number, signal?: AbortSignal): Promise<void> {
  return delay(delayMs, undefined, { signal });
}

async function postJson(
  endpoint: string,
  body: unknown,
  apiKey: string,
  label: string,
  signal: AbortSignal | undefined,
  options: ResolvedClientOptions,
): Promise<unknown> {
  for (let attempt = 1; ; attempt += 1) {
    if (signal?.aborted) throw new DswaError(`${label} request was aborted.`);

    const timeoutSignal = AbortSignal.timeout(options.timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

    let response: Response;
    try {
      response = await options.fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: requestSignal,
      });
    } catch (error) {
      throw requestFailure(label, error, signal, timeoutSignal, options.timeoutMs);
    }

    if (response.ok) return readJson(response, label);

    if (!isRetryable(response.status) || attempt >= MAX_ATTEMPTS) {
      throw await httpFailure(response, label);
    }

    const delayMs = retryDelay(response.headers.get("retry-after"), attempt, options.now());
    await options.sleep(delayMs, signal);
  }
}

function requestFailure(
  label: string,
  error: unknown,
  signal: AbortSignal | undefined,
  timeoutSignal: AbortSignal,
  timeoutMs: number,
): DswaError {
  if (signal?.aborted) return new DswaError(`${label} request was aborted.`, { cause: error });
  if (timeoutSignal.aborted) {
    return new DswaError(`${label} timed out after ${timeoutMs} ms.`, { cause: error });
  }
  return new DswaError(`${label} request failed: ${describeError(error)}`, { cause: error });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readJson(response: Response, label: string): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new DswaError(`${label} returned an invalid JSON response.`);
  }
}

async function httpFailure(response: Response, label: string): Promise<DswaError> {
  const message = serverErrorMessage(await readErrorPayload(response));
  const suffix = message === undefined ? "." : `: ${message}`;
  return new DswaError(`${label} failed with HTTP ${response.status}${suffix}`);
}

async function readErrorPayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function isRetryable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function retryDelay(retryAfter: string | null, attempt: number, nowMs: number): number {
  const headerDelay = parseRetryAfter(retryAfter, nowMs);
  if (headerDelay !== undefined) return Math.min(headerDelay, MAX_RETRY_DELAY_MS);

  const backoff = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
  return Math.round(backoff * (0.5 + Math.random() * 0.5));
}

/** Parse Retry-After as seconds or an HTTP date. Returns undefined when absent or invalid. */
function parseRetryAfter(value: string | null, nowMs: number): number | undefined {
  if (value === null) return undefined;

  const trimmed = value.trim();
  if (trimmed === "") return undefined;

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds * 1000));

  const timestamp = Date.parse(trimmed);
  if (Number.isNaN(timestamp)) return undefined;
  return Math.max(0, timestamp - nowMs);
}

function parseSearchResponse(payload: unknown): SearchResult[] {
  if (!isRecord(payload) || !Array.isArray(payload.results)) {
    throw invalidResponseError(SEARCH_LABEL);
  }

  return payload.results.map((item) => {
    if (!isRecord(item)) throw invalidResponseError(SEARCH_LABEL);

    return {
      rerank_score: numberOr(item.rerank_score, 0),
      title: stringOrEmpty(item.title),
      url: stringOrEmpty(item.url),
      snippet: stringOrEmpty(item.snippet),
      summary: stringOrEmpty(item.summary),
      content: stringOrEmpty(item.content),
      site_name: stringOrNull(item.site_name),
      site_icon: stringOrNull(item.site_icon),
      date: stringOrNull(item.date),
      authority: numberOr(item.authority, -1),
    };
  });
}

function parseFetchResponse(payload: unknown): FetchPage {
  if (
    !isRecord(payload) ||
    typeof payload.title !== "string" ||
    typeof payload.content !== "string"
  ) {
    throw invalidResponseError(FETCH_LABEL);
  }

  return { title: payload.title, content: payload.content };
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" ? value : fallback;
}
