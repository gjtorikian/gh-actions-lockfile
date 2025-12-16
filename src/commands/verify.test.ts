import { describe, expect, test, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { verifyCommand } from "./verify.js";

// Suppress console.log during tests
const originalLog = console.log;
const originalExit = process.exit;

describe("verifyCommand", () => {
  let tempDir: string;
  let exitCode: number | undefined;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "verify-test-"));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true });
  });

  beforeEach(() => {
    console.log = () => {};
    exitCode = undefined;
    // Mock process.exit to capture exit code
    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error(`process.exit(${code})`);
    }) as typeof process.exit;
  });

  afterEach(() => {
    console.log = originalLog;
    process.exit = originalExit;
  });

  test("completes successfully when workflows match lockfile", async () => {
    // Create matching workflow and lockfile
    const testDir = join(tempDir, "match");
    const workflowDir = join(testDir, ".github", "workflows");
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
      join(workflowDir, "actions.lock.json"),
      JSON.stringify(
        {
          version: 1,
          generated: "2024-01-15T10:30:00.000Z",
          actions: {
            "actions/checkout": [
              {
                version: "v4",
                sha: "b4ffde65f46336ab88eb53be808477a3936bae11",
                integrity: "sha256-abc123",
                dependencies: [],
              },
            ],
          },
        },
        null,
        2
      )
    );

    // Should complete without throwing
    await verifyCommand({
      workflows: workflowDir,
      output: join(workflowDir, "actions.lock.json"),
    });

    // No exit code should be set (success)
    expect(exitCode).toBeUndefined();
  });

  test("calls process.exit(1) when mismatch detected", async () => {
    // Create mismatched workflow and lockfile
    const testDir = join(tempDir, "mismatch");
    const workflowDir = join(testDir, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });

    // Workflow uses v5 but lockfile has v4
    await writeFile(
      join(workflowDir, "ci.yml"),
      `name: CI
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
`
    );

    await writeFile(
      join(workflowDir, "actions.lock.json"),
      JSON.stringify(
        {
          version: 1,
          generated: "2024-01-15T10:30:00.000Z",
          actions: {
            "actions/checkout": [
              {
                version: "v4",
                sha: "b4ffde65f46336ab88eb53be808477a3936bae11",
                integrity: "sha256-abc123",
                dependencies: [],
              },
            ],
          },
        },
        null,
        2
      )
    );

    // Should call process.exit(1)
    try {
      await verifyCommand({
        workflows: workflowDir,
        output: join(workflowDir, "actions.lock.json"),
      });
    } catch (e: unknown) {
      // Expected due to mocked process.exit
      expect((e as Error).message).toBe("process.exit(1)");
    }

    expect(exitCode).toBe(1);
  });

  test("throws if lockfile not found", async () => {
    // Create workflow but no lockfile
    const testDir = join(tempDir, "no-lockfile");
    const workflowDir = join(testDir, ".github", "workflows");
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

    await expect(
      verifyCommand({
        workflows: workflowDir,
        output: join(workflowDir, "actions.lock.json"),
      })
    ).rejects.toThrow("Lockfile not found");
  });

  test("detects new actions", async () => {
    const testDir = join(tempDir, "new-actions");
    const workflowDir = join(testDir, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });

    // Workflow has checkout AND setup-node
    await writeFile(
      join(workflowDir, "ci.yml"),
      `name: CI
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
`
    );

    // Lockfile only has checkout
    await writeFile(
      join(workflowDir, "actions.lock.json"),
      JSON.stringify(
        {
          version: 1,
          generated: "2024-01-15T10:30:00.000Z",
          actions: {
            "actions/checkout": [
              {
                version: "v4",
                sha: "abc123",
                integrity: "sha256-xyz",
                dependencies: [],
              },
            ],
          },
        },
        null,
        2
      )
    );

    try {
      await verifyCommand({
        workflows: workflowDir,
        output: join(workflowDir, "actions.lock.json"),
      });
    } catch {
      // Expected
    }

    expect(exitCode).toBe(1);
  });

  test("detects removed actions", async () => {
    const testDir = join(tempDir, "removed-actions");
    const workflowDir = join(testDir, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });

    // Workflow only has checkout
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

    // Lockfile has both checkout AND setup-node
    await writeFile(
      join(workflowDir, "actions.lock.json"),
      JSON.stringify(
        {
          version: 1,
          generated: "2024-01-15T10:30:00.000Z",
          actions: {
            "actions/checkout": [
              {
                version: "v4",
                sha: "abc123",
                integrity: "sha256-xyz",
                dependencies: [],
              },
            ],
            "actions/setup-node": [
              {
                version: "v4",
                sha: "def456",
                integrity: "sha256-abc",
                dependencies: [],
              },
            ],
          },
        },
        null,
        2
      )
    );

    try {
      await verifyCommand({
        workflows: workflowDir,
        output: join(workflowDir, "actions.lock.json"),
      });
    } catch {
      // Expected
    }

    expect(exitCode).toBe(1);
  });
});
