import { join, dirname, isAbsolute } from "node:path";
import { readLockfile } from "../lockfile/lockfile.js";
import { getFullName, parseActionRef } from "../parser/workflow.js";
import type { Lockfile, LockedAction } from "../types.js";

interface ListOptions {
  workflows: string;
  output: string;
}

export async function list(options: ListOptions): Promise<void> {
  const workflowDir = await findWorkflowDir(options.workflows);

  // Determine lockfile path
  let lockfilePath = options.output;
  if (!isAbsolute(lockfilePath)) {
    const repoRoot = dirname(dirname(workflowDir));
    lockfilePath = join(repoRoot, lockfilePath);
  }

  const lockfile = await readLockfile(lockfilePath);

  // Build set of transitive deps to identify top-level
  const transitiveDeps = new Set<string>();
  for (const action of Object.values(lockfile.actions)) {
    for (const dep of action.dependencies) {
      const depRef = parseActionRef(dep.ref);
      if (depRef) {
        transitiveDeps.add(getFullName(depRef));
      }
    }
  }

  // Print header
  const generated = new Date(lockfile.generated);
  console.log(`actions.lock.json (generated ${generated.toISOString().replace("T", " ").slice(0, 19)})`);
  console.log();

  // Print tree
  const topLevelActions = Object.entries(lockfile.actions).filter(
    ([name]) => !transitiveDeps.has(name)
  );

  for (let i = 0; i < topLevelActions.length; i++) {
    const [name, action] = topLevelActions[i]!;
    const isLast = i === topLevelActions.length - 1;
    printAction(name, action, lockfile, "", isLast);
  }
}

function printAction(
  name: string,
  action: LockedAction,
  lockfile: Lockfile,
  prefix: string,
  last: boolean
): void {
  const branch = last ? "└── " : "├── ";
  const childPrefix = last ? "    " : "│   ";

  const sha = action.sha.slice(0, 12);
  console.log(`${prefix}${branch}${name}@${action.version} (${sha})`);

  for (let i = 0; i < action.dependencies.length; i++) {
    const dep = action.dependencies[i]!;
    const depRef = parseActionRef(dep.ref);
    if (!depRef) continue;

    const depName = getFullName(depRef);
    const depAction = lockfile.actions[depName];
    if (!depAction) continue;

    const isLast = i === action.dependencies.length - 1;
    printAction(depName, depAction, lockfile, prefix + childPrefix, isLast);
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
