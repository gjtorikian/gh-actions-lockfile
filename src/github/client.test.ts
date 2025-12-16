import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { GitHubClient } from "./client.js";

// Mock fetch globally
const originalFetch = globalThis.fetch;
let mockFetch: ReturnType<typeof mock>;

function setupMockFetch() {
  mockFetch = mock(() => Promise.resolve(new Response()));
  globalThis.fetch = mockFetch as unknown as typeof fetch;
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

function mockResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockTextResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain" },
  });
}

function mockBinaryResponse(data: Uint8Array, status = 200) {
  return new Response(new Blob([data as BlobPart]), {
    status,
    headers: { "Content-Type": "application/octet-stream" },
  });
}

describe("GitHubClient", () => {
  beforeEach(() => {
    setupMockFetch();
  });

  afterEach(() => {
    restoreFetch();
  });

  describe("resolveRef", () => {
    test("resolves lightweight tag to SHA", async () => {
      const sha = "b4ffde65f46336ab88eb53be808477a3936bae11";
      mockFetch.mockImplementation((url: string) => {
        if (url.includes("/git/refs/tags/v4")) {
          return Promise.resolve(
            mockResponse({
              ref: "refs/tags/v4",
              object: { sha, type: "commit" },
            })
          );
        }
        return Promise.resolve(new Response(null, { status: 404 }));
      });

      const client = new GitHubClient("test-token");
      const result = await client.resolveRef("actions", "checkout", "v4");
      expect(result).toBe(sha);
    });

    test("dereferences annotated tag", async () => {
      const tagSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const commitSha = "b4ffde65f46336ab88eb53be808477a3936bae11";

      mockFetch.mockImplementation((url: string) => {
        if (url.includes("/git/refs/tags/v4")) {
          return Promise.resolve(
            mockResponse({
              ref: "refs/tags/v4",
              object: { sha: tagSha, type: "tag" },
            })
          );
        }
        if (url.includes(`/git/tags/${tagSha}`)) {
          return Promise.resolve(
            mockResponse({
              object: { sha: commitSha, type: "commit" },
            })
          );
        }
        return Promise.resolve(new Response(null, { status: 404 }));
      });

      const client = new GitHubClient("test-token");
      const result = await client.resolveRef("actions", "checkout", "v4");
      expect(result).toBe(commitSha);
    });

    test("falls back to branch if tag not found", async () => {
      const sha = "b4ffde65f46336ab88eb53be808477a3936bae11";
      mockFetch.mockImplementation((url: string) => {
        if (url.includes("/git/refs/tags/")) {
          return Promise.resolve(new Response(null, { status: 404 }));
        }
        if (url.includes("/git/refs/heads/main")) {
          return Promise.resolve(
            mockResponse({
              ref: "refs/heads/main",
              object: { sha, type: "commit" },
            })
          );
        }
        return Promise.resolve(new Response(null, { status: 404 }));
      });

      const client = new GitHubClient("test-token");
      const result = await client.resolveRef("owner", "repo", "main");
      expect(result).toBe(sha);
    });

    test("returns SHA directly if 40-char hex", async () => {
      const sha = "b4ffde65f46336ab88eb53be808477a3936bae11";
      mockFetch.mockImplementation(() => {
        return Promise.resolve(new Response(null, { status: 404 }));
      });

      const client = new GitHubClient("test-token");
      const result = await client.resolveRef("actions", "checkout", sha);
      expect(result).toBe(sha);
    });

    test("throws if ref not found", async () => {
      mockFetch.mockImplementation(() => {
        return Promise.resolve(new Response(null, { status: 404 }));
      });

      const client = new GitHubClient("test-token");
      await expect(
        client.resolveRef("owner", "repo", "nonexistent")
      ).rejects.toThrow('Could not resolve ref "nonexistent"');
    });

    test("throws helpful error on rate limit", async () => {
      mockFetch.mockImplementation(() => {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              message: "API rate limit exceeded for 1.2.3.4",
              documentation_url: "https://docs.github.com/rest/overview/resources-in-the-rest-api#rate-limiting",
            }),
            { status: 403 }
          )
        );
      });

      const client = new GitHubClient("test-token");
      await expect(
        client.resolveRef("owner", "repo", "v1")
      ).rejects.toThrow("rate limit exceeded");
      await expect(
        client.resolveRef("owner", "repo", "v1")
      ).rejects.toThrow("GITHUB_TOKEN");
    });
  });

  describe("getActionConfig", () => {
    test("fetches action.yml", async () => {
      const actionYml = `name: Test Action
description: A test action
runs:
  using: node20
  main: dist/index.js
`;
      mockFetch.mockImplementation((url: string) => {
        if (url.includes("/contents/action.yml")) {
          return Promise.resolve(
            mockResponse({
              download_url: "https://raw.githubusercontent.com/owner/repo/sha/action.yml",
            })
          );
        }
        if (url.includes("raw.githubusercontent.com")) {
          return Promise.resolve(mockTextResponse(actionYml));
        }
        return Promise.resolve(new Response(null, { status: 404 }));
      });

      const client = new GitHubClient("test-token");
      const result = await client.getActionConfig("owner", "repo", "abc123");
      expect(result).not.toBeNull();
      expect(result?.name).toBe("Test Action");
      expect(result?.runs?.using).toBe("node20");
    });

    test("falls back to action.yaml if action.yml not found", async () => {
      const actionYaml = `name: YAML Extension
description: Uses .yaml
runs:
  using: composite
  steps: []
`;
      mockFetch.mockImplementation((url: string) => {
        if (url.includes("/contents/action.yml")) {
          return Promise.resolve(new Response(null, { status: 404 }));
        }
        if (url.includes("/contents/action.yaml")) {
          return Promise.resolve(
            mockResponse({
              download_url: "https://raw.githubusercontent.com/owner/repo/sha/action.yaml",
            })
          );
        }
        if (url.includes("raw.githubusercontent.com")) {
          return Promise.resolve(mockTextResponse(actionYaml));
        }
        return Promise.resolve(new Response(null, { status: 404 }));
      });

      const client = new GitHubClient("test-token");
      const result = await client.getActionConfig("owner", "repo", "abc123");
      expect(result).not.toBeNull();
      expect(result?.name).toBe("YAML Extension");
    });

    test("returns null if neither action.yml nor action.yaml exists", async () => {
      mockFetch.mockImplementation(() => {
        return Promise.resolve(new Response(null, { status: 404 }));
      });

      const client = new GitHubClient("test-token");
      const result = await client.getActionConfig("owner", "repo", "abc123");
      expect(result).toBeNull();
    });

    test("handles nested path", async () => {
      const actionYml = `name: Nested Action
runs:
  using: node20
  main: index.js
`;
      mockFetch.mockImplementation((url: string) => {
        if (url.includes("/contents/subpath/action.yml")) {
          return Promise.resolve(
            mockResponse({
              download_url: "https://raw.githubusercontent.com/owner/repo/sha/subpath/action.yml",
            })
          );
        }
        if (url.includes("raw.githubusercontent.com")) {
          return Promise.resolve(mockTextResponse(actionYml));
        }
        return Promise.resolve(new Response(null, { status: 404 }));
      });

      const client = new GitHubClient("test-token");
      const result = await client.getActionConfig("owner", "repo", "abc123", "subpath");
      expect(result).not.toBeNull();
      expect(result?.name).toBe("Nested Action");
    });
  });

  describe("getArchiveSHA256", () => {
    test("computes correct SHA256 hash", async () => {
      // Create a simple test tarball content
      const testData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

      mockFetch.mockImplementation((url: string) => {
        if (url.includes("/tarball/")) {
          return Promise.resolve(mockBinaryResponse(testData));
        }
        return Promise.resolve(new Response(null, { status: 404 }));
      });

      const client = new GitHubClient("test-token");
      const result = await client.getArchiveSHA256("owner", "repo", "abc123");

      expect(result).toMatch(/^sha256-[a-f0-9]{64}$/);
    });

    test("returns sha256- prefix format", async () => {
      const testData = new Uint8Array([0]);

      mockFetch.mockImplementation((url: string) => {
        if (url.includes("/tarball/")) {
          return Promise.resolve(mockBinaryResponse(testData));
        }
        return Promise.resolve(new Response(null, { status: 404 }));
      });

      const client = new GitHubClient("test-token");
      const result = await client.getArchiveSHA256("owner", "repo", "abc123");

      expect(result.startsWith("sha256-")).toBe(true);
      // SHA256 produces 64 hex characters
      expect(result.length).toBe(7 + 64); // "sha256-" + 64 chars
    });

    test("throws on failed download", async () => {
      mockFetch.mockImplementation(() => {
        return Promise.resolve(new Response(null, { status: 500 }));
      });

      const client = new GitHubClient("test-token");
      await expect(
        client.getArchiveSHA256("owner", "repo", "abc123")
      ).rejects.toThrow("Failed to download tarball");
    });
  });

  describe("authentication", () => {
    test("sends Authorization header with token", async () => {
      let capturedHeaders: Headers | undefined;
      mockFetch.mockImplementation((url: string, options?: RequestInit) => {
        capturedHeaders = new Headers(options?.headers);
        return Promise.resolve(new Response(null, { status: 404 }));
      });

      const client = new GitHubClient("my-secret-token");
      try {
        await client.resolveRef("owner", "repo", "v1");
      } catch {
        // Expected to fail
      }

      expect(capturedHeaders?.get("Authorization")).toBe("Bearer my-secret-token");
    });

    test("sends Accept header for GitHub API", async () => {
      let capturedHeaders: Headers | undefined;
      mockFetch.mockImplementation((url: string, options?: RequestInit) => {
        capturedHeaders = new Headers(options?.headers);
        return Promise.resolve(new Response(null, { status: 404 }));
      });

      const client = new GitHubClient("token");
      try {
        await client.resolveRef("owner", "repo", "v1");
      } catch {
        // Expected to fail
      }

      expect(capturedHeaders?.get("Accept")).toBe("application/vnd.github+json");
    });
  });
});
