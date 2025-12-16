import { dirname, isAbsolute, join } from "node:path";
import { readLockfile } from "../lockfile/lockfile.js";
import { getFullName, parseActionRef } from "../parser/workflow.js";
import type { Lockfile, LockedAction } from "../types.js";
import { findWorkflowDir } from "../utils/directory.js";

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

  // Build set of transitive deps to identify top-level (as "name@version")
  const transitiveDeps = new Set<string>();
  for (const versions of Object.values(lockfile.actions)) {
    for (const action of versions) {
      for (const dep of action.dependencies) {
        const depRef = parseActionRef(dep.ref);
        if (depRef) {
          transitiveDeps.add(`${getFullName(depRef)}@${depRef.ref}`);
        }
      }
    }
  }

  // Print header
  const generated = new Date(lockfile.generated);
  console.log(`actions.lock.json (generated ${generated.toISOString().replace("T", " ").slice(0, 19)})`);
  console.log();

  // Collect top-level actions (not transitive deps)
  const topLevelActions: Array<{ name: string; action: LockedAction }> = [];
  for (const [name, versions] of Object.entries(lockfile.actions)) {
    for (const action of versions) {
      const key = `${name}@${action.version}`;
      if (!transitiveDeps.has(key)) {
        topLevelActions.push({ name, action });
      }
    }
  }

  // Print tree
  for (let i = 0; i < topLevelActions.length; i++) {
    const { name, action } = topLevelActions[i]!;
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
    // Find the specific version in the array
    const depAction = lockfile.actions[depName]?.find(a => a.version === depRef.ref);
    if (!depAction) continue;

    const isLast = i === action.dependencies.length - 1;
    printAction(depName, depAction, lockfile, prefix + childPrefix, isLast);
  }
}
