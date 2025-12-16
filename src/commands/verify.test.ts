import { describe, expect, test, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { verifyCommand } from "./verify.js";
import { copyFixtures } from "../__fixtures__/helpers.js";

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

    await copyFixtures(
      [
        ["verify/workflow-match.yml", "ci.yml"],
        ["verify/lockfile-match.json", "actions.lock.json"],
      ],
      workflowDir
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
    await copyFixtures(
      [
        ["verify/workflow-mismatch-v5.yml", "ci.yml"],
        ["verify/lockfile-mismatch-v4.json", "actions.lock.json"],
      ],
      workflowDir
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

    await copyFixtures(
      [["verify/workflow-match.yml", "ci.yml"]],
      workflowDir
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

    // Workflow has checkout AND setup-node, but lockfile only has checkout
    await copyFixtures(
      [
        ["verify/workflow-new-actions.yml", "ci.yml"],
        ["verify/lockfile-new-actions.json", "actions.lock.json"],
      ],
      workflowDir
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

    // Workflow only has checkout, but lockfile has both checkout AND setup-node
    await copyFixtures(
      [
        ["verify/workflow-removed-actions.yml", "ci.yml"],
        ["verify/lockfile-removed-actions.json", "actions.lock.json"],
      ],
      workflowDir
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
