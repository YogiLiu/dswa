/** Error surfaced to Pi when a DeepSeek Web Access tool call fails. */
export class DswaError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DswaError";
  }
}

/** Whether a JSON value is a non-null object (arrays included). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Build the error for a response that is valid JSON but not the documented shape. */
export function invalidResponseError(label: string): DswaError {
  return new DswaError(`${label} returned an unexpected response.`);
}

/**
 * Extract a non-empty message from an OpenAI-compatible error payload:
 * `{ "error": { "message": "..." } }`. Returns undefined when none is available.
 */
export function serverErrorMessage(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const { error } = payload;
  if (!isRecord(error)) return undefined;
  const { message } = error;
  return typeof message === "string" && message.trim() !== "" ? message : undefined;
}
