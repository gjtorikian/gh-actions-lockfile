import type { GitHubClient } from "../github/client.js";
import type { Lockfile } from "../types.js";

export interface Advisory {
  ghsaId: string;
  severity: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  summary: string;
  vulnerableVersionRange: string;
  permalink: string;
}

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

interface GraphQLSecurityVulnerability {
  advisory: {
    ghsaId: string;
    summary: string;
    severity: string;
    permalink: string;
  };
  vulnerableVersionRange: string;
}

interface GraphQLResponse {
  data?: {
    securityVulnerabilities?: {
      nodes: GraphQLSecurityVulnerability[];
    };
  };
  errors?: Array<{ message: string }>;
}

const GRAPHQL_URL = "https://api.github.com/graphql";

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
        const advisories = await fetchAdvisories(actionName, token);
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

async function fetchAdvisories(
  actionName: string,
  token: string
): Promise<Advisory[]> {
  // Note: GitHub's security vulnerability API uses ACTIONS ecosystem for GitHub Actions
  // The package name format is "owner/repo"
  const query = `
    query($package: String!) {
      securityVulnerabilities(
        ecosystem: ACTIONS,
        package: $package,
        first: 10
      ) {
        nodes {
          advisory {
            ghsaId
            summary
            severity
            permalink
          }
          vulnerableVersionRange
        }
      }
    }
  `;

  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      variables: { package: actionName },
    }),
  });

  if (!response.ok) {
    throw new Error(`GraphQL request failed: ${response.status}`);
  }

  const result = (await response.json()) as GraphQLResponse;

  if (result.errors && result.errors.length > 0) {
    const firstError = result.errors[0]!;
    throw new Error(firstError.message);
  }

  const nodes = result.data?.securityVulnerabilities?.nodes || [];

  return nodes.map((node) => ({
    ghsaId: node.advisory.ghsaId,
    severity: node.advisory.severity as Advisory["severity"],
    summary: node.advisory.summary,
    vulnerableVersionRange: node.vulnerableVersionRange,
    permalink: node.advisory.permalink,
  }));
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

