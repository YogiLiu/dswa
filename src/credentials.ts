import { DswaError } from "./errors.ts";

/** The only endpoint allowed to receive the DeepSeek credential. */
export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

const MISSING_CREDENTIALS_MESSAGE =
  "DeepSeek credentials are not configured. Run /login deepseek in Pi, or set DEEPSEEK_API_KEY.";

const UNSAFE_BASE_URL_MESSAGE =
  "Refusing to send DeepSeek credentials because the deepseek provider base URL is not https://api.deepseek.com.";

/** Minimal model registry surface needed to reuse Pi's DeepSeek credential. */
export type CredentialRegistry = {
  getApiKeyForProvider(provider: string): Promise<string | undefined>;
  getProvider(provider: string): { baseUrl?: string } | undefined;
};

/**
 * Resolve the DeepSeek key configured in Pi and verify the provider still points at the official
 * API before the key is used in a request.
 */
export async function resolveDeepSeekApiKey(registry: CredentialRegistry): Promise<string> {
  const apiKey = await registry.getApiKeyForProvider("deepseek");
  if (!apiKey) throw new DswaError(MISSING_CREDENTIALS_MESSAGE);

  const baseUrl = registry.getProvider("deepseek")?.baseUrl;
  if (normalizeBaseUrl(baseUrl) !== DEEPSEEK_BASE_URL) {
    throw new DswaError(UNSAFE_BASE_URL_MESSAGE);
  }

  return apiKey;
}

function normalizeBaseUrl(baseUrl: string | undefined): string | undefined {
  return baseUrl?.replace(/\/+$/, "");
}
