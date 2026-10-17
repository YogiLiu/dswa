import { describe, expect, it } from "vitest";
import { DswaError, invalidResponseError, isRecord, serverErrorMessage } from "../src/errors.ts";

describe("DswaError", () => {
  it("sets its name, message, and cause", () => {
    const cause = new Error("boom");
    const error = new DswaError("failed", { cause });

    expect(error.name).toBe("DswaError");
    expect(error.message).toBe("failed");
    expect(error.cause).toBe(cause);
  });

  it("works without a cause", () => {
    expect(new DswaError("failed").cause).toBeUndefined();
  });
});

describe("isRecord", () => {
  it("accepts objects and arrays", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(true);
  });

  it("rejects primitives and null", () => {
    expect(isRecord(null)).toBe(false);
    expect(isRecord("value")).toBe(false);
    expect(isRecord(42)).toBe(false);
  });
});

describe("invalidResponseError", () => {
  it("mentions the API label", () => {
    expect(invalidResponseError("DeepSeek Search").message).toBe(
      "DeepSeek Search returned an unexpected response.",
    );
  });
});

describe("serverErrorMessage", () => {
  it("returns the OpenAI-compatible error message", () => {
    expect(serverErrorMessage({ error: { message: "bad count" } })).toBe("bad count");
  });

  it("returns undefined for non-objects", () => {
    expect(serverErrorMessage(null)).toBeUndefined();
  });

  it("returns undefined when error is not an object", () => {
    expect(serverErrorMessage({ error: "nope" })).toBeUndefined();
  });

  it("returns undefined for a non-string message", () => {
    expect(serverErrorMessage({ error: { message: 42 } })).toBeUndefined();
  });

  it("returns undefined for an empty message", () => {
    expect(serverErrorMessage({ error: { message: "   " } })).toBeUndefined();
  });
});
