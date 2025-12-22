import { describe, expect, test, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { list } from "./list.js";
import { copyFixture } from "../__fixtures__/helpers.js";

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

    await copyFixture("list/lockfile-basic-tree.json", join(workflowDir, "actions.lock.json"));

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

    await copyFixture("list/lockfile-composite-deps.json", join(workflowDir, "actions.lock.json"));

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

    await copyFixture("list/lockfile-tree-formatting.json", join(workflowDir, "actions.lock.json"));

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

    await copyFixture("list/lockfile-sha-display.json", join(workflowDir, "actions.lock.json"));

    await list({
      workflows: workflowDir,
      output: join(workflowDir, "actions.lock.json"),
    });

    // Should show version
    expect(consoleLogs.some((log) => log.includes("@v4"))).toBe(true);

    // Should show truncated SHA (12 chars)
    const sha = "b4ffde65f46336ab88eb53be808477a3936bae11";
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

    await copyFixture("list/lockfile-empty.json", join(workflowDir, "actions.lock.json"));

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

    await copyFixture("list/lockfile-multi-version.json", join(workflowDir, "actions.lock.json"));

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
