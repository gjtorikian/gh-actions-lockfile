import { describe, expect, test } from "vitest";
import { join, dirname } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Use compiled JS for faster execution (no tsx compilation overhead)
const CLI_PATH = join(__dirname, "../dist/cli.js");

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn("node", [CLI_PATH, ...args], {
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

// Minimal CLI smoke tests - only tests CLI-specific behavior
// Command logic is tested in src/commands/*.test.ts
describe("CLI", () => {
  test("shows help and version", async () => {
    const [help, helpShort, version] = await Promise.all([
      runCli(["--help"]),
      runCli(["-h"]),
      runCli(["--version"]),
    ]);

    // --help
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain("gh-actions-lockfile");
    expect(help.stdout).toContain("COMMANDS:");
    expect(help.stdout).toContain("Generate or update the lockfile");

    // -h (short form)
    expect(helpShort.exitCode).toBe(0);
    expect(helpShort.stdout).toContain("gh-actions-lockfile");

    // --version
    expect(version.exitCode).toBe(0);
    expect(version.stdout).toMatch(/\d+\.\d+\.\d+/);
  });

  test("recognizes all commands with correct options", async () => {
    const [generate, verify, list] = await Promise.all([
      runCli(["generate", "--help"]),
      runCli(["verify", "--help"]),
      runCli(["list", "--help"]),
    ]);

    // generate command
    expect(generate.stdout).toContain("Generate or update the lockfile");
    expect(generate.stdout).toContain("-w, --workflows");
    expect(generate.stdout).toContain("-o, --output");
    expect(generate.stdout).toContain("-t, --token");

    // verify command
    expect(verify.stdout).toContain("Verify workflows match the lockfile");
    expect(verify.stdout).toContain("-w, --workflows");
    expect(verify.stdout).toContain("-o, --output");

    // list command
    expect(list.stdout).toContain("Display the dependency tree");
    expect(list.stdout).toContain("-w, --workflows");
    expect(list.stdout).toContain("-o, --output");
  });

  test("shows error for unknown command", async () => {
    const { stderr, exitCode } = await runCli(["unknown"]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Unknown command");
  });
});
