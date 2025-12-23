import { GitHubClient, type Advisory } from "../github/client.js";
import type { Lockfile } from "../types.js";
import { colors } from "../utils/colors.js";
import { pluralize } from "../utils/pluralize.js";

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
      colors.warning("Skipping advisory check (no token available for GraphQL API)\n")
    );
    return { checked: 0, actionsWithAdvisories: [], hasVulnerabilities: false };
  }

  console.log(colors.info("Checking security advisories..."));

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
            colors.warning("Skipping advisory check (token lacks required scopes)\n")
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

function getSeverityLabel(severity: Advisory["severity"]): string {
  switch (severity) {
    case "CRITICAL":
      return colors.critical("CRIT");
    case "HIGH":
      return colors.high("HIGH");
    case "MODERATE":
      return colors.moderate("MOD ");
    case "LOW":
      return colors.low("LOW ");
    default:
      return colors.dim(severity);
  }
}

export function printAdvisoryResults(result: AdvisoryResult): void {
  if (result.checked === 0) {
    return;
  }

  console.log();

  if (!result.hasVulnerabilities) {
    console.log(`${colors.success("✓")} No known vulnerabilities found (${result.checked} checked)`);
    console.log();
    return;
  }

  console.log(colors.error(colors.bold("Security advisories found:\n")));

  for (const actionAdvisory of result.actionsWithAdvisories) {
    for (const advisory of actionAdvisory.advisories) {
      console.log(
        `${getSeverityLabel(advisory.severity)} ${colors.bold(actionAdvisory.action)}${colors.dim("@")}${actionAdvisory.version}`
      );
      console.log(`     ${colors.dim(advisory.ghsaId)}`);
      console.log(`     ${advisory.summary}`);
      console.log(`     ${colors.dim(advisory.permalink)}`);
      console.log();
    }
  }

  console.log(
    colors.error(`Found ${pluralize('action', 'actions', result.actionsWithAdvisories.length)} with known vulnerabilities\n`)
  );
}
