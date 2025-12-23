import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { getPRNumber } from "./context.js";
import { writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("getPRNumber", () => {
  const originalEnv = { ...process.env };
  let tempDir: string;
  let tempFile: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "context-test-"));
    tempFile = join(tempDir, "event.json");
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    try {
      unlinkSync(tempFile);
    } catch {
      // File may not exist
    }
  });

  test("returns null when GITHUB_EVENT_PATH not set", () => {
    delete process.env.GITHUB_EVENT_PATH;
    expect(getPRNumber()).toBeNull();
  });

  test("returns PR number from pull_request event", () => {
    const event = { pull_request: { number: 42 } };
    writeFileSync(tempFile, JSON.stringify(event));
    process.env.GITHUB_EVENT_PATH = tempFile;

    expect(getPRNumber()).toBe(42);
  });

  test("returns PR number from issue_comment event", () => {
    const event = { issue: { number: 123 } };
    writeFileSync(tempFile, JSON.stringify(event));
    process.env.GITHUB_EVENT_PATH = tempFile;

    expect(getPRNumber()).toBe(123);
  });

  test("returns PR number from direct number property", () => {
    const event = { number: 456 };
    writeFileSync(tempFile, JSON.stringify(event));
    process.env.GITHUB_EVENT_PATH = tempFile;

    expect(getPRNumber()).toBe(456);
  });

  test("prefers pull_request.number over other sources", () => {
    const event = { pull_request: { number: 1 }, issue: { number: 2 }, number: 3 };
    writeFileSync(tempFile, JSON.stringify(event));
    process.env.GITHUB_EVENT_PATH = tempFile;

    expect(getPRNumber()).toBe(1);
  });

  test("returns null for event without PR number", () => {
    const event = { action: "push", ref: "refs/heads/main" };
    writeFileSync(tempFile, JSON.stringify(event));
    process.env.GITHUB_EVENT_PATH = tempFile;

    expect(getPRNumber()).toBeNull();
  });

  test("returns null when event file doesn't exist", () => {
    process.env.GITHUB_EVENT_PATH = "/nonexistent/path/event.json";
    expect(getPRNumber()).toBeNull();
  });

  test("returns null when event file contains invalid JSON", () => {
    writeFileSync(tempFile, "not valid json");
    process.env.GITHUB_EVENT_PATH = tempFile;

    expect(getPRNumber()).toBeNull();
  });
});

