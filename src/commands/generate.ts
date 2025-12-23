import { join, dirname, isAbsolute } from "node:path";
import { GitHubClient } from "../github/client.js";
import { writeLockfile } from "../lockfile/lockfile.js";
import { extractActionRefs, getFullName, isSHA, parseWorkflowDir } from "../parser/workflow.js";
import { Resolver } from "../resolver/resolver.js";
import { findWorkflowDir } from "../utils/directory.js";
import { colors } from "../utils/colors.js";
import { pluralize } from "../utils/pluralize.js";

interface GenerateOptions {
  workflows: string;
  output: string;
  token?: string;
  requireSha?: boolean;
}

export async function generate(options: GenerateOptions): Promise<void> {
  const workflowDir = await findWorkflowDir(options.workflows);

  console.log(colors.info(`Parsing workflows from ${colors.dim(workflowDir)}...`));

  const workflows = await parseWorkflowDir(workflowDir);

  if (workflows.length === 0) {
    throw new Error(`No workflow files found in ${workflowDir}`);
  }

  console.log(colors.success(`Found ${pluralize('workflow file', 'workflow files', workflows.length)}\n`));

  const refs = extractActionRefs(workflows);

  if (refs.length === 0) {
    console.log(colors.warning("No action references found in workflows"));
    return;
  }

  console.log(colors.success(`Found ${pluralize('unique action reference', 'unique action references', refs.length)}\n`));

  // Check for SHA-only mode
  if (options.requireSha) {
    const nonShaRefs = refs.filter((ref) => !isSHA(ref.ref));

    if (nonShaRefs.length > 0) {
      console.error(colors.error(colors.bold("ERROR: --require-sha is enabled but found non-SHA refs:\n")));
      for (const ref of nonShaRefs) {
        console.error(`  ${colors.error("✗")} ${colors.bold(getFullName(ref))}${colors.dim("@")}${ref.ref}`);
      }
      console.error(colors.dim("\nUse full commit SHAs for maximum security."));
      console.error(colors.dim("Example: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11"));
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

  console.log(colors.success(`\nLockfile written to ${outputPath}`));
  console.log(`  ${pluralize('action', 'actions', Object.keys(lockfile.actions).length)} locked`);
}
