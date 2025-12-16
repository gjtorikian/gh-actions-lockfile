import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { dirname } from "node:path";
import type { Lockfile, VerifyResult, Workflow } from "../types.js";
import { extractActionRefs, getFullName, parseActionRef } from "../parser/workflow.js";

export const DEFAULT_PATH = ".github/workflows/actions.lock.json";

export async function readLockfile(path: string): Promise<Lockfile> {
  try {
    await access(path);
  } catch {
    throw new Error(`Lockfile not found: ${path}`);
  }

  const content = await readFile(path, "utf-8");
  return JSON.parse(content) as Lockfile;
}

export async function writeLockfile(lockfile: Lockfile, path: string): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });

  const content = `${JSON.stringify(lockfile, null, 2)}\n`;
  await writeFile(path, content);
}

export function verify(workflows: Workflow[], lockfile: Lockfile): VerifyResult {
  const result: VerifyResult = {
    match: true,
    newActions: [],
    changed: [],
    removed: [],
  };

  const refs = extractActionRefs(workflows);
  const workflowActions = new Map<string, string>();

  for (const ref of refs) {
    workflowActions.set(getFullName(ref), ref.ref);
  }

  // Check for new or changed actions
  for (const [name, version] of workflowActions) {
    const locked = lockfile.actions[name];

    if (!locked) {
      result.newActions.push({
        action: name,
        newVersion: version,
      });
      result.match = false;
      continue;
    }

    if (locked.version !== version) {
      result.changed.push({
        action: name,
        oldVersion: locked.version,
        newVersion: version,
        oldSha: locked.sha,
      });
      result.match = false;
    }
  }

  // Check for removed actions (top-level only, not transitive deps)
  const topLevelActions = findTopLevelActions(lockfile);

  for (const name of topLevelActions) {
    if (!workflowActions.has(name)) {
      const locked = lockfile.actions[name];
      if (locked) {
        result.removed.push({
          action: name,
          oldVersion: locked.version,
          oldSha: locked.sha,
        });
        result.match = false;
      }
    }
  }

  return result;
}

function findTopLevelActions(lockfile: Lockfile): Set<string> {
  // Start with all actions as potentially top-level
  const topLevel = new Set<string>(Object.keys(lockfile.actions));

  // Remove any that appear as transitive dependencies
  for (const action of Object.values(lockfile.actions)) {
    for (const dep of action.dependencies) {
      const depRef = parseActionRef(dep.ref);
      if (depRef) {
        topLevel.delete(getFullName(depRef));
      }
    }
  }

  return topLevel;
}

export function printVerifyResult(result: VerifyResult): void {
  if (result.match) {
    console.log("✓ Lockfile is up to date");
    return;
  }

  console.log("✗ Lockfile mismatch detected\n");

  if (result.newActions.length > 0) {
    console.log("New actions (not in lockfile):");
    for (const c of result.newActions) {
      console.log(`  + ${c.action}@${c.newVersion}`);
    }
    console.log();
  }

  if (result.changed.length > 0) {
    console.log("Changed actions:");
    for (const c of result.changed) {
      console.log(`  ~ ${c.action}: ${c.oldVersion} -> ${c.newVersion}`);
    }
    console.log();
  }

  if (result.removed.length > 0) {
    console.log("Removed actions:");
    for (const c of result.removed) {
      console.log(`  - ${c.action}@${c.oldVersion}`);
    }
    console.log();
  }

  console.log("Run 'gh-actions-lockfile generate' to update the lockfile");
}
