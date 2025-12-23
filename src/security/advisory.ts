import { GitHubClient, type Advisory } from "../github/client.js";
import type { Lockfile } from "../types.js";

export type { Advisory };

export interface ActionAdvisory {
  action: string;
  version: string;
  advisories: Advisory[];
}

export interface AdvisoryResult {
  checked: number;
  actionsWithAdvisories: ActionAdvisory[];
  hasVulnerabilities: boolean;
}

export async function checkAdvisories(
  lockfile: Lockfile,
  client: GitHubClient
): Promise<AdvisoryResult> {
  const actionsWithAdvisories: ActionAdvisory[] = [];
  let checked = 0;

  const token = client.getToken();

  if (!token) {
    console.log(
      "Skipping advisory check (no token available for GraphQL API)\n"
    );
    return { checked: 0, actionsWithAdvisories: [], hasVulnerabilities: false };
  }

  console.log("Checking security advisories...");

  for (const [actionName, versions] of Object.entries(lockfile.actions)) {
    for (const action of versions) {
      try {
        const advisories = await client.checkActionAdvisories(actionName);
        checked++;

        if (advisories.length > 0) {
          actionsWithAdvisories.push({
            action: actionName,
            version: action.version,
            advisories,
          });
        }
      } catch (error) {
        // Silently continue on errors - advisory checking is best-effort
        if (
          error instanceof Error &&
          error.message.includes("INSUFFICIENT_SCOPES")
        ) {
          console.log(
            "Skipping advisory check (token lacks required scopes)\n"
          );
          return {
            checked: 0,
            actionsWithAdvisories: [],
            hasVulnerabilities: false,
          };
        }
      }
    }
  }

  return {
    checked,
    actionsWithAdvisories,
    hasVulnerabilities: actionsWithAdvisories.length > 0,
  };
}

export function printAdvisoryResults(result: AdvisoryResult): void {
  if (result.checked === 0) {
    return;
  }

  console.log();

  if (!result.hasVulnerabilities) {
    console.log(`✓ No known vulnerabilities found (${result.checked} checked)`);
    console.log();
    return;
  }

  console.log("Security advisories found:\n");

  for (const actionAdvisory of result.actionsWithAdvisories) {
    for (const advisory of actionAdvisory.advisories) {
      console.log(
        `${actionAdvisory.action}@${actionAdvisory.version}`
      );
      console.log(`    ${advisory.ghsaId} (${advisory.severity})`);
      console.log(`    ${advisory.summary}`);
      console.log(`    ${advisory.permalink}`);
      console.log();
    }
  }

  console.log(
    `Found ${result.actionsWithAdvisories.length} action(s) with known vulnerabilities\n`
  );
}
