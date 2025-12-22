import { join, dirname, isAbsolute } from "node:path";
import { readLockfile, verify, printVerifyResult } from "../lockfile/lockfile.js";
import { parseWorkflowDir } from "../parser/workflow.js";
import { findWorkflowDir } from "../utils/directory.js";
import { postOrUpdatePRComment } from "../github/comment.js";
import { getPRNumber } from "../github/context.js";
import type { VerifyResult } from "../types.js";

interface VerifyOptions {
  workflows: string;
  output: string;
  comment?: boolean;
}

export async function verifyCommand(options: VerifyOptions): Promise<void> {
  const workflowDir = await findWorkflowDir(options.workflows);

  // Determine lockfile path
  let lockfilePath = options.output;
  if (!isAbsolute(lockfilePath)) {
    const repoRoot = dirname(dirname(workflowDir));
    lockfilePath = join(repoRoot, lockfilePath);
  }

  const lockfile = await readLockfile(lockfilePath);
  const workflows = await parseWorkflowDir(workflowDir);

  const result = verify(workflows, lockfile);
  printVerifyResult(result);

  if (!result.match) {
    // Post PR comment if enabled
    if (options.comment) {
      await postPRCommentIfApplicable(result);
    }
    process.exit(1);
  }
}

async function postPRCommentIfApplicable(result: VerifyResult): Promise<void> {
  const prNumber = getPRNumber();
  if (!prNumber) {
    console.log("Not running in PR context, skipping comment");
    return;
  }

  try {
    await postOrUpdatePRComment(prNumber, result);
    console.log(`Posted lockfile mismatch comment on PR #${prNumber}`);
  } catch (error) {
    console.error(
      "Failed to post PR comment:",
      error instanceof Error ? error.message : error
    );
    // Don't fail the action if commenting fails
  }
}
