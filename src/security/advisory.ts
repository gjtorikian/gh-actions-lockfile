import { GitHubClient, type Advisory } from "../github/client.js";
import type { Lockfile } from "../types.js";
import { colors } from "../utils/colors.js";
import { pluralize } from "../utils/pluralize.js";
import { valid, coerce, satisfies } from "semver";

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

/**
 * Normalize GitHub Actions version to semver format.
 * E.g., "v3" -> "3.0.0", "v4.1" -> "4.1.0", "abc123" (SHA) -> null
 */
function normalizeVersion(version: string): string | null {
  // If it looks like a SHA (40 hex chars), we can't do version comparison
  if (/^[a-f0-9]{40}$/i.test(version)) {
    return null;
  }

  // Remove 'v' prefix if present
  let normalized = version.replace(/^v/, "");

  // If it's already valid semver, return it
  if (valid(normalized)) {
    return normalized;
  }

  // Try to coerce to semver (handles cases like "3", "3.1", etc.)
  const coerced = coerce(normalized);
  return coerced ? coerced.version : null;
}

/**
 * Check if a version is affected by a vulnerability range.
 */
function isVersionAffected(version: string, vulnerableRange: string): boolean {
  const normalizedVersion = normalizeVersion(version);
  
  // If we can't normalize the version (e.g., it's a SHA), assume it's not affected
  // This is a safe default since SHAs are specific commits
  if (!normalizedVersion) {
    return false;
  }

  try {
    return satisfies(normalizedVersion, vulnerableRange);
  } catch (error) {
    // If the range is invalid or can't be parsed, log and assume not affected
    console.error(`Failed to parse vulnerability range "${vulnerableRange}":`, error);
    return false;
  }
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

        // Filter advisories to only include those affecting this specific version
        const affectingAdvisories = advisories.filter((advisory) =>
          isVersionAffected(action.version, advisory.vulnerableVersionRange)
        );

        if (affectingAdvisories.length > 0) {
          actionsWithAdvisories.push({
            action: actionName,
            version: action.version,
            advisories: affectingAdvisories,
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
