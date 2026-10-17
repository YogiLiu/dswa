import { describe, expect, it } from "vitest";
import dswa from "../extensions/dswa.ts";

describe("dswa extension", () => {
  it("exports an extension factory", () => {
    expect(typeof dswa).toBe("function");
  });
});
