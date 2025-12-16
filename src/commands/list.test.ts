import { describe, expect, test, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { list } from "./list.js";

describe("list command", () => {
  let tempDir: string;
  let consoleLogs: string[];
  const originalLog = console.log;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "list-test-"));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true });
  });

  beforeEach(() => {
    consoleLogs = [];
    console.log = (...args: unknown[]) => {
      consoleLogs.push(args.map(String).join(" "));
    };
  });

  afterEach(() => {
    console.log = originalLog;
  });

  test("prints dependency tree", async () => {
    const testDir = join(tempDir, "tree");
    const workflowDir = join(testDir, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });

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
            "actions/setup-node": [
              {
                version: "v4",
                sha: "60edb5dd545a775178f52524783378180af0d1f8",
                integrity: "sha256-xyz789",
                dependencies: [],
              },
            ],
          },
        },
        null,
        2
      )
    );

    await list({
      workflows: workflowDir,
      output: join(workflowDir, "actions.lock.json"),
    });

    // Should print header with timestamp
    expect(consoleLogs.some((log) => log.includes("actions.lock.json"))).toBe(true);

    // Should print both actions
    expect(
      consoleLogs.some((log) => log.includes("actions/checkout@v4"))
    ).toBe(true);
    expect(
      consoleLogs.some((log) => log.includes("actions/setup-node@v4"))
    ).toBe(true);
  });

  test("shows top-level actions (not transitive deps)", async () => {
    const testDir = join(tempDir, "top-level");
    const workflowDir = join(testDir, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });

    // Lockfile where checkout is a transitive dep of composite-action
    await writeFile(
      join(workflowDir, "actions.lock.json"),
      JSON.stringify(
        {
          version: 1,
          generated: "2024-01-15T10:30:00.000Z",
          actions: {
            "owner/composite-action": [
              {
                version: "v1",
                sha: "1111111111111111111111111111111111111111",
                integrity: "sha256-composite",
                dependencies: [
                  {
                    ref: "actions/checkout@v4",
                    sha: "b4ffde65f46336ab88eb53be808477a3936bae11",
                    integrity: "sha256-abc123",
                  },
                ],
              },
            ],
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

    await list({
      workflows: workflowDir,
      output: join(workflowDir, "actions.lock.json"),
    });

    // composite-action should be at root level with checkout nested underneath
    // The tree should show owner/composite-action first, then checkout as nested
    const compositeIndex = consoleLogs.findIndex((log) =>
      log.includes("owner/composite-action@v1")
    );
    const checkoutIndex = consoleLogs.findIndex((log) =>
      log.includes("actions/checkout@v4")
    );

    expect(compositeIndex).toBeGreaterThanOrEqual(0);
    expect(checkoutIndex).toBeGreaterThan(compositeIndex);
  });

  test("formats tree with proper ASCII indentation", async () => {
    const testDir = join(tempDir, "indentation");
    const workflowDir = join(testDir, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });

    await writeFile(
      join(workflowDir, "actions.lock.json"),
      JSON.stringify(
        {
          version: 1,
          generated: "2024-01-15T10:30:00.000Z",
          actions: {
            "owner/composite": [
              {
                version: "v1",
                sha: "1111111111111111111111111111111111111111",
                integrity: "sha256-comp",
                dependencies: [
                  {
                    ref: "actions/checkout@v4",
                    sha: "abc123",
                    integrity: "sha256-abc",
                  },
                ],
              },
            ],
            "actions/checkout": [
              {
                version: "v4",
                sha: "abc123def456abc123def456abc123def456abc1",
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

    await list({
      workflows: workflowDir,
      output: join(workflowDir, "actions.lock.json"),
    });

    // Should use tree characters
    const hasTreeChars = consoleLogs.some(
      (log) => log.includes("├──") || log.includes("└──")
    );
    expect(hasTreeChars).toBe(true);
  });

  test("shows SHA and version for each action", async () => {
    const testDir = join(tempDir, "sha-version");
    const workflowDir = join(testDir, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });

    const sha = "b4ffde65f46336ab88eb53be808477a3936bae11";
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
                sha,
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

    await list({
      workflows: workflowDir,
      output: join(workflowDir, "actions.lock.json"),
    });

    // Should show version
    expect(consoleLogs.some((log) => log.includes("@v4"))).toBe(true);

    // Should show truncated SHA (12 chars)
    const shortSha = sha.slice(0, 12);
    expect(consoleLogs.some((log) => log.includes(shortSha))).toBe(true);
  });

  test("throws if lockfile not found", async () => {
    const testDir = join(tempDir, "no-lockfile");
    const workflowDir = join(testDir, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });

    await expect(
      list({
        workflows: workflowDir,
        output: join(workflowDir, "actions.lock.json"),
      })
    ).rejects.toThrow("Lockfile not found");
  });

  test("handles empty lockfile", async () => {
    const testDir = join(tempDir, "empty");
    const workflowDir = join(testDir, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });

    await writeFile(
      join(workflowDir, "actions.lock.json"),
      JSON.stringify(
        {
          version: 1,
          generated: "2024-01-15T10:30:00.000Z",
          actions: {},
        },
        null,
        2
      )
    );

    await list({
      workflows: workflowDir,
      output: join(workflowDir, "actions.lock.json"),
    });

    // Should print header but no actions
    expect(consoleLogs.some((log) => log.includes("actions.lock.json"))).toBe(true);
  });

  test("displays multiple versions of the same action", async () => {
    const testDir = join(tempDir, "multi-version");
    const workflowDir = join(testDir, ".github", "workflows");
    await mkdir(workflowDir, { recursive: true });

    await writeFile(
      join(workflowDir, "actions.lock.json"),
      JSON.stringify(
        {
          version: 1,
          generated: "2024-01-15T10:30:00.000Z",
          actions: {
            "actions/checkout": [
              {
                version: "v3",
                sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                integrity: "sha256-v3hash",
                dependencies: [],
              },
              {
                version: "v4",
                sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                integrity: "sha256-v4hash",
                dependencies: [],
              },
            ],
          },
        },
        null,
        2
      )
    );

    await list({
      workflows: workflowDir,
      output: join(workflowDir, "actions.lock.json"),
    });

    // Should display both versions
    expect(
      consoleLogs.some((log) => log.includes("actions/checkout@v3"))
    ).toBe(true);
    expect(
      consoleLogs.some((log) => log.includes("actions/checkout@v4"))
    ).toBe(true);
  });
});
