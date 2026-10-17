import { describe, expect, it, vi } from "vitest";
import { DEEPSEEK_BASE_URL, resolveDeepSeekApiKey } from "../src/credentials.ts";

const UNSAFE_BASE_URL_MESSAGE =
  "Refusing to send DeepSeek credentials because the deepseek provider base URL is not https://api.deepseek.com.";

function createRegistry(provider: { baseUrl?: string } | undefined, apiKey: string | undefined) {
  return {
    getApiKeyForProvider: vi.fn<() => Promise<string | undefined>>(async () => apiKey),
    getProvider: vi.fn<() => { baseUrl?: string } | undefined>(() => provider),
  };
}

describe("resolveDeepSeekApiKey", () => {
  it("returns the key for the official DeepSeek provider", async () => {
    const registry = createRegistry({ baseUrl: DEEPSEEK_BASE_URL }, "test-key");

    await expect(resolveDeepSeekApiKey(registry)).resolves.toBe("test-key");
    expect(registry.getApiKeyForProvider).toHaveBeenCalledWith("deepseek");
    expect(registry.getProvider).toHaveBeenCalledWith("deepseek");
  });

  it("accepts a base URL with trailing slashes", async () => {
    const registry = createRegistry({ baseUrl: `${DEEPSEEK_BASE_URL}///` }, "test-key");

    await expect(resolveDeepSeekApiKey(registry)).resolves.toBe("test-key");
  });

  it("rejects a missing key with the documented message", async () => {
    const registry = createRegistry({ baseUrl: DEEPSEEK_BASE_URL }, undefined);

    await expect(resolveDeepSeekApiKey(registry)).rejects.toThrow(
      "DeepSeek credentials are not configured. Run /login deepseek in Pi, or set DEEPSEEK_API_KEY.",
    );
    expect(registry.getProvider).not.toHaveBeenCalled();
  });

  it("refuses a provider pointed at another base URL", async () => {
    const registry = createRegistry({ baseUrl: "https://example.com" }, "test-key");

    await expect(resolveDeepSeekApiKey(registry)).rejects.toThrow(UNSAFE_BASE_URL_MESSAGE);
  });

  it("refuses when the provider is missing", async () => {
    const registry = createRegistry(undefined, "test-key");

    await expect(resolveDeepSeekApiKey(registry)).rejects.toThrow(UNSAFE_BASE_URL_MESSAGE);
  });

  it("refuses when the provider has no base URL", async () => {
    const registry = createRegistry({}, "test-key");

    await expect(resolveDeepSeekApiKey(registry)).rejects.toThrow(UNSAFE_BASE_URL_MESSAGE);
  });
});
