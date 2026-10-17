import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import dswa from "../extensions/index.ts";

type CapturedTool = Record<string, unknown>;

function registerTools(): CapturedTool[] {
  const tools: CapturedTool[] = [];
  const pi = {
    registerTool: (tool: CapturedTool) => {
      tools.push(tool);
    },
  } as unknown as ExtensionAPI;

  dswa(pi);
  return tools;
}

describe("dswa extension", () => {
  it("exports an extension factory", () => {
    expect(typeof dswa).toBe("function");
  });

  it("registers exactly the two DeepSeek tools", () => {
    expect(registerTools().map((tool) => tool.name)).toEqual(["deepseek_search", "deepseek_fetch"]);
  });

  it("marks both tools read-only, non-destructive, and open-world", () => {
    for (const tool of registerTools()) {
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      });
      expect(tool.parameters).toBeDefined();
      expect(tool.outputSchema).toBeDefined();
      expect(tool.promptSnippet).toBeTruthy();
      expect(tool.promptGuidelines).toBeInstanceOf(Array);
      expect((tool.promptGuidelines as string[]).length).toBeGreaterThan(0);
    }
  });
});
