import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import { checkAdvisories, printAdvisoryResults } from "./advisory.js";
import type { Lockfile } from "../types.js";
import { GitHubClient } from "../github/client.js";

// Mock fetch for GraphQL API
const originalFetch = globalThis.fetch;
const originalEnv = process.env.GITHUB_TOKEN;

describe("checkAdvisories", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.GITHUB_TOKEN = "test-token";
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    consoleLogSpy.mockRestore();
    if (originalEnv) {
      process.env.GITHUB_TOKEN = originalEnv;
    } else {
      delete process.env.GITHUB_TOKEN;
    }
  });

  test("returns empty result when no token available", async () => {
    delete process.env.GITHUB_TOKEN;

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

    const client = new GitHubClient();
    const result = await checkAdvisories(lockfile, client);

    expect(result.checked).toBe(0);
    expect(result.hasVulnerabilities).toBe(false);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("Skipping advisory check")
    );
  });

  test("returns no vulnerabilities when API returns empty", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            securityVulnerabilities: {
              nodes: [],
            },
          },
        }),
        { status: 200 }
      )
    ) as unknown as typeof fetch;

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

    const client = new GitHubClient("test-token");
    const result = await checkAdvisories(lockfile, client);

    expect(result.checked).toBe(1);
    expect(result.hasVulnerabilities).toBe(false);
    expect(result.actionsWithAdvisories).toHaveLength(0);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("Checking security advisories")
    );
  });

  test("returns vulnerabilities when API returns advisories", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            securityVulnerabilities: {
              nodes: [
                {
                  advisory: {
                    ghsaId: "GHSA-test-1234-5678",
                    summary: "Test vulnerability",
                    severity: "HIGH",
                    permalink: "https://github.com/advisories/GHSA-test-1234-5678",
                  },
                  vulnerableVersionRange: "< 4.0.0",
                },
              ],
            },
          },
        }),
        { status: 200 }
      )
    ) as unknown as typeof fetch;

    const lockfile: Lockfile = {
      version: 1,
      generated: new Date().toISOString(),
      actions: {
        "actions/cache": [
          {
            version: "v3",
            sha: "abc123def456",
            integrity: "sha256-abc123",
            dependencies: [],
          },
        ],
      },
    };

    const client = new GitHubClient("test-token");
    const result = await checkAdvisories(lockfile, client);

    expect(result.checked).toBe(1);
    expect(result.hasVulnerabilities).toBe(true);
    expect(result.actionsWithAdvisories).toHaveLength(1);
    expect(result.actionsWithAdvisories[0]!.action).toBe("actions/cache");
    expect(result.actionsWithAdvisories[0]!.advisories[0]!.ghsaId).toBe(
      "GHSA-test-1234-5678"
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("Checking security advisories")
    );
  });

  test("checks SHA references by resolving to tags", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      callCount++;
      
      // First call: GraphQL query for advisories
      if (url.includes("graphql")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                securityVulnerabilities: {
                  nodes: [
                    {
                      advisory: {
                        ghsaId: "GHSA-sha-test-1234",
                        summary: "SHA test vulnerability",
                        severity: "HIGH",
                        permalink: "https://github.com/advisories/GHSA-sha-test-1234",
                      },
                      vulnerableVersionRange: "< 4.0.0",
                    },
                  ],
                },
              },
            }),
            { status: 200 }
          )
        );
      }
      
      // Second call: tags endpoint to resolve SHA
      if (url.includes("/tags")) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                name: "v3.5.2",
                commit: {
                  sha: "abc123def456789012345678901234567890abcd",
                },
              },
              {
                name: "v4.0.0",
                commit: {
                  sha: "different123456789012345678901234567890ab",
                },
              },
            ]),
            { status: 200 }
          )
        );
      }
      
      return Promise.reject(new Error("Unexpected fetch call"));
    }) as unknown as typeof fetch;

    const lockfile: Lockfile = {
      version: 1,
      generated: new Date().toISOString(),
      actions: {
        "actions/cache": [
          {
            version: "abc123def456789012345678901234567890abcd", // SHA that resolves to v3.5.2
            sha: "abc123def456789012345678901234567890abcd",
            integrity: "sha256-abc123",
            dependencies: [],
          },
        ],
      },
    };

    const client = new GitHubClient("test-token");
    const result = await checkAdvisories(lockfile, client);

    expect(result.checked).toBe(1);
    expect(result.hasVulnerabilities).toBe(true);
    expect(result.actionsWithAdvisories).toHaveLength(1);
    expect(result.actionsWithAdvisories[0]!.action).toBe("actions/cache");
    expect(result.actionsWithAdvisories[0]!.advisories[0]!.ghsaId).toBe(
      "GHSA-sha-test-1234"
    );
    // Should have called GraphQL API and tags endpoint
    expect(callCount).toBe(2);
  });

  test("does not report vulnerabilities for SHA resolving to safe version", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      // GraphQL query for advisories
      if (url.includes("graphql")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                securityVulnerabilities: {
                  nodes: [
                    {
                      advisory: {
                        ghsaId: "GHSA-sha-safe-test",
                        summary: "Test vulnerability",
                        severity: "HIGH",
                        permalink: "https://github.com/advisories/GHSA-sha-safe-test",
                      },
                      vulnerableVersionRange: "< 4.0.0",
                    },
                  ],
                },
              },
            }),
            { status: 200 }
          )
        );
      }
      
      // Tags endpoint - SHA resolves to v4.1.0 (safe version)
      if (url.includes("/tags")) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                name: "v4.1.0",
                commit: {
                  sha: "def789012345678901234567890123456789abcd",
                },
              },
            ]),
            { status: 200 }
          )
        );
      }
      
      return Promise.reject(new Error("Unexpected fetch call"));
    }) as unknown as typeof fetch;

    const lockfile: Lockfile = {
      version: 1,
      generated: new Date().toISOString(),
      actions: {
        "actions/cache": [
          {
            version: "def789012345678901234567890123456789abcd", // SHA that resolves to v4.1.0
            sha: "def789012345678901234567890123456789abcd",
            integrity: "sha256-def789",
            dependencies: [],
          },
        ],
      },
    };

    const client = new GitHubClient("test-token");
    const result = await checkAdvisories(lockfile, client);

    expect(result.checked).toBe(1);
    expect(result.hasVulnerabilities).toBe(false);
    expect(result.actionsWithAdvisories).toHaveLength(0);
  });

  test("continues on API errors", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("Network error")) as unknown as typeof fetch;

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

    const client = new GitHubClient("test-token");
    const result = await checkAdvisories(lockfile, client);

    // Should return 0 checked since all failed
    expect(result.checked).toBe(0);
    expect(result.hasVulnerabilities).toBe(false);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("Checking security advisories")
    );
  });
});

describe("printAdvisoryResults", () => {
  const originalLog = console.log;

  beforeEach(() => {
    console.log = vi.fn();
  });

  afterEach(() => {
    console.log = originalLog;
  });

  test("prints nothing when no actions checked", () => {
    printAdvisoryResults({
      checked: 0,
      actionsWithAdvisories: [],
      hasVulnerabilities: false,
    });

    // Should not print anything
    expect(console.log).not.toHaveBeenCalled();
  });

  test("prints success message when no vulnerabilities", () => {
    printAdvisoryResults({
      checked: 5,
      actionsWithAdvisories: [],
      hasVulnerabilities: false,
    });

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("No known vulnerabilities")
    );
  });

  test("prints vulnerability details when found", () => {
    printAdvisoryResults({
      checked: 1,
      actionsWithAdvisories: [
        {
          action: "actions/cache",
          version: "v3",
          advisories: [
            {
              ghsaId: "GHSA-test-1234",
              severity: "HIGH",
              summary: "Test vulnerability",
              vulnerableVersionRange: "< 4.0.0",
              permalink: "https://github.com/advisories/GHSA-test-1234",
            },
          ],
        },
      ],
      hasVulnerabilities: true,
    });

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("Security advisories found")
    );
  });
});
