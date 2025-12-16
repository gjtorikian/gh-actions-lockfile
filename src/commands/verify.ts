import { join, dirname, isAbsolute } from "node:path";
import { readLockfile, verify, printVerifyResult } from "../lockfile/lockfile.js";
import { parseWorkflowDir } from "../parser/workflow.js";
import { findWorkflowDir } from "../utils/directory.js";

interface VerifyOptions {
  workflows: string;
  output: string;
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
    process.exit(1);
  }
}
