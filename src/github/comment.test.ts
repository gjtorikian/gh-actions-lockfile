import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { postOrUpdatePRComment } from "./comment.js";
import type { VerifyResult } from "../types.js";

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

describe("postOrUpdatePRComment", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    setupMockFetch();
    process.env.GITHUB_REPOSITORY = "owner/repo";
    process.env.GITHUB_TOKEN = "test-token";
  });

  afterEach(() => {
    restoreFetch();
    process.env = { ...originalEnv };
  });

  test("creates new comment when no existing comment found", async () => {
    let createdBody: string | undefined;

    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes("/issues/42/comments") && options?.method === "POST") {
        createdBody = JSON.parse(options.body as string).body;
        return Promise.resolve(mockResponse({ id: 1 }, 201));
      }
      if (url.includes("/issues/42/comments")) {
        return Promise.resolve(mockResponse([]));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });

    const result: VerifyResult = {
      match: false,
      newActions: [{ action: "actions/checkout", newVersion: "v4" }],
      changed: [],
      removed: [],
    };

    await postOrUpdatePRComment(42, result);

    expect(createdBody).toContain("<!-- gh-actions-lockfile-comment -->");
    expect(createdBody).toContain("Actions Lockfile Mismatch");
    expect(createdBody).toContain("`actions/checkout@v4`");
  });

  test("updates existing comment with marker", async () => {
    let updatedBody: string | undefined;
    const existingComment = {
      id: 123,
      body: "<!-- gh-actions-lockfile-comment -->\nOld content",
    };

    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes("/issues/comments/123") && options?.method === "PATCH") {
        updatedBody = JSON.parse(options.body as string).body;
        return Promise.resolve(mockResponse({ id: 123 }));
      }
      if (url.includes("/issues/42/comments")) {
        return Promise.resolve(mockResponse([existingComment]));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });

    const result: VerifyResult = {
      match: false,
      newActions: [],
      changed: [],
      removed: [{ action: "actions/cache", oldVersion: "v3", oldSha: "abc123" }],
    };

    await postOrUpdatePRComment(42, result);

    expect(updatedBody).toContain("<!-- gh-actions-lockfile-comment -->");
    expect(updatedBody).toContain("`actions/cache@v3`");
    expect(updatedBody).toContain("view commit");
  });

  test("throws when GITHUB_REPOSITORY not set", async () => {
    delete process.env.GITHUB_REPOSITORY;

    const result: VerifyResult = {
      match: false,
      newActions: [],
      changed: [],
      removed: [],
    };

    await expect(postOrUpdatePRComment(42, result)).rejects.toThrow(
      "GITHUB_REPOSITORY environment variable not set"
    );
  });

  test("throws when GITHUB_TOKEN not set", async () => {
    delete process.env.GITHUB_TOKEN;

    const result: VerifyResult = {
      match: false,
      newActions: [],
      changed: [],
      removed: [],
    };

    await expect(postOrUpdatePRComment(42, result)).rejects.toThrow(
      "GITHUB_TOKEN environment variable not set"
    );
  });

  test("formats comment with all change types", async () => {
    let createdBody: string | undefined;

    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes("/issues/42/comments") && options?.method === "POST") {
        createdBody = JSON.parse(options.body as string).body;
        return Promise.resolve(mockResponse({ id: 1 }, 201));
      }
      if (url.includes("/issues/42/comments")) {
        return Promise.resolve(mockResponse([]));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });

    const result: VerifyResult = {
      match: false,
      newActions: [{ action: "actions/setup-node", newVersion: "v4" }],
      changed: [
        {
          action: "actions/checkout",
          oldVersion: "v3",
          newVersion: "v4",
          oldSha: "aaa",
          newSha: "bbb",
        },
      ],
      removed: [{ action: "actions/cache", oldVersion: "v3", oldSha: "ccc" }],
    };

    await postOrUpdatePRComment(42, result);

    expect(createdBody).toContain("### New Actions");
    expect(createdBody).toContain("`actions/setup-node@v4`");
    expect(createdBody).toContain("### Changed Actions");
    expect(createdBody).toContain("compare");
    expect(createdBody).toContain("https://github.com/actions/checkout/compare/aaa...bbb");
    expect(createdBody).toContain("### Removed Actions");
    expect(createdBody).toContain("view commit");
    expect(createdBody).toContain("https://github.com/actions/cache/commit/ccc");
  });

  test("counts total affected actions in summary", async () => {
    let createdBody: string | undefined;

    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes("/issues/42/comments") && options?.method === "POST") {
        createdBody = JSON.parse(options.body as string).body;
        return Promise.resolve(mockResponse({ id: 1 }, 201));
      }
      if (url.includes("/issues/42/comments")) {
        return Promise.resolve(mockResponse([]));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });

    const result: VerifyResult = {
      match: false,
      newActions: [
        { action: "a", newVersion: "v1" },
        { action: "b", newVersion: "v1" },
      ],
      changed: [{ action: "c", oldVersion: "v1", newVersion: "v2" }],
      removed: [],
    };

    await postOrUpdatePRComment(42, result);

    expect(createdBody).toContain("3 actions affected");
  });

  test("uses singular 'action' for single change", async () => {
    let createdBody: string | undefined;

    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes("/issues/42/comments") && options?.method === "POST") {
        createdBody = JSON.parse(options.body as string).body;
        return Promise.resolve(mockResponse({ id: 1 }, 201));
      }
      if (url.includes("/issues/42/comments")) {
        return Promise.resolve(mockResponse([]));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });

    const result: VerifyResult = {
      match: false,
      newActions: [{ action: "a", newVersion: "v1" }],
      changed: [],
      removed: [],
    };

    await postOrUpdatePRComment(42, result);

    expect(createdBody).toContain("1 action affected");
  });

  test("throws on API error when creating comment", async () => {
    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url.includes("/issues/42/comments") && options?.method === "POST") {
        return Promise.resolve(
          new Response("Forbidden", { status: 403 })
        );
      }
      if (url.includes("/issues/42/comments")) {
        return Promise.resolve(mockResponse([]));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });

    const result: VerifyResult = {
      match: false,
      newActions: [{ action: "a", newVersion: "v1" }],
      changed: [],
      removed: [],
    };

    await expect(postOrUpdatePRComment(42, result)).rejects.toThrow(
      "Failed to create comment: 403"
    );
  });
});
