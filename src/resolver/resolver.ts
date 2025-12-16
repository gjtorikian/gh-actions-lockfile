import { GitHubClient } from "../github/client.js";
import { getFullName, parseActionRef, shouldSkipActionRef } from "../parser/workflow.js";
import type { ActionRef, Lockfile, LockedAction, LockedDependency } from "../types.js";

const MAX_DEPTH = 10;

export class Resolver {
  private client: GitHubClient;
  private visited = new Set<string>();

  constructor(client: GitHubClient) {
    this.client = client;
  }

  async resolveAll(refs: ActionRef[]): Promise<Lockfile> {
    const lockfile: Lockfile = {
      version: 1,
      generated: new Date().toISOString(),
      actions: {},
    };

    for (const ref of refs) {
      await this.resolveAction(ref, lockfile, 0);
    }

    return lockfile;
  }

  private async resolveAction(
    ref: ActionRef,
    lockfile: Lockfile,
    depth: number
  ): Promise<void> {
    if (depth > MAX_DEPTH) {
      throw new Error("Max dependency depth exceeded");
    }

    const actionKey = getFullName(ref);

    // Skip if already resolved
    if (this.visited.has(actionKey)) {
      return;
    }
    this.visited.add(actionKey);

    console.log(`Resolving ${actionKey}@${ref.ref}...`);

    // Resolve the ref to a SHA
    const sha = await this.client.resolveRef(ref.owner, ref.repo, ref.ref);

    // Get integrity hash
    let integrity = "";
    try {
      integrity = await this.client.getArchiveSHA256(ref.owner, ref.repo, sha);
    } catch (error) {
      console.log(`  Warning: could not compute integrity hash: ${error}`);
    }

    // Create action entry
    const action: LockedAction = {
      version: ref.ref,
      sha,
      integrity,
      dependencies: [],
    };

    // Try to fetch action.yml and find transitive deps
    const deps = await this.findTransitiveDeps(ref, sha);

    for (const depRef of deps) {
      // Recursively resolve the dependency
      await this.resolveAction(depRef, lockfile, depth + 1);

      // Get the resolved SHA from lockfile
      const depKey = getFullName(depRef);
      const resolvedDep = lockfile.actions[depKey];

      if (resolvedDep) {
        const dependency: LockedDependency = {
          ref: depRef.rawUses,
          sha: resolvedDep.sha,
          integrity: resolvedDep.integrity,
        };
        action.dependencies.push(dependency);
      }
    }

    lockfile.actions[actionKey] = action;
    console.log(`  Resolved to ${sha.slice(0, 12)}`);
  }

  private async findTransitiveDeps(ref: ActionRef, sha: string): Promise<ActionRef[]> {
    const config = await this.client.getActionConfig(ref.owner, ref.repo, sha, ref.path);

    if (!config) {
      return [];
    }

    // Only composite actions have transitive deps
    if (config.runs?.using !== "composite") {
      return [];
    }

    const deps: ActionRef[] = [];

    for (const step of config.runs.steps || []) {
      if (!step.uses) continue;
      if (shouldSkipActionRef(step.uses)) continue;

      const depRef = parseActionRef(step.uses);
      if (depRef) {
        deps.push(depRef);
      }
    }

    return deps;
  }
}
