import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTempFiles } from "../src/temp.ts";

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi-dswa-test-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("createTempFiles", () => {
  it("writes multiple files into one private per-call directory", async () => {
    const root = await makeRoot();
    const files = createTempFiles({ root });

    const first = await files.write("1.md", "first");
    const second = await files.write("results.json", "{}");

    expect(dirname(first)).toBe(dirname(second));
    expect(dirname(first)).toBe(join(root, "pi-dswa", basename(dirname(first))));
    expect(basename(dirname(first)).startsWith("call-")).toBe(true);
    expect(await readFile(first, "utf8")).toBe("first");
    expect(await readFile(second, "utf8")).toBe("{}");
  });

  it("groups directories from separate calls under one shared parent", async () => {
    const root = await makeRoot();

    const first = await createTempFiles({ root }).write("1.md", "first");
    const second = await createTempFiles({ root }).write("1.md", "second");

    expect(dirname(first)).not.toBe(dirname(second));
    expect(dirname(dirname(first))).toBe(join(root, "pi-dswa"));
    expect(dirname(dirname(second))).toBe(join(root, "pi-dswa"));
  });

  it.skipIf(process.platform === "win32")("creates files with user-only permissions", async () => {
    const files = createTempFiles({ root: await makeRoot() });
    const path = await files.write("1.md", "body");
    const info = await stat(path);

    expect(info.mode & 0o077).toBe(0);
  });

  it("uses the platform temp directory by default", async () => {
    const files = createTempFiles();

    const path = await files.write("page.md", "body");
    try {
      expect(dirname(dirname(path))).toBe(join(tmpdir(), "pi-dswa"));
      expect(await readFile(path, "utf8")).toBe("body");
    } finally {
      await rm(dirname(path), { recursive: true, force: true });
    }
  });

  it.each(["../escape.md", "UPPER.md", "file.txt", "nested/page.md"])(
    "rejects unsafe file name %s",
    async (name) => {
      const files = createTempFiles({ root: await makeRoot() });

      await expect(files.write(name, "body")).rejects.toThrow(
        `Invalid temporary file name: ${name}`,
      );
    },
  );
});
