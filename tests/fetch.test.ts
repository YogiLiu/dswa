import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Value } from "typebox/value";
import {
  createFetchTool,
  FetchOutput,
  type FetchToolDetails,
  validateFetchUrl,
} from "../src/fetch.ts";
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

const context = createToolContext(createModelRegistry());

let root: string;

beforeEach(async () => {
  root = await createTempRoot();
});

afterEach(async () => {
  await removeTempRoot(root);
});

function createTool(fetchMock: ReturnType<typeof createFetchMock>) {
  return createFetchTool({
    fetch: fetchMock,
    tempFilesFactory: () => createTempFiles({ root }),
  });
}

function execute(tool: ReturnType<typeof createFetchTool>, url: string) {
  return tool.execute("tool-call", { url }, undefined, undefined, context);
}

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
  it("writes the full page and returns metadata, headings, and a complete preview", async () => {
    const content = "# Intro\n\nBody\n\n## API\n\nMore";
    const fullText = `# Example\n\n${content}`;
    const fetchMock = createFetchMock(async () => jsonResponse({ title: "Example", content }));
    const tool = createTool(fetchMock);

    const result = await execute(tool, "https://example.com");
    const text = resultText(result);
    const details = result.details as FetchToolDetails;
    const path = details.fullContentPath!;

    expect(requestBody(fetchMock)).toEqual({ url: "https://example.com/" });
    expect(text).toContain('Fetched "Example" from https://example.com/');
    expect(text).toContain(`Markdown: \`${path}\``);
    expect(text).toContain("Size: ");
    expect(text).toContain("9 lines");
    expect(text).toContain("- # Example (line 1)");
    expect(text).toContain("- # Intro (line 3)");
    expect(text).toContain("- ## API (line 7)");
    expect(text).toContain("Content (complete page, 9 lines):");
    expect(text).toContain(
      "[The preview above is the complete page; the Markdown file is available if needed.]",
    );
    expect(details).toEqual({
      url: "https://example.com/",
      title: "Example",
      truncated: false,
      fullContentPath: path,
      bytes: Buffer.byteLength(fullText, "utf8"),
      lines: 9,
      headingCount: 3,
      headingsTruncated: false,
    });
    expect(result.structuredContent).toEqual({
      url: "https://example.com/",
      title: "Example",
      content,
      truncated: false,
      full_content_path: path,
      bytes: Buffer.byteLength(fullText, "utf8"),
      lines: 9,
      headings: [
        { level: 1, text: "Example", line: 1 },
        { level: 1, text: "Intro", line: 3 },
        { level: 2, text: "API", line: 7 },
      ],
      headings_truncated: false,
    });
    expect(Value.Check(FetchOutput, result.structuredContent)).toBe(true);
    expect(await readFile(path, "utf8")).toBe(fullText);
  });

  it("omits the heading when the page title is empty", async () => {
    const fetchMock = createFetchMock(async () =>
      jsonResponse({ title: "", content: "Plain content" }),
    );
    const tool = createTool(fetchMock);

    const result = await execute(tool, "https://example.com");
    const text = resultText(result);
    const details = result.details as FetchToolDetails;

    expect(text).toContain("Fetched page from https://example.com/");
    expect(text).toContain("Content (complete page, 1 line):");
    expect(text).not.toContain("Headings:");
    expect(details).toMatchObject({
      title: "",
      truncated: false,
      lines: 1,
      headingCount: 0,
      headingsTruncated: false,
    });
    expect(result.structuredContent).toMatchObject({ headings: [], lines: 1 });
    expect(Value.Check(FetchOutput, result.structuredContent)).toBe(true);
    expect(await readFile(details.fullContentPath!, "utf8")).toBe("Plain content");
  });

  it("limits a long page preview and reports omitted headings", async () => {
    const content = Array.from({ length: 25 }, (_, index) => `# H${index}`).join("\n");
    const fullText = `# Long\n\n${content}`;
    const fetchMock = createFetchMock(async () => jsonResponse({ title: "Long", content }));
    const tool = createTool(fetchMock);

    const result = await execute(tool, "https://example.com/long");
    const text = resultText(result);
    const details = result.details as FetchToolDetails;

    expect(text).toContain("Headings:");
    expect(text).toContain("- ... more headings omitted");
    expect(text).toContain("Preview (first 20 of 27 lines):");
    expect(text).toContain(
      "[Preview only. Use read with offset/limit or grep on the Markdown file; do not read the entire page unless necessary.]",
    );
    expect(details).toMatchObject({
      truncated: true,
      lines: 27,
      headingCount: 20,
      headingsTruncated: true,
    });
    const structured = result.structuredContent as {
      headings: unknown[];
      headings_truncated: boolean;
    };
    expect(structured.headings).toHaveLength(20);
    expect(structured.headings_truncated).toBe(true);
    expect(Value.Check(FetchOutput, structured)).toBe(true);
    expect(await readFile(details.fullContentPath!, "utf8")).toBe(fullText);
  });

  it("handles a first line that exceeds the preview limit", async () => {
    const content = "a".repeat(2049);
    const fetchMock = createFetchMock(async () => jsonResponse({ title: "", content }));
    const tool = createTool(fetchMock);

    const result = await execute(tool, "https://example.com/huge");
    const text = resultText(result);
    const details = result.details as FetchToolDetails;

    expect(text).toContain(
      "Preview: the first line is too large for the preview limit; read the Markdown file directly.",
    );
    expect(text).toContain("[Preview only.");
    expect(details).toMatchObject({ truncated: true, lines: 1, headingCount: 0 });
    expect(Value.Check(FetchOutput, result.structuredContent)).toBe(true);
    expect(await readFile(details.fullContentPath!, "utf8")).toBe(content);
  });

  it("handles an empty page", async () => {
    const fetchMock = createFetchMock(async () => jsonResponse({ title: "", content: "" }));
    const tool = createTool(fetchMock);

    const result = await execute(tool, "https://example.com/empty");
    const text = resultText(result);
    const details = result.details as FetchToolDetails;

    expect(text).toContain("The page returned no content.");
    expect(details).toMatchObject({
      truncated: false,
      bytes: 0,
      lines: 0,
      headingCount: 0,
      headingsTruncated: false,
    });
    expect(Value.Check(FetchOutput, result.structuredContent)).toBe(true);
    expect(await readFile(details.fullContentPath!, "utf8")).toBe("");
  });

  it("uses the platform temp directory by default", async () => {
    const fetchMock = createFetchMock(async () =>
      jsonResponse({ title: "Example", content: "Body" }),
    );
    const tool = createFetchTool({ fetch: fetchMock });

    const result = await execute(tool, "https://example.com");
    const details = result.details as FetchToolDetails;

    try {
      expect(dirname(details.fullContentPath!).startsWith(tmpdir())).toBe(true);
      expect(await readFile(details.fullContentPath!, "utf8")).toBe("# Example\n\nBody");
    } finally {
      if (details.fullContentPath) {
        await rm(dirname(details.fullContentPath), { recursive: true, force: true });
      }
    }
  });

  it("falls back to inline content when writing fails", async () => {
    const content = "Body";
    const fullText = `# Example\n\n${content}`;
    const fetchMock = createFetchMock(async () => jsonResponse({ title: "Example", content }));
    const tool = createFetchTool({
      fetch: fetchMock,
      tempFilesFactory: () => ({
        write: async () => {
          throw new Error("disk full");
        },
      }),
    });

    const result = await execute(tool, "https://example.com");
    const text = resultText(result);
    const details = result.details as FetchToolDetails;

    expect(text).toContain(
      "[Could not save the full page to a temporary file: disk full. Showing inline content instead.]",
    );
    expect(text).toContain(fullText);
    expect(text).not.toContain("[Output truncated:");
    expect(details).toMatchObject({
      truncated: false,
      fullContentPath: null,
      bytes: Buffer.byteLength(fullText, "utf8"),
      lines: 3,
    });
    expect(result.structuredContent).toMatchObject({ full_content_path: null, content });
    expect(Value.Check(FetchOutput, result.structuredContent)).toBe(true);
  });

  it("truncates inline content when writing fails and the page is large", async () => {
    const content = Array.from({ length: 2100 }, (_, index) => `line ${index + 1}`).join("\n");
    const fullText = `# Example\n\n${content}`;
    const fetchMock = createFetchMock(async () => jsonResponse({ title: "Example", content }));
    const tool = createFetchTool({
      fetch: fetchMock,
      tempFilesFactory: () => ({
        write: async () => {
          throw new Error("disk full");
        },
      }),
    });

    const result = await execute(tool, "https://example.com");
    const text = resultText(result);
    const details = result.details as FetchToolDetails;

    expect(text).toContain(
      "[Could not save the full page to a temporary file: disk full. Showing inline content instead.]",
    );
    expect(text).toContain("[Output truncated:");
    expect(text).toContain("The full page could not be saved; only the text above is available.");
    expect(details).toMatchObject({
      truncated: true,
      fullContentPath: null,
      bytes: Buffer.byteLength(fullText, "utf8"),
      lines: 2102,
    });
    expect(Value.Check(FetchOutput, result.structuredContent)).toBe(true);
  });

  it.each([
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
  ])("uses the fallback error message for $name", async ({ factory, message }) => {
    const fetchMock = createFetchMock(async () =>
      jsonResponse({ title: "Example", content: "Body" }),
    );
    const tool = createFetchTool({
      fetch: fetchMock,
      tempFilesFactory: factory as () => TempFiles,
    });

    const result = await execute(tool, "https://example.com");

    expect(resultText(result)).toContain(
      `[Could not save the full page to a temporary file: ${message}. Showing inline content instead.]`,
    );
  });

  it("fails before fetch when credentials are missing", async () => {
    const fetchMock = createFetchMock(async () =>
      jsonResponse({ title: "Example", content: "body" }),
    );
    const tool = createTool(fetchMock);
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
    const tool = createTool(fetchMock);
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
    const tool = createTool(fetchMock);

    await expect(execute(tool, "https://example.com/missing")).rejects.toThrow(
      "DeepSeek Fetch failed with HTTP 404: no usable content",
    );
  });
});
