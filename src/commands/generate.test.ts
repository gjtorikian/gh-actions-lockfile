import { describe, expect, test, beforeAll, afterAll, beforeEach, afterEach, mock } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generate } from "./generate.js";

// Mock fetch to avoid real GitHub API calls
const originalFetch = globalThis.fetch;

function setupMockFetch() {
  const sha = "b4ffde65f46336ab88eb53be808477a3936bae11";
  const mockFetch = mock((url: string) => {
    // Mock tag resolution
    if (url.includes("/git/refs/tags/")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            ref: "refs/tags/v4",
            object: { sha, type: "commit" },
          }),
          { status: 200 }
        )
      );
    }
    // Mock tarball download
    if (url.includes("/tarball/")) {
      return Promise.resolve(
        new Response(new Uint8Array([1, 2, 3, 4, 5]), { status: 200 })
      );
    }
    // Mock action.yml fetch
    if (url.includes("/contents/action.yml")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            download_url: "https://raw.githubusercontent.com/test/action.yml",
          }),
          { status: 200 }
        )
      );
    }
    if (url.includes("raw.githubusercontent.com")) {
      return Promise.resolve(
        new Response("name: Test\nruns:\n  using: node20\n  main: index.js", {
          status: 200,
        })
      );
    }
    return Promise.resolve(new Response(null, { status: 404 }));
  });
  globalThis.fetch = mockFetch as unknown as typeof fetch;
  return mockFetch;
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

// Suppress console.log during tests
const originalLog = console.log;

describe("generate command", () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "generate-test-"));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true });
  });

  beforeEach(() => {
    setupMockFetch();
    console.log = () => {};
  });

  afterEach(() => {
    restoreFetch();
    console.log = originalLog;
  });

  test("creates lockfile from workflows", async () => {
    // Create workflow directory structure
    const workflowDir = join(tempDir, "test1", ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      join(workflowDir, "ci.yml"),
      `name: CI
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
`
    );

    const outputPath = join(tempDir, "test1", ".github", "workflows", "actions.lock.json");

    await generate({
      workflows: workflowDir,
      output: outputPath,
      token: "test-token",
    });

    // Verify lockfile was created
    const content = await readFile(outputPath, "utf-8");
    const lockfile = JSON.parse(content);

    expect(lockfile.version).toBe(1);
    expect(lockfile.actions["actions/checkout"]).toBeDefined();
    expect(lockfile.actions["actions/checkout"].version).toBe("v4");
  });

  test("throws if no workflow files found", async () => {
    // Create empty workflow directory
    const emptyDir = join(tempDir, "empty-workflows");
    await mkdir(emptyDir, { recursive: true });

    await expect(
      generate({
        workflows: emptyDir,
        output: join(tempDir, "output.json"),
        token: "test-token",
      })
    ).rejects.toThrow("No workflow files found");
  });

  test("returns early if no action references found", async () => {
    // Create workflow with no actions
    const workflowDir = join(tempDir, "no-actions", ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });
    await writeFile(
      join(workflowDir, "script.yml"),
      `name: Script Only
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo "Hello"
`
    );

    const outputPath = join(tempDir, "no-actions", "output.json");

    // Should not throw, just return early
    await generate({
      workflows: workflowDir,
      output: outputPath,
      token: "test-token",
    });

    // No lockfile should be created (early return before writing)
    const exists = await Bun.file(outputPath).exists();
    expect(exists).toBe(false);
  });

  test("handles multiple workflows", async () => {
    // Create multiple workflow files
    const workflowDir = join(tempDir, "multi", ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });

    await writeFile(
      join(workflowDir, "ci.yml"),
      `name: CI
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
`
    );

    await writeFile(
      join(workflowDir, "deploy.yml"),
      `name: Deploy
on: push
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
`
    );

    const outputPath = join(tempDir, "multi", ".github", "workflows", "actions.lock.json");

    await generate({
      workflows: workflowDir,
      output: outputPath,
      token: "test-token",
    });

    const content = await readFile(outputPath, "utf-8");
    const lockfile = JSON.parse(content);

    // Should have both unique actions
    expect(lockfile.actions["actions/checkout"]).toBeDefined();
    expect(lockfile.actions["actions/setup-node"]).toBeDefined();
  });

  test("handles relative output paths", async () => {
    // Create workflow directory with proper structure
    const repoRoot = join(tempDir, "relative-test");
    const workflowDir = join(repoRoot, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });

    await writeFile(
      join(workflowDir, "ci.yml"),
      `name: CI
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
`
    );

    // Use default relative output path
    await generate({
      workflows: workflowDir,
      output: ".github/workflows/actions.lock.json",
      token: "test-token",
    });

    // Lockfile should be created relative to repo root
    const outputPath = join(repoRoot, ".github", "workflows", "actions.lock.json");
    const content = await readFile(outputPath, "utf-8");
    const lockfile = JSON.parse(content);

    expect(lockfile.version).toBe(1);
  });
});
