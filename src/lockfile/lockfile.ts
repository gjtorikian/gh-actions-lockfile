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
  // Track workflow actions as name -> Set of versions (to support multiple versions)
  const workflowActions = new Map<string, Set<string>>();

  for (const ref of refs) {
    const name = getFullName(ref);
    if (!workflowActions.has(name)) {
      workflowActions.set(name, new Set());
    }
    workflowActions.get(name)!.add(ref.ref);
  }

  // Check for new or changed actions
  for (const [name, versions] of workflowActions) {
    const lockedVersions = lockfile.actions[name] || [];

    for (const version of versions) {
      const locked = lockedVersions.find(a => a.version === version);

      if (!locked) {
        result.newActions.push({
          action: name,
          newVersion: version,
        });
        result.match = false;
      }
    }
  }

  // Check for removed actions (top-level only, not transitive deps)
  const topLevelActions = findTopLevelActions(lockfile);

  for (const { name, version } of topLevelActions) {
    const workflowVersions = workflowActions.get(name);
    if (!workflowVersions || !workflowVersions.has(version)) {
      const lockedVersions = lockfile.actions[name] || [];
      const locked = lockedVersions.find(a => a.version === version);
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

interface TopLevelAction {
  name: string;
  version: string;
}

function findTopLevelActions(lockfile: Lockfile): TopLevelAction[] {
  // Build set of all transitive dependencies (as "name@version")
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

  // Return all action versions that are not transitive deps
  const topLevel: TopLevelAction[] = [];
  for (const [name, versions] of Object.entries(lockfile.actions)) {
    for (const action of versions) {
      const key = `${name}@${action.version}`;
      if (!transitiveDeps.has(key)) {
        topLevel.push({ name, version: action.version });
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
