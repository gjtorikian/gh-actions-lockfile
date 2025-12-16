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
      expect(lockfile.actions["actions/checkout"]).toEqual({
        version: "v4",
        sha,
        integrity,
        dependencies: [],
      });
    });

    test("returns empty lockfile for no refs", async () => {
      const mockClient = createMockClient();
      const resolver = new Resolver(mockClient);

      const lockfile = await resolver.resolveAll([]);

      expect(lockfile.version).toBe(1);
      expect(lockfile.actions).toEqual({});
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
      expect(lockfile.actions["owner/composite"]!.dependencies).toHaveLength(2);
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
      expect(lockfile.actions["owner/node-action"]!.dependencies).toEqual([]);
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
      expect(lockfile.actions["actions/checkout"]!.integrity).toBe("");
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
});
