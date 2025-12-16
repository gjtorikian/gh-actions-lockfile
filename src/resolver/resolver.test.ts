import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { Resolver } from "./resolver.js";
import { GitHubClient } from "../github/client.js";
import type { ActionRef, ActionConfig } from "../types.js";

// Mock GitHubClient
function createMockClient(overrides: Partial<GitHubClient> = {}): GitHubClient {
  const mockClient = {
    resolveRef: mock(() => Promise.resolve("abc123def456abc123def456abc123def456abc123")),
    getActionConfig: mock(() => Promise.resolve(null)),
    getArchiveSHA256: mock(() => Promise.resolve("sha256-mockhash123")),
    ...overrides,
  } as unknown as GitHubClient;
  return mockClient;
}

// Suppress console.log during tests
const originalLog = console.log;
beforeEach(() => {
  console.log = () => {};
});
afterEach(() => {
  console.log = originalLog;
});

describe("Resolver", () => {
  describe("resolveAll", () => {
    test("resolves multiple refs", async () => {
      const mockClient = createMockClient();
      const resolver = new Resolver(mockClient);

      const refs: ActionRef[] = [
        {
          owner: "actions",
          repo: "checkout",
          ref: "v4",
          rawUses: "actions/checkout@v4",
        },
        {
          owner: "actions",
          repo: "setup-node",
          ref: "v4",
          rawUses: "actions/setup-node@v4",
        },
      ];

      const lockfile = await resolver.resolveAll(refs);

      expect(Object.keys(lockfile.actions)).toHaveLength(2);
      expect(lockfile.actions["actions/checkout"]).toBeDefined();
      expect(lockfile.actions["actions/setup-node"]).toBeDefined();
    });

    test("populates lockfile with correct structure", async () => {
      const sha = "b4ffde65f46336ab88eb53be808477a3936bae11";
      const integrity = "sha256-abc123xyz";

      const mockClient = createMockClient({
        resolveRef: mock(() => Promise.resolve(sha)),
        getArchiveSHA256: mock(() => Promise.resolve(integrity)),
      });
      const resolver = new Resolver(mockClient);

      const refs: ActionRef[] = [
        {
          owner: "actions",
          repo: "checkout",
          ref: "v4",
          rawUses: "actions/checkout@v4",
        },
      ];

      const lockfile = await resolver.resolveAll(refs);

      expect(lockfile.version).toBe(1);
      expect(lockfile.generated).toBeDefined();
      expect(lockfile.actions["actions/checkout"]).toEqual([
        {
          version: "v4",
          sha,
          integrity,
          dependencies: [],
        },
      ]);
    });

    test("returns empty lockfile for no refs", async () => {
      const mockClient = createMockClient();
      const resolver = new Resolver(mockClient);

      const lockfile = await resolver.resolveAll([]);

      expect(lockfile.version).toBe(1);
      expect(lockfile.actions).toEqual({});
    });

    test("resolves multiple versions of the same action", async () => {
      const mockClient = createMockClient({
        resolveRef: mock((owner: string, repo: string, ref: string) =>
          Promise.resolve(`sha-${ref}`)
        ),
        getArchiveSHA256: mock((owner: string, repo: string, sha: string) =>
          Promise.resolve(`integrity-${sha}`)
        ),
      });
      const resolver = new Resolver(mockClient);

      const refs: ActionRef[] = [
        {
          owner: "actions",
          repo: "checkout",
          ref: "v3",
          rawUses: "actions/checkout@v3",
        },
        {
          owner: "actions",
          repo: "checkout",
          ref: "v4",
          rawUses: "actions/checkout@v4",
        },
      ];

      const lockfile = await resolver.resolveAll(refs);

      // Should have one key with both versions in array
      expect(Object.keys(lockfile.actions)).toHaveLength(1);
      expect(lockfile.actions["actions/checkout"]).toHaveLength(2);

      const versions = lockfile.actions["actions/checkout"]!.map(a => a.version);
      expect(versions).toContain("v3");
      expect(versions).toContain("v4");

      // Each version should have its own SHA
      const v3 = lockfile.actions["actions/checkout"]!.find(a => a.version === "v3");
      const v4 = lockfile.actions["actions/checkout"]!.find(a => a.version === "v4");
      expect(v3!.sha).toBe("sha-v3");
      expect(v4!.sha).toBe("sha-v4");
    });
  });

  describe("resolveAction (deduplication)", () => {
    test("skips already-visited actions", async () => {
      let resolveRefCallCount = 0;
      const mockClient = createMockClient({
        resolveRef: mock(() => {
          resolveRefCallCount++;
          return Promise.resolve("abc123");
        }),
      });
      const resolver = new Resolver(mockClient);

      // Same action referenced multiple times
      const refs: ActionRef[] = [
        {
          owner: "actions",
          repo: "checkout",
          ref: "v4",
          rawUses: "actions/checkout@v4",
        },
        {
          owner: "actions",
          repo: "checkout",
          ref: "v4",
          rawUses: "actions/checkout@v4",
        },
      ];

      await resolver.resolveAll(refs);

      // Should only resolve once due to deduplication
      expect(resolveRefCallCount).toBe(1);
    });
  });

  describe("resolveAction (depth limit)", () => {
    test("throws at MAX_DEPTH (10) exceeded", async () => {
      // Create a chain of composite actions that reference each other
      // This simulates a deep dependency tree
      let depth = 0;

      const mockClient = createMockClient({
        resolveRef: mock(() => Promise.resolve(`sha-depth-${depth++}`)),
        getActionConfig: mock(
          (owner: string, repo: string): Promise<ActionConfig | null> => {
            // Each action depends on the next in a chain
            const currentDepth = parseInt(repo.split("-")[1] || "0");
            if (currentDepth < 15) {
              return Promise.resolve({
                name: `Action ${currentDepth}`,
                runs: {
                  using: "composite",
                  steps: [
                    {
                      uses: `owner/action-${currentDepth + 1}@v1`,
                    },
                  ],
                },
              });
            }
            return Promise.resolve(null);
          }
        ),
      });

      const resolver = new Resolver(mockClient);

      const refs: ActionRef[] = [
        {
          owner: "owner",
          repo: "action-0",
          ref: "v1",
          rawUses: "owner/action-0@v1",
        },
      ];

      await expect(resolver.resolveAll(refs)).rejects.toThrow(
        "Max dependency depth exceeded"
      );
    });
  });

  describe("resolveAction (transitive deps)", () => {
    test("resolves transitive deps from composite actions", async () => {
      const mockClient = createMockClient({
        resolveRef: mock((owner: string, repo: string) =>
          Promise.resolve(`sha-${owner}-${repo}`)
        ),
        getActionConfig: mock(
          (owner: string, repo: string): Promise<ActionConfig | null> => {
            if (owner === "owner" && repo === "composite") {
              return Promise.resolve({
                name: "Composite Action",
                runs: {
                  using: "composite",
                  steps: [
                    { uses: "actions/checkout@v4" },
                    { uses: "actions/setup-node@v4" },
                  ],
                },
              });
            }
            return Promise.resolve(null);
          }
        ),
      });

      const resolver = new Resolver(mockClient);

      const refs: ActionRef[] = [
        {
          owner: "owner",
          repo: "composite",
          ref: "v1",
          rawUses: "owner/composite@v1",
        },
      ];

      const lockfile = await resolver.resolveAll(refs);

      // Should have the composite action and its dependencies
      expect(Object.keys(lockfile.actions)).toHaveLength(3);
      expect(lockfile.actions["owner/composite"]).toBeDefined();
      expect(lockfile.actions["actions/checkout"]).toBeDefined();
      expect(lockfile.actions["actions/setup-node"]).toBeDefined();

      // Composite action should have dependencies listed
      expect(lockfile.actions["owner/composite"]![0]!.dependencies).toHaveLength(2);
    });
  });

  describe("findTransitiveDeps", () => {
    test("returns empty for non-composite actions", async () => {
      const mockClient = createMockClient({
        getActionConfig: mock(() =>
          Promise.resolve({
            name: "Node Action",
            runs: {
              using: "node20",
              main: "dist/index.js",
            },
          })
        ),
      });

      const resolver = new Resolver(mockClient);

      const refs: ActionRef[] = [
        {
          owner: "owner",
          repo: "node-action",
          ref: "v1",
          rawUses: "owner/node-action@v1",
        },
      ];

      const lockfile = await resolver.resolveAll(refs);

      // Should only have the action itself, no dependencies
      expect(Object.keys(lockfile.actions)).toHaveLength(1);
      expect(lockfile.actions["owner/node-action"]![0]!.dependencies).toEqual([]);
    });

    test("extracts deps from composite action steps", async () => {
      const mockClient = createMockClient({
        resolveRef: mock((owner: string, repo: string) =>
          Promise.resolve(`sha-${owner}-${repo}`)
        ),
        getActionConfig: mock(
          (owner: string, repo: string): Promise<ActionConfig | null> => {
            if (owner === "owner" && repo === "composite") {
              return Promise.resolve({
                name: "Composite",
                runs: {
                  using: "composite",
                  steps: [
                    { uses: "dep/action-one@v1" },
                    { run: "echo hello" }, // Should be skipped
                    { uses: "dep/action-two@v2" },
                  ],
                },
              });
            }
            return Promise.resolve(null);
          }
        ),
      });

      const resolver = new Resolver(mockClient);

      const refs: ActionRef[] = [
        {
          owner: "owner",
          repo: "composite",
          ref: "v1",
          rawUses: "owner/composite@v1",
        },
      ];

      const lockfile = await resolver.resolveAll(refs);

      expect(lockfile.actions["dep/action-one"]).toBeDefined();
      expect(lockfile.actions["dep/action-two"]).toBeDefined();
    });

    test("skips local (./) actions in composite", async () => {
      const mockClient = createMockClient({
        getActionConfig: mock(() =>
          Promise.resolve({
            name: "Composite",
            runs: {
              using: "composite",
              steps: [
                { uses: "./local-action" },
                { uses: "actions/checkout@v4" },
              ],
            },
          })
        ),
      });

      const resolver = new Resolver(mockClient);

      const refs: ActionRef[] = [
        {
          owner: "owner",
          repo: "composite",
          ref: "v1",
          rawUses: "owner/composite@v1",
        },
      ];

      const lockfile = await resolver.resolveAll(refs);

      // Only checkout should be resolved as dependency, not ./local-action
      expect(Object.keys(lockfile.actions)).toHaveLength(2);
      expect(lockfile.actions["actions/checkout"]).toBeDefined();
    });

    test("skips docker:// refs in composite", async () => {
      const mockClient = createMockClient({
        getActionConfig: mock(() =>
          Promise.resolve({
            name: "Composite",
            runs: {
              using: "composite",
              steps: [
                { uses: "docker://alpine:3.18" },
                { uses: "actions/checkout@v4" },
              ],
            },
          })
        ),
      });

      const resolver = new Resolver(mockClient);

      const refs: ActionRef[] = [
        {
          owner: "owner",
          repo: "composite",
          ref: "v1",
          rawUses: "owner/composite@v1",
        },
      ];

      const lockfile = await resolver.resolveAll(refs);

      // Only checkout should be resolved
      expect(Object.keys(lockfile.actions)).toHaveLength(2);
      expect(lockfile.actions["actions/checkout"]).toBeDefined();
    });
  });

  describe("integrity hash handling", () => {
    test("handles integrity hash errors gracefully", async () => {
      const mockClient = createMockClient({
        resolveRef: mock(() => Promise.resolve("abc123")),
        getArchiveSHA256: mock(() =>
          Promise.reject(new Error("Rate limited"))
        ),
      });

      const resolver = new Resolver(mockClient);

      const refs: ActionRef[] = [
        {
          owner: "actions",
          repo: "checkout",
          ref: "v4",
          rawUses: "actions/checkout@v4",
        },
      ];

      // Should not throw, but integrity will be empty
      const lockfile = await resolver.resolveAll(refs);
      expect(lockfile.actions["actions/checkout"]).toBeDefined();
      expect(lockfile.actions["actions/checkout"]![0]!.integrity).toBe("");
    });
  });

  describe("action with path", () => {
    test("resolves action with subpath", async () => {
      const mockClient = createMockClient();
      const resolver = new Resolver(mockClient);

      const refs: ActionRef[] = [
        {
          owner: "actions",
          repo: "cache",
          ref: "v4",
          path: "restore",
          rawUses: "actions/cache/restore@v4",
        },
      ];

      const lockfile = await resolver.resolveAll(refs);

      expect(lockfile.actions["actions/cache/restore"]).toBeDefined();
    });
  });

  describe("reusable workflows", () => {
    test("extracts deps from reusable workflow jobs", async () => {
      const mockClient = createMockClient({
        resolveRef: mock((owner: string, repo: string) =>
          Promise.resolve(`sha-${owner}-${repo}`)
        ),
        getActionConfig: mock(
          (owner: string, repo: string, sha: string, path?: string): Promise<ActionConfig | null> => {
            if (path === ".github/workflows/reusable.yml") {
              return Promise.resolve({
                name: "Reusable Workflow",
                jobs: {
                  build: {
                    steps: [
                      { uses: "actions/checkout@v4" },
                      { uses: "actions/setup-node@v4" },
                    ],
                  },
                },
              });
            }
            return Promise.resolve(null);
          }
        ),
      });

      const resolver = new Resolver(mockClient);

      const refs: ActionRef[] = [
        {
          owner: "owner",
          repo: "repo",
          ref: "main",
          path: ".github/workflows/reusable.yml",
          rawUses: "owner/repo/.github/workflows/reusable.yml@main",
        },
      ];

      const lockfile = await resolver.resolveAll(refs);

      // Should have the reusable workflow and its dependencies
      expect(Object.keys(lockfile.actions)).toHaveLength(3);
      expect(lockfile.actions["owner/repo/.github/workflows/reusable.yml"]).toBeDefined();
      expect(lockfile.actions["actions/checkout"]).toBeDefined();
      expect(lockfile.actions["actions/setup-node"]).toBeDefined();
    });

    test("extracts deps from nested reusable workflow calls", async () => {
      const mockClient = createMockClient({
        resolveRef: mock((owner: string, repo: string) =>
          Promise.resolve(`sha-${owner}-${repo}`)
        ),
        getActionConfig: mock(
          (owner: string, repo: string, sha: string, path?: string): Promise<ActionConfig | null> => {
            if (path === ".github/workflows/parent.yml") {
              return Promise.resolve({
                name: "Parent Workflow",
                jobs: {
                  nested: {
                    uses: "other/repo/.github/workflows/child.yml@v1",
                  },
                },
              });
            }
            return Promise.resolve(null);
          }
        ),
      });

      const resolver = new Resolver(mockClient);

      const refs: ActionRef[] = [
        {
          owner: "owner",
          repo: "repo",
          ref: "main",
          path: ".github/workflows/parent.yml",
          rawUses: "owner/repo/.github/workflows/parent.yml@main",
        },
      ];

      const lockfile = await resolver.resolveAll(refs);

      // Should have parent and child workflow
      expect(Object.keys(lockfile.actions)).toHaveLength(2);
      expect(lockfile.actions["owner/repo/.github/workflows/parent.yml"]).toBeDefined();
      expect(lockfile.actions["other/repo/.github/workflows/child.yml"]).toBeDefined();
    });

    test("extracts deps from multiple jobs in reusable workflow", async () => {
      const mockClient = createMockClient({
        resolveRef: mock((owner: string, repo: string) =>
          Promise.resolve(`sha-${owner}-${repo}`)
        ),
        getActionConfig: mock(
          (owner: string, repo: string, sha: string, path?: string): Promise<ActionConfig | null> => {
            if (path === ".github/workflows/multi.yml") {
              return Promise.resolve({
                name: "Multi Job Workflow",
                jobs: {
                  lint: {
                    steps: [{ uses: "actions/checkout@v4" }],
                  },
                  test: {
                    steps: [{ uses: "actions/setup-node@v4" }],
                  },
                  deploy: {
                    uses: "another/workflow/.github/workflows/deploy.yml@main",
                  },
                },
              });
            }
            return Promise.resolve(null);
          }
        ),
      });

      const resolver = new Resolver(mockClient);

      const refs: ActionRef[] = [
        {
          owner: "owner",
          repo: "repo",
          ref: "main",
          path: ".github/workflows/multi.yml",
          rawUses: "owner/repo/.github/workflows/multi.yml@main",
        },
      ];

      const lockfile = await resolver.resolveAll(refs);

      // Should have: multi.yml, checkout, setup-node, deploy.yml
      expect(Object.keys(lockfile.actions)).toHaveLength(4);
      expect(lockfile.actions["owner/repo/.github/workflows/multi.yml"]).toBeDefined();
      expect(lockfile.actions["actions/checkout"]).toBeDefined();
      expect(lockfile.actions["actions/setup-node"]).toBeDefined();
      expect(lockfile.actions["another/workflow/.github/workflows/deploy.yml"]).toBeDefined();
    });

    test("skips local reusable workflow calls in jobs", async () => {
      const mockClient = createMockClient({
        getActionConfig: mock(
          (owner: string, repo: string, sha: string, path?: string): Promise<ActionConfig | null> => {
            if (path === ".github/workflows/test.yml") {
              return Promise.resolve({
                name: "Test Workflow",
                jobs: {
                  local: {
                    uses: "./.github/workflows/local.yml",
                  },
                  remote: {
                    steps: [{ uses: "actions/checkout@v4" }],
                  },
                },
              });
            }
            return Promise.resolve(null);
          }
        ),
      });

      const resolver = new Resolver(mockClient);

      const refs: ActionRef[] = [
        {
          owner: "owner",
          repo: "repo",
          ref: "main",
          path: ".github/workflows/test.yml",
          rawUses: "owner/repo/.github/workflows/test.yml@main",
        },
      ];

      const lockfile = await resolver.resolveAll(refs);

      // Should have test.yml and checkout, but not the local workflow
      expect(Object.keys(lockfile.actions)).toHaveLength(2);
      expect(lockfile.actions["owner/repo/.github/workflows/test.yml"]).toBeDefined();
      expect(lockfile.actions["actions/checkout"]).toBeDefined();
    });
  });
});
