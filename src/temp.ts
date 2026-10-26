import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DswaError } from "./errors.ts";

const TEMP_DIRECTORY_NAME = "pi-dswa";
const CALL_DIRECTORY_PREFIX = "call-";
const SAFE_FILE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*\.(?:json|md)$/;

/** A lazy, per-tool-call directory for temporary artifacts. */
export type TempFiles = {
  write(name: string, content: string): Promise<string>;
};

/** Options for creating a temporary artifact workspace. */
export type TempFilesOptions = {
  /** Parent directory. Defaults to the platform temp directory. */
  root?: string;
};

/**
 * Create a workspace for model-readable temporary files.
 *
 * The directory is created on the first write so failed API requests leave no files behind. Using
 * `os.tmpdir()` keeps the location portable across Linux, macOS, and Windows. Every per-call
 * directory lives under one shared `pi-dswa` parent so the platform temp directory does not fill up
 * with loose entries; the random directory name and ASCII-only file names avoid collisions and
 * Windows path restrictions.
 */
export function createTempFiles(options: TempFilesOptions = {}): TempFiles {
  let directory: string | undefined;

  return {
    async write(name, content) {
      if (!SAFE_FILE_NAME.test(name)) {
        throw new DswaError(`Invalid temporary file name: ${name}`);
      }

      const parent = join(options.root ?? tmpdir(), TEMP_DIRECTORY_NAME);
      directory ??= await createCallDirectory(parent);
      const path = join(directory, name);
      await writeFile(path, content, { encoding: "utf8", mode: 0o600 });
      return path;
    },
  };
}

/** Create one private per-call directory inside the shared parent. */
async function createCallDirectory(parent: string): Promise<string> {
  await mkdir(parent, { recursive: true, mode: 0o700 });
  return mkdtemp(join(parent, CALL_DIRECTORY_PREFIX));
}
