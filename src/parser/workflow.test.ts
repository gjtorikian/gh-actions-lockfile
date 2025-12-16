import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseActionRef,
  getFullName,
  getRepoFullName,
  parseWorkflowFile,
  parseWorkflowDir,
  extractActionRefs,
} from "./workflow.js";
import type { ActionRef, Workflow } from "../types.js";

describe("parseActionRef", () => {
  test("parses basic action ref (owner/repo@version)", () => {
    const result = parseActionRef("actions/checkout@v4");
    expect(result).toEqual({
      owner: "actions",
      repo: "checkout",
      ref: "v4",
      path: undefined,
      rawUses: "actions/checkout@v4",
    });
  });

  test("parses action ref with path (owner/repo/path@version)", () => {
    const result = parseActionRef("actions/cache/restore@v4");
    expect(result).toEqual({
      owner: "actions",
      repo: "cache",
      ref: "v4",
      path: "restore",
      rawUses: "actions/cache/restore@v4",
    });
  });

  test("parses action ref with nested path", () => {
    const result = parseActionRef("owner/repo/deep/nested/path@main");
    expect(result).toEqual({
      owner: "owner",
      repo: "repo",
      ref: "main",
      path: "deep/nested/path",
      rawUses: "owner/repo/deep/nested/path@main",
    });
  });

  test("parses action ref with full SHA", () => {
    const sha = "b4ffde65f46336ab88eb53be808477a3936bae11";
    const result = parseActionRef(`actions/checkout@${sha}`);
    expect(result).toEqual({
      owner: "actions",
      repo: "checkout",
      ref: sha,
      path: undefined,
      rawUses: `actions/checkout@${sha}`,
    });
  });

  test("parses action ref with branch name", () => {
    const result = parseActionRef("owner/repo@feature/branch-name");
    expect(result).toEqual({
      owner: "owner",
      repo: "repo",
      ref: "feature/branch-name",
      path: undefined,
      rawUses: "owner/repo@feature/branch-name",
    });
  });

  test("returns null for invalid format (no @)", () => {
    const result = parseActionRef("actions/checkout");
    expect(result).toBeNull();
  });

  test("returns null for local action (./)", () => {
    // Note: parseActionRef doesn't check for ./ - that's done in extractActionRefs
    // But the regex won't match it anyway
    const result = parseActionRef("./local-action");
    expect(result).toBeNull();
  });

  test("returns null for docker action", () => {
    const result = parseActionRef("docker://alpine:3.18");
    expect(result).toBeNull();
  });
});

describe("getFullName", () => {
  test("returns owner/repo without path", () => {
    const ref: ActionRef = {
      owner: "actions",
      repo: "checkout",
      ref: "v4",
      rawUses: "actions/checkout@v4",
    };
    expect(getFullName(ref)).toBe("actions/checkout");
  });

  test("returns owner/repo/path with path", () => {
    const ref: ActionRef = {
      owner: "actions",
      repo: "cache",
      ref: "v4",
      path: "restore",
      rawUses: "actions/cache/restore@v4",
    };
    expect(getFullName(ref)).toBe("actions/cache/restore");
  });

  test("returns owner/repo/nested/path with nested path", () => {
    const ref: ActionRef = {
      owner: "owner",
      repo: "repo",
      ref: "main",
      path: "deep/nested/path",
      rawUses: "owner/repo/deep/nested/path@main",
    };
    expect(getFullName(ref)).toBe("owner/repo/deep/nested/path");
  });
});

describe("getRepoFullName", () => {
  test("returns owner/repo without path", () => {
    const ref: ActionRef = {
      owner: "actions",
      repo: "checkout",
      ref: "v4",
      rawUses: "actions/checkout@v4",
    };
    expect(getRepoFullName(ref)).toBe("actions/checkout");
  });

  test("returns owner/repo even when path is present", () => {
    const ref: ActionRef = {
      owner: "actions",
      repo: "cache",
      ref: "v4",
      path: "restore",
      rawUses: "actions/cache/restore@v4",
    };
    expect(getRepoFullName(ref)).toBe("actions/cache");
  });
});

describe("parseWorkflowFile", () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "workflow-test-"));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true });
  });

  test("parses valid workflow file", async () => {
    const workflowPath = join(tempDir, "valid.yml");
    await writeFile(
      workflowPath,
      `name: Test
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
`
    );

    const result = await parseWorkflowFile(workflowPath);
    expect(result).not.toBeNull();
    expect(result?.name).toBe("Test");
    expect(result?.jobs.build).toBeDefined();
    expect(result?.jobs.build!.steps?.[0]!.uses).toBe("actions/checkout@v4");
  });

  test("returns null for invalid YAML", async () => {
    const workflowPath = join(tempDir, "invalid.yml");
    // Use YAML that will cause a parse error (duplicate key with conflicting value)
    // The yaml library doesn't always throw, so use syntax that actually fails
    await writeFile(workflowPath, "name: Test\n  bad indentation here\n  another: line");

    const result = await parseWorkflowFile(workflowPath);
    expect(result).toBeNull();
  });

  test("parses workflow with multiple jobs", async () => {
    const workflowPath = join(tempDir, "multi-job.yml");
    await writeFile(
      workflowPath,
      `name: Multi
on: push
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - run: echo lint
  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo test
`
    );

    const result = await parseWorkflowFile(workflowPath);
    expect(result).not.toBeNull();
    expect(Object.keys(result?.jobs ?? {})).toEqual(["lint", "test"]);
  });
});

describe("parseWorkflowDir", () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "workflow-dir-test-"));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true });
  });

  test("parses all .yml files in directory", async () => {
    await writeFile(
      join(tempDir, "ci.yml"),
      `name: CI
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo ci
`
    );
    await writeFile(
      join(tempDir, "deploy.yml"),
      `name: Deploy
on: push
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - run: echo deploy
`
    );

    const result = await parseWorkflowDir(tempDir);
    expect(result).toHaveLength(2);
    expect(result.map((w) => w.name).sort()).toEqual(["CI", "Deploy"]);
  });

  test("parses .yaml extension files", async () => {
    const subDir = join(tempDir, "yaml-ext");
    await mkdir(subDir);
    await writeFile(
      join(subDir, "test.yaml"),
      `name: YAML Extension
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo test
`
    );

    const result = await parseWorkflowDir(subDir);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("YAML Extension");
  });

  test("ignores non-YAML files", async () => {
    const subDir = join(tempDir, "mixed");
    await mkdir(subDir);
    await writeFile(join(subDir, "readme.md"), "# README");
    await writeFile(join(subDir, "script.sh"), "echo hello");
    await writeFile(
      join(subDir, "workflow.yml"),
      `name: Workflow
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo test
`
    );

    const result = await parseWorkflowDir(subDir);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("Workflow");
  });

  test("returns empty array for empty directory", async () => {
    const emptyDir = join(tempDir, "empty");
    await mkdir(emptyDir);

    const result = await parseWorkflowDir(emptyDir);
    expect(result).toEqual([]);
  });

  test("ignores subdirectories", async () => {
    const subDir = join(tempDir, "with-subdir");
    await mkdir(subDir);
    await mkdir(join(subDir, "nested"));
    await writeFile(
      join(subDir, "nested", "workflow.yml"),
      `name: Nested
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo test
`
    );
    await writeFile(
      join(subDir, "top.yml"),
      `name: Top
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo test
`
    );

    const result = await parseWorkflowDir(subDir);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("Top");
  });
});

describe("extractActionRefs", () => {
  test("extracts action refs from workflow", () => {
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

    const result = extractActionRefs(workflows);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.rawUses)).toEqual([
      "actions/checkout@v4",
      "actions/setup-node@v4",
    ]);
  });

  test("extracts from multiple jobs", () => {
    const workflows: Workflow[] = [
      {
        name: "Test",
        jobs: {
          lint: {
            steps: [{ uses: "actions/checkout@v4" }],
          },
          test: {
            steps: [{ uses: "actions/setup-node@v4" }],
          },
        },
      },
    ];

    const result = extractActionRefs(workflows);
    expect(result).toHaveLength(2);
  });

  test("deduplicates identical action refs", () => {
    const workflows: Workflow[] = [
      {
        name: "Test",
        jobs: {
          lint: {
            steps: [
              { uses: "actions/checkout@v4" },
              { uses: "actions/checkout@v4" },
            ],
          },
          test: {
            steps: [{ uses: "actions/checkout@v4" }],
          },
        },
      },
    ];

    const result = extractActionRefs(workflows);
    expect(result).toHaveLength(1);
    expect(result[0]!.rawUses).toBe("actions/checkout@v4");
  });

  test("skips local actions (./)", () => {
    const workflows: Workflow[] = [
      {
        name: "Test",
        jobs: {
          build: {
            steps: [
              { uses: "./local-action" },
              { uses: "actions/checkout@v4" },
            ],
          },
        },
      },
    ];

    const result = extractActionRefs(workflows);
    expect(result).toHaveLength(1);
    expect(result[0]!.rawUses).toBe("actions/checkout@v4");
  });

  test("skips docker:// refs", () => {
    const workflows: Workflow[] = [
      {
        name: "Test",
        jobs: {
          build: {
            steps: [
              { uses: "docker://alpine:3.18" },
              { uses: "actions/checkout@v4" },
            ],
          },
        },
      },
    ];

    const result = extractActionRefs(workflows);
    expect(result).toHaveLength(1);
    expect(result[0]!.rawUses).toBe("actions/checkout@v4");
  });

  test("handles workflows with no jobs", () => {
    const workflows: Workflow[] = [
      {
        name: "Empty",
        jobs: {},
      },
    ];

    const result = extractActionRefs(workflows);
    expect(result).toEqual([]);
  });

  test("handles jobs with no steps", () => {
    const workflows: Workflow[] = [
      {
        name: "No Steps",
        jobs: {
          build: {
            "runs-on": "ubuntu-latest",
          },
        },
      },
    ];

    const result = extractActionRefs(workflows);
    expect(result).toEqual([]);
  });

  test("handles steps with only run commands", () => {
    const workflows: Workflow[] = [
      {
        name: "Run Only",
        jobs: {
          build: {
            steps: [{ run: "echo hello" }, { run: "echo world" }],
          },
        },
      },
    ];

    const result = extractActionRefs(workflows);
    expect(result).toEqual([]);
  });

  test("extracts from multiple workflows", () => {
    const workflows: Workflow[] = [
      {
        name: "CI",
        jobs: {
          build: {
            steps: [{ uses: "actions/checkout@v4" }],
          },
        },
      },
      {
        name: "Deploy",
        jobs: {
          deploy: {
            steps: [{ uses: "aws-actions/configure-aws-credentials@v4" }],
          },
        },
      },
    ];

    const result = extractActionRefs(workflows);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.rawUses).sort()).toEqual([
      "actions/checkout@v4",
      "aws-actions/configure-aws-credentials@v4",
    ]);
  });
});
