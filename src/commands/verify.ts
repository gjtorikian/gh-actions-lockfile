import { join, dirname, isAbsolute } from "node:path";
import { readLockfile, verify, printVerifyResult } from "../lockfile/lockfile.js";
import { parseWorkflowDir } from "../parser/workflow.js";
import { findWorkflowDir } from "../utils/directory.js";
import { postOrUpdatePRComment } from "../github/comment.js";
import { getPRNumber } from "../github/context.js";
import { GitHubClient } from "../github/client.js";
import { checkAdvisories, printAdvisoryResults } from "../security/advisory.js";
import type { Lockfile, VerifyResult } from "../types.js";

interface VerifyOptions {
  workflows: string;
  output: string;
  comment?: boolean;
  skipSha?: boolean;
  skipIntegrity?: boolean;
  skipAdvisories?: boolean;
  token?: string;
}

export interface IntegrityResult {
  passed: boolean;
  checked: number;
  failures: IntegrityFailure[];
}

export interface IntegrityFailure {
  action: string;
  version: string;
  expected: string;
  actual: string;
}

export interface ShaValidationResult {
  passed: boolean;
  checked: number;
  failures: ShaValidationFailure[];
}

export interface ShaValidationFailure {
  action: string;
  version: string;
  lockfileSha: string;
  remoteSha: string;
}

export async function verifyCommand(options: VerifyOptions): Promise<void> {
  const workflowDir = await findWorkflowDir(options.workflows);

  // Determine lockfile path
  let lockfilePath = options.output;
  if (!isAbsolute(lockfilePath)) {
    const repoRoot = dirname(dirname(workflowDir));
    lockfilePath = join(repoRoot, lockfilePath);
  }

  const lockfile = await readLockfile(lockfilePath);
  const workflows = await parseWorkflowDir(workflowDir);

  console.log("Verifying lockfile...\n");

  // Step 1: Check if workflows match lockfile
  const result = verify(workflows, lockfile);
  printVerifyResult(result);

  let hasFailures = !result.match;

  // Create a single GitHubClient for all remote operations
  const client = new GitHubClient(options.token);

  // Verify SHAs: check tags still point to locked commits
  if (!options.skipSha) {
    const shaResult = await verifyShas(lockfile, client);
    printShaResult(shaResult);

    if (!shaResult.passed) {
      hasFailures = true;
    }
  } else {
    console.log("Skipping SHA verification (--skip-sha)\n");
  }

  // Verify integrity: check that the tarball hashes match
  if (!options.skipIntegrity) {
    const integrityResult = await verifyIntegrity(lockfile, client);
    printIntegrityResult(integrityResult);

    if (!integrityResult.passed) {
      hasFailures = true;
    }
  } else {
    console.log("Skipping integrity verification (--skip-integrity)\n");
  }

  // Check for any security advisories
  if (!options.skipAdvisories) {
    const advisoryResult = await checkAdvisories(lockfile, client);
    printAdvisoryResults(advisoryResult);

    if (advisoryResult.hasVulnerabilities) {
      hasFailures = true;
    }
  } else {
    console.log("Skipping security advisory check (--skip-advisories)\n");
  }

  if (hasFailures) {
    // Post PR comment if enabled
    if (options.comment) {
      await postPRComment(client, result);
    }
    process.exit(1);
  }

  console.log("Lockfile verification passed");
}

export async function verifyIntegrity(
  lockfile: Lockfile,
  client: GitHubClient
): Promise<IntegrityResult> {
  const failures: IntegrityFailure[] = [];
  let checked = 0;

  // Collect all actions to check
  const actionsToCheck: Array<{
    name: string;
    version: string;
    sha: string;
    integrity: string;
  }> = [];

  for (const [actionName, versions] of Object.entries(lockfile.actions)) {
    for (const action of versions) {
      // Skip if no integrity hash stored
      if (!action.integrity) {
        continue;
      }
      actionsToCheck.push({
        name: actionName,
        version: action.version,
        sha: action.sha,
        integrity: action.integrity,
      });
    }
  }

  if (actionsToCheck.length === 0) {
    return { passed: true, checked: 0, failures: [] };
  }

  console.log(`Checking integrity of ${actionsToCheck.length} action(s)...`);

  const results = await Promise.all(
    actionsToCheck.map(async (action) => {
      const parts = action.name.split("/");
      const owner = parts[0]!;
      const repo = parts[1]!;

      try {
        const currentIntegrity = await client.getArchiveSHA256(
          owner,
          repo,
          action.sha
        );

        if (currentIntegrity !== action.integrity) {
          console.log(`✗ ${action.name}@${action.version}`);
          return {
            checked: true,
            failure: {
              action: action.name,
              version: action.version,
              expected: action.integrity,
              actual: currentIntegrity,
            },
          };
        } else {
          console.log(`✓ ${action.name}@${action.version}`);
          return { checked: true, failure: null };
        }
      } catch (error) {
        console.log(
          `⚠ ${action.name}@${action.version} - could not verify: ${error instanceof Error ? error.message : error}`
        );
        return { checked: false, failure: null };
      }
    })
  );

  for (const result of results) {
    if (result.checked) checked++;
    if (result.failure) failures.push(result.failure);
  }

  return {
    passed: failures.length === 0,
    checked,
    failures,
  };
}

function printIntegrityResult(result: IntegrityResult): void {
  if (result.checked === 0) {
    console.log("No integrity hashes to verify\n");
    return;
  }

  if (result.passed) {
    console.log(`All integrity checks passed (${result.checked} verified)\n`);
  } else {
    console.log("INTEGRITY VERIFICATION FAILED\n");
    for (const failure of result.failures) {
      console.log(`  ${failure.action}@${failure.version}`);
      console.log(`    Expected: ${failure.expected}`);
      console.log(`    Got:      ${failure.actual}`);
    }
    console.log();
  }
}

export async function verifyShas(
  lockfile: Lockfile,
  client: GitHubClient
): Promise<ShaValidationResult> {
  const failures: ShaValidationFailure[] = [];
  let checked = 0;

  // Collect all actions to check (including transitive dependencies)
  const actionsToCheck: Array<{
    name: string;
    version: string;
    sha: string;
  }> = [];

  for (const [actionName, versions] of Object.entries(lockfile.actions)) {
    for (const action of versions) {
      actionsToCheck.push({
        name: actionName,
        version: action.version,
        sha: action.sha,
      });

      // Also check transitive dependencies
      if (action.dependencies) {
        for (const dep of action.dependencies) {
          // Parse the ref to extract action name and version
          // Format: "owner/repo@version" or "owner/repo/path@version"
          const atIndex = dep.ref.lastIndexOf("@");
          if (atIndex === -1) continue;

          const depName = dep.ref.slice(0, atIndex);
          const depVersion = dep.ref.slice(atIndex + 1);

          actionsToCheck.push({
            name: depName,
            version: depVersion,
            sha: dep.sha,
          });
        }
      }
    }
  }

  if (actionsToCheck.length === 0) {
    return { passed: true, checked: 0, failures: [] };
  }

  console.log(`Checking SHA resolution for ${actionsToCheck.length} action(s)...`);

  const results = await Promise.all(
    actionsToCheck.map(async (action) => {
      const parts = action.name.split("/");
      const owner = parts[0]!;
      const repo = parts[1]!;

      try {
        const remoteSha = await client.resolveRef(owner, repo, action.version);

        if (remoteSha !== action.sha) {
          console.log(`✗ ${action.name}@${action.version}`);
          return {
            checked: true,
            failure: {
              action: action.name,
              version: action.version,
              lockfileSha: action.sha,
              remoteSha,
            },
          };
        } else {
          console.log(`✓ ${action.name}@${action.version}`);
          return { checked: true, failure: null };
        }
      } catch (error) {
        console.log(
          `⚠ ${action.name}@${action.version} - could not verify: ${error instanceof Error ? error.message : error}`
        );
        return { checked: false, failure: null };
      }
    })
  );

  for (const result of results) {
    if (result.checked) checked++;
    if (result.failure) failures.push(result.failure);
  }

  console.log();

  return {
    passed: failures.length === 0,
    checked,
    failures,
  };
}

function printShaResult(result: ShaValidationResult): void {
  if (result.checked === 0) {
    console.log("No SHA references to verify\n");
    return;
  }

  if (result.passed) {
    console.log(`All SHA checks passed (${result.checked} verified)\n`);
  } else {
    console.log("SHA VALIDATION FAILED\n");
    for (const failure of result.failures) {
      console.log(`  ${failure.action}@${failure.version}`);
      console.log(`    Lockfile: ${failure.lockfileSha}`);
      console.log(`    Current:  ${failure.remoteSha}`);
      console.log(`    WARNING: Tag ${failure.version} has been moved!`);
    }
    console.log();
  }
}

async function postPRComment(client: GitHubClient, result: VerifyResult): Promise<void> {
  const prNumber = getPRNumber();
  if (!prNumber) {
    console.log("Not running in PR context, skipping comment");
    return;
  }

  try {
    await postOrUpdatePRComment(client, prNumber, result);
    console.log(`Posted lockfile mismatch comment on PR #${prNumber}`);
  } catch (error) {
    console.error(
      "Failed to post PR comment:",
      error instanceof Error ? error.message : error
    );
    // Don't fail the action if commenting fails
  }
}
