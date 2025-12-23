import { describe, expect, test, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { verifyCommand, verifyShas, verifyIntegrity } from "./verify.js";
import { copyFixtures } from "../__fixtures__/helpers.js";
import { GitHubClient } from "../github/client.js";
import type { Lockfile } from "../types.js";

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
    console.log = () => { };
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
      skipSha: true,
      skipIntegrity: true,
      skipAdvisories: true,
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
        skipSha: true,
        skipIntegrity: true,
        skipAdvisories: true,
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
        skipSha: true,
        skipIntegrity: true,
        skipAdvisories: true,
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
        skipSha: true,
        skipIntegrity: true,
        skipAdvisories: true,
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
        skipSha: true,
        skipIntegrity: true,
        skipAdvisories: true,
      });
    } catch {
      // Expected
    }

    expect(exitCode).toBe(1);
  });
});

describe("verifyShas", () => {
  const originalLog = console.log;

  beforeEach(() => {
    console.log = () => { };
  });

  afterEach(() => {
    console.log = originalLog;
  });

  test("passes when all SHAs match", async () => {
    const lockfile: Lockfile = {
      version: 1,
      generated: new Date().toISOString(),
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
    };

    const mockClient = {
      resolveRef: vi.fn().mockResolvedValue("b4ffde65f46336ab88eb53be808477a3936bae11"),
    } as unknown as GitHubClient;

    const result = await verifyShas(lockfile, mockClient);

    expect(result.passed).toBe(true);
    expect(result.checked).toBe(1);
    expect(result.failures).toHaveLength(0);
    expect(mockClient.resolveRef).toHaveBeenCalledWith("actions", "checkout", "v4");
  });

  test("fails when SHA has changed (tag moved)", async () => {
    const lockfile: Lockfile = {
      version: 1,
      generated: new Date().toISOString(),
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
    };

    const mockClient = {
      resolveRef: vi.fn().mockResolvedValue("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    } as unknown as GitHubClient;

    const result = await verifyShas(lockfile, mockClient);

    expect(result.passed).toBe(false);
    expect(result.checked).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toEqual({
      action: "actions/checkout",
      version: "v4",
      lockfileSha: "b4ffde65f46336ab88eb53be808477a3936bae11",
      remoteSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
  });

  test("checks transitive dependencies", async () => {
    const lockfile: Lockfile = {
      version: 1,
      generated: new Date().toISOString(),
      actions: {
        "actions/checkout": [
          {
            version: "v4",
            sha: "b4ffde65f46336ab88eb53be808477a3936bae11",
            integrity: "sha256-abc123",
            dependencies: [
              {
                ref: "actions/toolkit@v1",
                sha: "cccccccccccccccccccccccccccccccccccccccc",
                integrity: "sha256-dep123",
              },
            ],
          },
        ],
      },
    };

    const mockClient = {
      resolveRef: vi.fn()
        .mockResolvedValueOnce("b4ffde65f46336ab88eb53be808477a3936bae11") // checkout
        .mockResolvedValueOnce("cccccccccccccccccccccccccccccccccccccccc"), // toolkit
    } as unknown as GitHubClient;

    const result = await verifyShas(lockfile, mockClient);

    expect(result.passed).toBe(true);
    expect(result.checked).toBe(2);
    expect(mockClient.resolveRef).toHaveBeenCalledTimes(2);
  });

  test("handles API errors gracefully", async () => {
    const lockfile: Lockfile = {
      version: 1,
      generated: new Date().toISOString(),
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
    };

    const mockClient = {
      resolveRef: vi.fn().mockRejectedValue(new Error("API error")),
    } as unknown as GitHubClient;

    const result = await verifyShas(lockfile, mockClient);

    // Should pass (no failures detected) but with 0 checked
    expect(result.passed).toBe(true);
    expect(result.checked).toBe(0);
    expect(result.failures).toHaveLength(0);
  });
});

describe("verifyIntegrity", () => {
  const originalLog = console.log;

  beforeEach(() => {
    console.log = () => { };
  });

  afterEach(() => {
    console.log = originalLog;
  });

  test("passes when all integrity hashes match", async () => {
    const lockfile: Lockfile = {
      version: 1,
      generated: new Date().toISOString(),
      actions: {
        "actions/checkout": [
          {
            version: "v4",
            sha: "b4ffde65f46336ab88eb53be808477a3936bae11",
            integrity: "sha256-abc123def456",
            dependencies: [],
          },
        ],
      },
    };

    const mockClient = {
      getArchiveSHA256: vi.fn().mockResolvedValue("sha256-abc123def456"),
    } as unknown as GitHubClient;

    const result = await verifyIntegrity(lockfile, mockClient);

    expect(result.passed).toBe(true);
    expect(result.checked).toBe(1);
    expect(result.failures).toHaveLength(0);
    expect(mockClient.getArchiveSHA256).toHaveBeenCalledWith(
      "actions",
      "checkout",
      "b4ffde65f46336ab88eb53be808477a3936bae11"
    );
  });

  test("fails when integrity hash differs", async () => {
    const lockfile: Lockfile = {
      version: 1,
      generated: new Date().toISOString(),
      actions: {
        "actions/checkout": [
          {
            version: "v4",
            sha: "b4ffde65f46336ab88eb53be808477a3936bae11",
            integrity: "sha256-abc123def456",
            dependencies: [],
          },
        ],
      },
    };

    const mockClient = {
      getArchiveSHA256: vi.fn().mockResolvedValue("sha256-DIFFERENT"),
    } as unknown as GitHubClient;

    const result = await verifyIntegrity(lockfile, mockClient);

    expect(result.passed).toBe(false);
    expect(result.checked).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toEqual({
      action: "actions/checkout",
      version: "v4",
      expected: "sha256-abc123def456",
      actual: "sha256-DIFFERENT",
    });
  });

  test("skips actions without integrity hash", async () => {
    const lockfile: Lockfile = {
      version: 1,
      generated: new Date().toISOString(),
      actions: {
        "actions/checkout": [
          {
            version: "v4",
            sha: "b4ffde65f46336ab88eb53be808477a3936bae11",
            integrity: "", // Empty integrity
            dependencies: [],
          },
        ],
      },
    };

    const mockClient = {
      getArchiveSHA256: vi.fn(),
    } as unknown as GitHubClient;

    const result = await verifyIntegrity(lockfile, mockClient);

    expect(result.passed).toBe(true);
    expect(result.checked).toBe(0);
    expect(mockClient.getArchiveSHA256).not.toHaveBeenCalled();
  });

  test("handles API errors gracefully", async () => {
    const lockfile: Lockfile = {
      version: 1,
      generated: new Date().toISOString(),
      actions: {
        "actions/checkout": [
          {
            version: "v4",
            sha: "b4ffde65f46336ab88eb53be808477a3936bae11",
            integrity: "sha256-abc123def456",
            dependencies: [],
          },
        ],
      },
    };

    const mockClient = {
      getArchiveSHA256: vi.fn().mockRejectedValue(new Error("Network error")),
    } as unknown as GitHubClient;

    const result = await verifyIntegrity(lockfile, mockClient);

    // Should pass (no failures detected) but with 0 checked
    expect(result.passed).toBe(true);
    expect(result.checked).toBe(0);
    expect(result.failures).toHaveLength(0);
  });
});
