import { glob, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { ActionRef, Workflow } from "../types.js";

// Parses GitHub Action references in the format: owner/repo[/path]@ref
// Examples:
//   actions/checkout@v4           -> owner=actions, repo=checkout, ref=v4
//   aws-actions/configure-aws-credentials@v4 -> owner=aws-actions, repo=configure-aws-credentials, ref=v4
//   actions/reusable/.github/workflows/test.yml@main -> owner=actions, repo=reusable, path=.github/workflows/test.yml, ref=main
// Groups: (1) owner, (2) repo, (3) optional path, (4) ref
const ACTION_REF_REGEX = /^([^/]+)\/([^/@]+)(?:\/([^@]+))?@(.+)$/;

export async function parseWorkflowDir(dir: string): Promise<Workflow[]> {
  const files: string[] = [];
  for await (const file of glob(join(dir, "*.{yml,yaml}"))) {
    files.push(file);
  }

  const results = await Promise.all(files.map(parseWorkflowFile));
  return results.filter((w): w is Workflow => w !== null);
}

export async function parseWorkflowFile(path: string): Promise<Workflow | null> {
  const content = await readFile(path, "utf-8");

  try {
    const workflow = parseYaml(content) as Workflow;
    return workflow;
  } catch (error) {
    console.error(`Failed to parse ${path}:`, error);
    return null;
  }
}

export function extractActionRefs(workflows: Workflow[]): ActionRef[] {
  const seen = new Set<string>();
  const refs: ActionRef[] = [];

  for (const workflow of workflows) {
    if (!workflow.jobs) continue;

    for (const job of Object.values(workflow.jobs)) {
      if (!job.steps) continue;

      for (const step of job.steps) {
        if (!step.uses) continue;

        // Skip local actions
        if (step.uses.startsWith("./")) continue;

        // Skip docker:// references
        if (step.uses.startsWith("docker://")) continue;

        // De-duplicate
        if (seen.has(step.uses)) continue;
        seen.add(step.uses);

        const ref = parseActionRef(step.uses);
        if (ref) {
          refs.push(ref);
        }
      }
    }
  }

  return refs;
}

export function parseActionRef(uses: string): ActionRef | null {
  const match = ACTION_REF_REGEX.exec(uses);
  if (!match) {
    console.warn(`Invalid action reference format: ${uses}`);
    return null;
  }

  const [, owner, repo, path, ref] = match;
  return {
    owner: owner!,
    repo: repo!,
    ref: ref!,
    path: path || undefined,
    rawUses: uses,
  };
}

export function getFullName(ref: ActionRef): string {
  if (ref.path) {
    return `${ref.owner}/${ref.repo}/${ref.path}`;
  }
  return `${ref.owner}/${ref.repo}`;
}

export function getRepoFullName(ref: ActionRef): string {
  return `${ref.owner}/${ref.repo}`;
}
