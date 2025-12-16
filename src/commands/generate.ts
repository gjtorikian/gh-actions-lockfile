import { join, dirname, isAbsolute } from "node:path";
import { GitHubClient } from "../github/client.js";
import { writeLockfile } from "../lockfile/lockfile.js";
import { extractActionRefs, parseWorkflowDir } from "../parser/workflow.js";
import { Resolver } from "../resolver/resolver.js";

interface GenerateOptions {
  workflows: string;
  output: string;
  token?: string;
}

export async function generate(options: GenerateOptions): Promise<void> {
  const workflowDir = await findWorkflowDir(options.workflows);

  console.log(`Parsing workflows from ${workflowDir}...`);

  const workflows = await parseWorkflowDir(workflowDir);

  if (workflows.length === 0) {
    throw new Error(`No workflow files found in ${workflowDir}`);
  }

  console.log(`Found ${workflows.length} workflow file(s)\n`);

  const refs = extractActionRefs(workflows);

  if (refs.length === 0) {
    console.log("No action references found in workflows");
    return;
  }

  console.log(`Found ${refs.length} unique action reference(s)\n`);

  const client = new GitHubClient(options.token);
  const resolver = new Resolver(client);

  const lockfile = await resolver.resolveAll(refs);

  // Determine output path
  let outputPath = options.output;
  if (!isAbsolute(outputPath)) {
    // Make relative to repo root (parent of .github)
    const repoRoot = dirname(dirname(workflowDir));
    outputPath = join(repoRoot, outputPath);
  }

  await writeLockfile(lockfile, outputPath);

  console.log(`\n✓ Lockfile written to ${outputPath}`);
  console.log(`  ${Object.keys(lockfile.actions).length} action(s) locked`);
}

async function findWorkflowDir(dir: string): Promise<string> {
  if (isAbsolute(dir)) {
    if (await directoryExists(dir)) {
      return dir;
    }
    throw new Error(`Workflow directory not found: ${dir}`);
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
