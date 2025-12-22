import { describe, expect, test, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { copyFixture } from "./__fixtures__/helpers.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, "index.ts");

async function runCli(args: string[], cwd?: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn("npx", ["tsx", CLI_PATH, ...args], {
      cwd,
      env: {
        ...process.env,
        // Disable GitHub token to avoid real API calls
        GITHUB_TOKEN: "",
      },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => { stdout += data.toString(); });
    proc.stderr.on("data", (data) => { stderr += data.toString(); });

    proc.on("close", (exitCode) => {
      resolve({ stdout, stderr, exitCode: exitCode ?? 1 });
    });
  });
}

describe("CLI", () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "cli-test-"));
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true });
  });

  describe("--help", () => {
    test("shows help with --help flag", async () => {
      const { stdout, exitCode } = await runCli(["--help"]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("gh-actions-lockfile");
      expect(stdout).toContain("Generate and verify lockfiles");
    });

    test("shows help with -h flag", async () => {
      const { stdout, exitCode } = await runCli(["-h"]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("gh-actions-lockfile");
    });
  });

  describe("--version", () => {
    test("shows version with --version flag", async () => {
      const { stdout, exitCode } = await runCli(["--version"]);

      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/\d+\.\d+\.\d+/);
    });

    test("shows version with -V flag", async () => {
      const { stdout, exitCode } = await runCli(["-V"]);

      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/\d+\.\d+\.\d+/);
    });
  });

  describe("generate command", () => {
    test("recognizes generate command", async () => {
      const { stdout } = await runCli(["generate", "--help"]);

      expect(stdout).toContain("Generate or update the lockfile");
      expect(stdout).toContain("--workflows");
      expect(stdout).toContain("--output");
      expect(stdout).toContain("--token");
    });

    test("returns exit code 2 on error", async () => {
      // Run generate on non-existent directory
      const { exitCode, stderr } = await runCli([
        "generate",
        "-w",
        "/nonexistent/path",
      ]);

      expect(exitCode).toBe(2);
      expect(stderr).toContain("Error");
    });
  });

  describe("verify command", () => {
    test("recognizes verify command", async () => {
      const { stdout } = await runCli(["verify", "--help"]);

      expect(stdout).toContain("Verify workflows match the lockfile");
      expect(stdout).toContain("--workflows");
      expect(stdout).toContain("--output");
    });

    test("returns exit code 2 when lockfile not found", async () => {
      // Create workflow dir without lockfile
      const testDir = join(tempDir, "verify-test");
      const workflowDir = join(testDir, ".github", "workflows");
      await mkdir(workflowDir, { recursive: true });
      await copyFixture("index/workflow-verify-test.yml", join(workflowDir, "ci.yml"));

      const { exitCode, stderr } = await runCli(
        ["verify", "-w", workflowDir],
        testDir
      );

      expect(exitCode).toBe(2);
      expect(stderr).toContain("Error");
    });
  });

  describe("list command", () => {
    test("recognizes list command", async () => {
      const { stdout } = await runCli(["list", "--help"]);

      expect(stdout).toContain("Display the dependency tree");
      expect(stdout).toContain("--workflows");
      expect(stdout).toContain("--output");
    });

    test("returns exit code 2 when lockfile not found", async () => {
      const testDir = join(tempDir, "list-test");
      const workflowDir = join(testDir, ".github", "workflows");
      await mkdir(workflowDir, { recursive: true });

      const { exitCode, stderr } = await runCli(
        ["list", "-w", workflowDir],
        testDir
      );

      expect(exitCode).toBe(2);
      expect(stderr).toContain("Error");
    });

    test("displays lockfile tree when lockfile exists", async () => {
      const testDir = join(tempDir, "list-with-lockfile");
      const workflowDir = join(testDir, ".github", "workflows");
      await mkdir(workflowDir, { recursive: true });

      await copyFixture("index/lockfile-cli-test.json", join(workflowDir, "actions.lock.json"));

      const { stdout, exitCode } = await runCli(
        ["list", "-w", workflowDir, "-o", join(workflowDir, "actions.lock.json")],
        testDir
      );

      expect(exitCode).toBe(0);
      expect(stdout).toContain("actions/checkout@v4");
    });
  });

  describe("unknown command", () => {
    test("shows error for unknown command", async () => {
      const { stderr, exitCode } = await runCli(["unknown"]);

      // Commander exits with 1 for unknown commands
      expect(exitCode).toBe(1);
      expect(stderr).toContain("unknown");
    });
  });

  describe("option handling", () => {
    test("accepts short option -w for workflows", async () => {
      const { stdout } = await runCli(["generate", "--help"]);
      expect(stdout).toContain("-w, --workflows");
    });

    test("accepts short option -o for output", async () => {
      const { stdout } = await runCli(["generate", "--help"]);
      expect(stdout).toContain("-o, --output");
    });

    test("accepts short option -t for token", async () => {
      const { stdout } = await runCli(["generate", "--help"]);
      expect(stdout).toContain("-t, --token");
    });
  });
});
