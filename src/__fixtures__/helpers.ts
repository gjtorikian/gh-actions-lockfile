import { copyFile, mkdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Base path for fixtures
const __dirname = dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = __dirname;

/**
 * Copy a fixture file to a target directory
 * @param fixturePath - Relative path from __fixtures__ (e.g., "verify/workflow-match.yml")
 * @param targetPath - Absolute path where fixture should be copied
 */
export async function copyFixture(
  fixturePath: string,
  targetPath: string
): Promise<void> {
  const sourcePath = join(FIXTURES_DIR, fixturePath);
  await mkdir(dirname(targetPath), { recursive: true });
  await copyFile(sourcePath, targetPath);
}

/**
 * Copy multiple fixtures to a target directory
 * @param fixtures - Array of [fixturePath, targetFileName] tuples
 * @param targetDir - Target directory (will be created if needed)
 */
export async function copyFixtures(
  fixtures: Array<[string, string]>,
  targetDir: string
): Promise<void> {
  await mkdir(targetDir, { recursive: true });
  await Promise.all(
    fixtures.map(([fixturePath, targetFileName]) =>
      copyFixture(fixturePath, join(targetDir, targetFileName))
    )
  );
}

/**
 * Read a fixture file as a string
 * @param fixturePath - Relative path from __fixtures__
 */
export async function readFixture(fixturePath: string): Promise<string> {
  const sourcePath = join(FIXTURES_DIR, fixturePath);
  return readFile(sourcePath, "utf-8");
}

/**
 * Read a JSON fixture and parse it
 * @param fixturePath - Relative path from __fixtures__
 */
export async function readJsonFixture<T>(fixturePath: string): Promise<T> {
  const content = await readFixture(fixturePath);
  return JSON.parse(content) as T;
}
