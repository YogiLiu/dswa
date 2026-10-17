import { readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { Value } from "typebox/value";
import {
  createFetchTool,
  FetchOutput,
  type FetchToolDetails,
  validateFetchUrl,
} from "../src/fetch.ts";
import {
  createFetchMock,
  createModelRegistry,
  createToolContext,
  jsonResponse,
  requestBody,
  resultText,
} from "./helpers.ts";

const context = createToolContext(createModelRegistry());

describe("validateFetchUrl", () => {
  it.each([
    ["https://example.com", "https://example.com/"],
    ["https://example.com/a b", "https://example.com/a%20b"],
    ["http://Example.COM/Path", "http://example.com/Path"],
    [" https://example.com ", "https://example.com/"],
    ["http://[::1]/x", "http://[::1]/x"],
  ])("normalizes %s", (input, expected) => {
    expect(validateFetchUrl(input)).toBe(expected);
  });

  it.each([
    [
      "a URL longer than 8192 characters",
      `https://example.com/${"a".repeat(8192)}`,
      "'url' must be at most 8192 characters.",
    ],
    ["an invalid URL", "not a url", "'url' must be a valid HTTP or HTTPS URL."],
    ["a non-HTTP URL", "ftp://example.com", "'url' must use HTTP or HTTPS."],
    ["a username", "https://user@example.com", "'url' must not contain a username or password."],
    ["a password", "https://:pass@example.com", "'url' must not contain a username or password."],
  ])("rejects %s", (_name, input, message) => {
    expect(() => validateFetchUrl(input)).toThrow(message);
  });
});

describe("createFetchTool", () => {
  it("returns the documented text, details, and structured content", async () => {
    const fetchMock = createFetchMock(async () =>
      jsonResponse({ title: "Example", content: "# Hello\n\nWorld" }),
    );
    const tool = createFetchTool({ fetch: fetchMock });

    const result = await tool.execute(
      "tool-call",
      { url: "https://example.com" },
      undefined,
      undefined,
      context,
    );

    expect(requestBody(fetchMock)).toEqual({ url: "https://example.com/" });
    expect(resultText(result)).toBe("# Example\n\n# Hello\n\nWorld");
    expect(result.details).toEqual({
      url: "https://example.com/",
      title: "Example",
      truncated: false,
      fullContentPath: null,
    });
    expect(result.structuredContent).toEqual({
      url: "https://example.com/",
      title: "Example",
      content: "# Hello\n\nWorld",
      truncated: false,
      full_content_path: null,
    });
    expect(Value.Check(FetchOutput, result.structuredContent)).toBe(true);
  });

  it("omits the heading when the page title is empty", async () => {
    const fetchMock = createFetchMock(async () =>
      jsonResponse({ title: "", content: "Plain content" }),
    );
    const tool = createFetchTool({ fetch: fetchMock });

    const result = await tool.execute(
      "tool-call",
      { url: "https://example.com" },
      undefined,
      undefined,
      context,
    );

    expect(resultText(result)).toBe("Plain content");
  });

  it("saves the full text to a temp file when truncated", async () => {
    const content = Array.from({ length: 2001 }, (_, index) => `line ${index + 1}`).join("\n");
    const fetchMock = createFetchMock(async () => jsonResponse({ title: "Big", content }));
    const tool = createFetchTool({ fetch: fetchMock });

    const result = await tool.execute(
      "tool-call",
      { url: "https://example.com/big" },
      undefined,
      undefined,
      context,
    );

    const details = result.details as FetchToolDetails;
    expect(details.truncated).toBe(true);
    expect(details.fullContentPath).toBeTruthy();
    expect(resultText(result)).toContain("[Output truncated:");
    expect(resultText(result)).toContain(`Full content saved to: ${details.fullContentPath}]`);

    const path = details.fullContentPath!;
    try {
      expect(await readFile(path, "utf8")).toBe(`# Big\n\n${content}`);
    } finally {
      await rm(dirname(path), { recursive: true, force: true });
    }

    const structured = result.structuredContent as {
      url: string;
      title: string;
      content: string;
      truncated: boolean;
      full_content_path: string | null;
    };
    expect(structured.content).toBe(content);
    expect(structured.truncated).toBe(true);
    expect(structured.full_content_path).toBe(path);
    expect(Value.Check(FetchOutput, structured)).toBe(true);
  });

  it("fails before fetch when credentials are missing", async () => {
    const fetchMock = createFetchMock(async () =>
      jsonResponse({ title: "Example", content: "body" }),
    );
    const tool = createFetchTool({ fetch: fetchMock });
    const missingCredentials = createToolContext(
      createModelRegistry({ getApiKeyForProvider: async () => undefined }),
    );

    await expect(
      tool.execute(
        "tool-call",
        { url: "https://example.com" },
        undefined,
        undefined,
        missingCredentials,
      ),
    ).rejects.toThrow(
      "DeepSeek credentials are not configured. Run /login deepseek in Pi, or set DEEPSEEK_API_KEY.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails before fetch when the provider base URL is not official", async () => {
    const fetchMock = createFetchMock(async () =>
      jsonResponse({ title: "Example", content: "body" }),
    );
    const tool = createFetchTool({ fetch: fetchMock });
    const unsafeProvider = createToolContext(
      createModelRegistry({ getProvider: () => ({ baseUrl: "https://example.com" }) }),
    );

    await expect(
      tool.execute(
        "tool-call",
        { url: "https://example.com" },
        undefined,
        undefined,
        unsafeProvider,
      ),
    ).rejects.toThrow(
      "Refusing to send DeepSeek credentials because the deepseek provider base URL is not https://api.deepseek.com.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("propagates HTTP errors", async () => {
    const fetchMock = createFetchMock(async () =>
      jsonResponse({ error: { message: "no usable content" } }, { status: 404 }),
    );
    const tool = createFetchTool({ fetch: fetchMock });

    await expect(
      tool.execute(
        "tool-call",
        { url: "https://example.com/missing" },
        undefined,
        undefined,
        context,
      ),
    ).rejects.toThrow("DeepSeek Fetch failed with HTTP 404: no usable content");
  });
});
