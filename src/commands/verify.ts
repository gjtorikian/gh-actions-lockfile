import { join, dirname, isAbsolute } from "node:path";
import { readLockfile, verify, printVerifyResult } from "../lockfile/lockfile.js";
import { parseWorkflowDir } from "../parser/workflow.js";

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

async function findWorkflowDir(dir: string): Promise<string> {
  if (isAbsolute(dir)) {
    return dir;
  }

  const cwd = process.cwd();

  // Try current directory
  let path = join(cwd, dir);
  if (await directoryExists(path)) {
    return path;
  }

  // Try to find .github in parent directories
  let current = cwd;
  while (true) {
    path = join(current, ".github", "workflows");
    if (await directoryExists(path)) {
      return path;
    }

    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  throw new Error(`Workflow directory not found: ${dir} (searched from ${cwd})`);
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    const { readdir } = await import("node:fs/promises");
    await readdir(path);
    return true;
  } catch {
    return false;
  }
}
