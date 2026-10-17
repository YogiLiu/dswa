import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
    expect(dirname(first).startsWith(root)).toBe(true);
    expect(await readFile(first, "utf8")).toBe("first");
    expect(await readFile(second, "utf8")).toBe("{}");
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
      expect(path.startsWith(tmpdir())).toBe(true);
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
