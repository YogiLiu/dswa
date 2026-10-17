import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import dswa from "../extensions/dswa.ts";

describe("dswa extension", () => {
  it("exports an extension factory", () => {
    expect(typeof dswa).toBe("function");
  });

  it("initializes without throwing", () => {
    const pi = {} as ExtensionAPI;

    expect(() => dswa(pi)).not.toThrow();
  });
});
