import type { AgentToolResult, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";

/** Minimal model registry fake used by tool tests. */
export type ModelRegistryFake = {
  getApiKeyForProvider: (provider: string) => Promise<string | undefined>;
  getProvider: (provider: string) => { baseUrl?: string } | undefined;
};

/** Build a JSON response for an injected fetch. */
export function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

/** Build a fetch mock with a precise signature. */
export function createFetchMock(
  handler: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
) {
  return vi.fn<typeof fetch>(handler);
}

/** Parse the JSON body of the first request made through a fetch mock. */
export function requestBody(fetchMock: ReturnType<typeof createFetchMock>): unknown {
  const body = fetchMock.mock.calls[0]?.[1]?.body;
  return typeof body === "string" ? JSON.parse(body) : undefined;
}

/** Return each response in order, repeating the last one once exhausted. */
export function sequence(responses: Response[]): typeof fetch {
  let index = 0;
  return async () => responses[Math.min(index++, responses.length - 1)]!;
}

/** Build a model registry fake with sane defaults. */
export function createModelRegistry(overrides: Partial<ModelRegistryFake> = {}): ModelRegistryFake {
  return {
    getApiKeyForProvider: async () => "test-key",
    getProvider: () => ({ baseUrl: "https://api.deepseek.com" }),
    ...overrides,
  };
}

/** Build the context surface used by tool execute functions. */
export function createToolContext(registry: ModelRegistryFake): ExtensionToolContext {
  return { modelRegistry: registry } as unknown as ExtensionToolContext;
}

/** Extract the model-facing text from a tool result. */
export function resultText(result: AgentToolResult<unknown>): string {
  const [first] = result.content;
  return first?.type === "text" ? first.text : "";
}

/** Create a controlled parent directory for temp artifact tests. */
export async function createTempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "pi-dswa-test-"));
}

/** Remove a controlled temp root. */
export async function removeTempRoot(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
}
