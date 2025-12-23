import { join, dirname, isAbsolute } from "node:path";
import { GitHubClient } from "../github/client.js";
import { writeLockfile } from "../lockfile/lockfile.js";
import { extractActionRefs, getFullName, isSHA, parseWorkflowDir } from "../parser/workflow.js";
import { Resolver } from "../resolver/resolver.js";
import { findWorkflowDir } from "../utils/directory.js";

interface GenerateOptions {
  workflows: string;
  output: string;
  token?: string;
  requireSha?: boolean;
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

  // Check for SHA-only mode
  if (options.requireSha) {
    const nonShaRefs = refs.filter((ref) => !isSHA(ref.ref));

    if (nonShaRefs.length > 0) {
      console.error("ERROR: --require-sha is enabled but found non-SHA refs:\n");
      for (const ref of nonShaRefs) {
        console.error(`  ${getFullName(ref)}@${ref.ref}`);
      }
      console.error("\nUse full commit SHAs for maximum security.");
      console.error("Example: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11");
      process.exit(1);
    }
  }

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
