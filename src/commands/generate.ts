import { join, dirname, isAbsolute } from "node:path";
import { GitHubClient } from "../github/client.js";
import { writeLockfile } from "../lockfile/lockfile.js";
import { extractActionRefs, parseWorkflowDir } from "../parser/workflow.js";
import { Resolver } from "../resolver/resolver.js";
import { findWorkflowDir } from "../utils/directory.js";

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

  console.log(`\nLockfile written to ${outputPath}`);
  console.log(`  ${Object.keys(lockfile.actions).length} action(s) locked`);
}
