import { execSync } from "node:child_process";

import * as core from "@actions/core";

import { generate } from "./commands/generate.js";
import { verifyCommand } from "./commands/verify.js";

async function run(): Promise<void> {
  try {
    const mode = core.getInput("mode", { required: true });
    const token = core.getInput("token") || undefined;
    const workflows = core.getInput("workflows") || ".github/workflows";
    const output = core.getInput("output") || ".github/actions.lock.json";
    const comment = core.getInput("comment") === "true";
    const requireSha = core.getInput("require-sha") === "true";
    const skipSha = core.getInput("skip-sha") === "true";
    const skipIntegrity = core.getInput("skip-integrity") === "true";
    const skipAdvisories = core.getInput("skip-advisories") === "true";

    if (token) {
      process.env.GITHUB_TOKEN = token;
    }

    if (mode === "generate") {
      await generate({ workflows, output, token, requireSha });
      // Compute changed output
      try {
        execSync(`git diff --quiet "${output}"`, { stdio: "pipe" });
        core.setOutput("changed", "false");
      } catch {
        core.setOutput("changed", "true");
      }
    } else if (mode === "verify") {
      await verifyCommand({ workflows, output, comment, skipSha, skipIntegrity, skipAdvisories });
    } else {
      throw new Error(`Unknown mode: ${mode}. Use 'generate' or 'verify'.`);
    }
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

run();
