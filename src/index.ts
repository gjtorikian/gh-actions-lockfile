import { Command } from "commander";
import { generate } from "./commands/generate.js";
import { verifyCommand } from "./commands/verify.js";
import { list } from "./commands/list.js";
import { DEFAULT_PATH } from "./lockfile/lockfile.js";
import pkg from "../package.json";

const program = new Command();

program
  .name("gh-actions-lockfile")
  .description(
    "Generate and verify lockfiles for GitHub Actions dependencies."
  )
  .version(pkg.version);

// Global options
const workflowsOption = [
  "-w, --workflows <path>",
  "Path to workflows directory",
  ".github/workflows",
] as const;

const outputOption = ["-o, --output <path>", "Path to lockfile", DEFAULT_PATH] as const;

const tokenOption = [
  "-t, --token <token>",
  "GitHub token (or use GITHUB_TOKEN env var)",
] as const;

program
  .command("generate")
  .description("Generate or update the lockfile")
  .option(...workflowsOption)
  .option(...outputOption)
  .option(...tokenOption)
  .action(async (options) => {
    try {
      await generate(options);
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : error);
      process.exit(2);
    }
  });

program
  .command("verify")
  .description("Verify workflows match the lockfile")
  .option(...workflowsOption)
  .option(...outputOption)
  .option("-c, --comment", "Post PR comment on verification failure", true)
  .action(async (options) => {
    try {
      await verifyCommand(options);
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : error);
      process.exit(2);
    }
  });

program
  .command("list")
  .description("Display the dependency tree of all locked actions")
  .option(...workflowsOption)
  .option(...outputOption)
  .action(async (options) => {
    try {
      await list(options);
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : error);
      process.exit(2);
    }
  });

program.parse();
