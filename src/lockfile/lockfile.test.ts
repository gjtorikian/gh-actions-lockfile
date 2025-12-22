import { describe, expect, test, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readLockfile,
  writeLockfile,
  verify,
  printVerifyResult,
  DEFAULT_PATH,
} from "./lockfile.js";
import type { Lockfile, Workflow, VerifyResult } from "../types.js";

describe("DEFAULT_PATH", () => {
  test("has correct default path", () => {
    expect(DEFAULT_PATH).toBe(".github/actions.lock.json");
  });
});

describe("readLockfile", () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "lockfile-read-test-"));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true });
  });

  test("reads valid lockfile", async () => {
    const lockfilePath = join(tempDir, "valid.lock.json");
    const lockfile: Lockfile = {
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
    };
    await writeFile(lockfilePath, JSON.stringify(lockfile));

    const result = await readLockfile(lockfilePath);
    expect(result).toEqual(lockfile);
  });

  test("throws if file not found", async () => {
    const nonexistentPath = join(tempDir, "nonexistent.lock.json");
    await expect(readLockfile(nonexistentPath)).rejects.toThrow(
      "Lockfile not found"
    );
  });
});

describe("writeLockfile", () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "lockfile-write-test-"));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true });
  });

  test("writes lockfile to disk", async () => {
    const lockfilePath = join(tempDir, "output.lock.json");
    const lockfile: Lockfile = {
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
    };

    await writeLockfile(lockfile, lockfilePath);

    const content = await readFile(lockfilePath, "utf-8");
    expect(JSON.parse(content)).toEqual(lockfile);
  });

  test("formats with 2-space indent", async () => {
    const lockfilePath = join(tempDir, "formatted.lock.json");
    const lockfile: Lockfile = {
      version: 1,
      generated: "2024-01-15T10:30:00.000Z",
      actions: {},
    };

    await writeLockfile(lockfile, lockfilePath);

    const content = await readFile(lockfilePath, "utf-8");
    // Check that it's formatted with 2 spaces
    expect(content).toContain('  "version": 1');
  });

  test("adds trailing newline", async () => {
    const lockfilePath = join(tempDir, "trailing.lock.json");
    const lockfile: Lockfile = {
      version: 1,
      generated: "2024-01-15T10:30:00.000Z",
      actions: {},
    };

    await writeLockfile(lockfile, lockfilePath);

    const content = await readFile(lockfilePath, "utf-8");
    expect(content.endsWith("\n")).toBe(true);
  });

  test("creates directory if missing", async () => {
    const nestedPath = join(tempDir, "nested", "deep", "lockfile.json");
    const lockfile: Lockfile = {
      version: 1,
      generated: "2024-01-15T10:30:00.000Z",
      actions: {},
    };

    await writeLockfile(lockfile, nestedPath);

    const content = await readFile(nestedPath, "utf-8");
    expect(JSON.parse(content)).toEqual(lockfile);
  });
});


describe("verify", () => {
  test("returns match=true when workflows match lockfile", () => {
    const workflows: Workflow[] = [
      {
        name: "Test",
        jobs: {
          build: {
            steps: [{ uses: "actions/checkout@v4" }],
          },
        },
      },
    ];

    const lockfile: Lockfile = {
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
    };

    const result = verify(workflows, lockfile);
    expect(result.match).toBe(true);
    expect(result.newActions).toEqual([]);
    expect(result.changed).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  test("detects new actions", () => {
    const workflows: Workflow[] = [
      {
        name: "Test",
        jobs: {
          build: {
            steps: [
              { uses: "actions/checkout@v4" },
              { uses: "actions/setup-node@v4" },
            ],
          },
        },
      },
    ];

    const lockfile: Lockfile = {
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
    };

    const result = verify(workflows, lockfile);
    expect(result.match).toBe(false);
    expect(result.newActions).toHaveLength(1);
    expect(result.newActions[0]!.action).toBe("actions/setup-node");
    expect(result.newActions[0]!.newVersion).toBe("v4");
  });

  test("detects changed actions (version mismatch)", () => {
    const workflows: Workflow[] = [
      {
        name: "Test",
        jobs: {
          build: {
            steps: [{ uses: "actions/checkout@v5" }],
          },
        },
      },
    ];

    const lockfile: Lockfile = {
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
    };

    const result = verify(workflows, lockfile);
    expect(result.match).toBe(false);
    // Now this detects v5 as NEW (since v4 exists but v5 doesn't)
    expect(result.newActions).toHaveLength(1);
    expect(result.newActions[0]!.action).toBe("actions/checkout");
    expect(result.newActions[0]!.newVersion).toBe("v5");
  });

  test("detects removed actions", () => {
    const workflows: Workflow[] = [
      {
        name: "Test",
        jobs: {
          build: {
            steps: [{ uses: "actions/checkout@v4" }],
          },
        },
      },
    ];

    const lockfile: Lockfile = {
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
    };

    const result = verify(workflows, lockfile);
    expect(result.match).toBe(false);
    expect(result.removed).toHaveLength(1);
    expect(result.removed[0]!.action).toBe("actions/setup-node");
  });

  test("only reports top-level removals, not transitive deps", () => {
    const workflows: Workflow[] = [
      {
        name: "Test",
        jobs: {
          build: {
            steps: [{ run: "echo hello" }],
          },
        },
      },
    ];

    // Lockfile has a composite action that depends on checkout
    const lockfile: Lockfile = {
      version: 1,
      generated: "2024-01-15T10:30:00.000Z",
      actions: {
        "owner/composite-action": [
          {
            version: "v1",
            sha: "111111",
            integrity: "sha256-composite",
            dependencies: [
              {
                ref: "actions/checkout@v4",
                sha: "abc123",
                integrity: "sha256-xyz",
              },
            ],
          },
        ],
        "actions/checkout": [
          {
            version: "v4",
            sha: "abc123",
            integrity: "sha256-xyz",
            dependencies: [],
          },
        ],
      },
    };

    const result = verify(workflows, lockfile);
    expect(result.match).toBe(false);
    // Only the top-level action should be reported as removed
    expect(result.removed).toHaveLength(1);
    expect(result.removed[0]!.action).toBe("owner/composite-action");
  });

  test("handles workflows with no actions", () => {
    const workflows: Workflow[] = [
      {
        name: "Test",
        jobs: {
          build: {
            steps: [{ run: "echo hello" }],
          },
        },
      },
    ];

    const lockfile: Lockfile = {
      version: 1,
      generated: "2024-01-15T10:30:00.000Z",
      actions: {},
    };

    const result = verify(workflows, lockfile);
    expect(result.match).toBe(true);
  });

  test("handles empty lockfile with actions in workflow", () => {
    const workflows: Workflow[] = [
      {
        name: "Test",
        jobs: {
          build: {
            steps: [{ uses: "actions/checkout@v4" }],
          },
        },
      },
    ];

    const lockfile: Lockfile = {
      version: 1,
      generated: "2024-01-15T10:30:00.000Z",
      actions: {},
    };

    const result = verify(workflows, lockfile);
    expect(result.match).toBe(false);
    expect(result.newActions).toHaveLength(1);
  });

  test("matches when workflow uses multiple versions of same action", () => {
    const workflows: Workflow[] = [
      {
        name: "Test",
        jobs: {
          "build-v3": {
            steps: [{ uses: "actions/checkout@v3" }],
          },
          "build-v4": {
            steps: [{ uses: "actions/checkout@v4" }],
          },
        },
      },
    ];

    const lockfile: Lockfile = {
      version: 1,
      generated: "2024-01-15T10:30:00.000Z",
      actions: {
        "actions/checkout": [
          {
            version: "v3",
            sha: "abc123",
            integrity: "sha256-v3",
            dependencies: [],
          },
          {
            version: "v4",
            sha: "def456",
            integrity: "sha256-v4",
            dependencies: [],
          },
        ],
      },
    };

    const result = verify(workflows, lockfile);
    expect(result.match).toBe(true);
    expect(result.newActions).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  test("detects missing version when multiple versions exist in lockfile", () => {
    const workflows: Workflow[] = [
      {
        name: "Test",
        jobs: {
          "build-v3": {
            steps: [{ uses: "actions/checkout@v3" }],
          },
          "build-v4": {
            steps: [{ uses: "actions/checkout@v4" }],
          },
          "build-v5": {
            steps: [{ uses: "actions/checkout@v5" }],
          },
        },
      },
    ];

    // Lockfile only has v3 and v4, missing v5
    const lockfile: Lockfile = {
      version: 1,
      generated: "2024-01-15T10:30:00.000Z",
      actions: {
        "actions/checkout": [
          {
            version: "v3",
            sha: "abc123",
            integrity: "sha256-v3",
            dependencies: [],
          },
          {
            version: "v4",
            sha: "def456",
            integrity: "sha256-v4",
            dependencies: [],
          },
        ],
      },
    };

    const result = verify(workflows, lockfile);
    expect(result.match).toBe(false);
    expect(result.newActions).toHaveLength(1);
    expect(result.newActions[0]!.action).toBe("actions/checkout");
    expect(result.newActions[0]!.newVersion).toBe("v5");
  });
});

describe("printVerifyResult", () => {
  let consoleLogs: string[];
  const originalLog = console.log;

  beforeEach(() => {
    consoleLogs = [];
    console.log = (...args: unknown[]) => {
      consoleLogs.push(args.map(String).join(" "));
    };
  });

  afterEach(() => {
    console.log = originalLog;
  });

  test("prints success message when match", () => {
    const result: VerifyResult = {
      match: true,
      newActions: [],
      changed: [],
      removed: [],
    };

    printVerifyResult(result);

    expect(consoleLogs.some((log) => log.includes("Lockfile is up to date"))).toBe(
      true
    );
  });

  test("prints new actions", () => {
    const result: VerifyResult = {
      match: false,
      newActions: [{ action: "actions/checkout", newVersion: "v4" }],
      changed: [],
      removed: [],
    };

    printVerifyResult(result);

    expect(consoleLogs.some((log) => log.includes("New actions"))).toBe(true);
    expect(
      consoleLogs.some((log) => log.includes("+ actions/checkout@v4"))
    ).toBe(true);
  });

  test("prints changed actions", () => {
    const result: VerifyResult = {
      match: false,
      newActions: [],
      changed: [
        {
          action: "actions/checkout",
          oldVersion: "v3",
          newVersion: "v4",
          oldSha: "abc123",
        },
      ],
      removed: [],
    };

    printVerifyResult(result);

    expect(consoleLogs.some((log) => log.includes("Changed actions"))).toBe(true);
    expect(
      consoleLogs.some((log) => log.includes("~ actions/checkout: v3 -> v4"))
    ).toBe(true);
  });

  test("prints removed actions", () => {
    const result: VerifyResult = {
      match: false,
      newActions: [],
      changed: [],
      removed: [{ action: "actions/setup-node", oldVersion: "v4", oldSha: "xyz789" }],
    };

    printVerifyResult(result);

    expect(consoleLogs.some((log) => log.includes("Removed actions"))).toBe(true);
    expect(
      consoleLogs.some((log) => log.includes("- actions/setup-node@v4"))
    ).toBe(true);
  });

  test("prints suggestion to run generate", () => {
    const result: VerifyResult = {
      match: false,
      newActions: [{ action: "actions/checkout", newVersion: "v4" }],
      changed: [],
      removed: [],
    };

    printVerifyResult(result);

    expect(
      consoleLogs.some((log) =>
        log.includes("gh-actions-lockfile generate")
      )
    ).toBe(true);
  });
});
