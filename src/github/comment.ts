import type { GitHubClient } from "./client.js";
import type { VerifyResult, ChangeInfo } from "../types.js";

const COMMENT_MARKER = "<!-- gh-actions-lockfile-comment -->";

/**
 * Posts or updates the lockfile mismatch comment on a PR.
 * Uses a hidden marker to identify and update existing comments.
 */
export async function postOrUpdatePRComment(
  client: GitHubClient,
  prNumber: number,
  result: VerifyResult
): Promise<void> {
  const commentBody = formatComment(result);

  // Check for existing comment
  const existingComment = await client.findPRComment(prNumber, COMMENT_MARKER);

  if (existingComment) {
    await client.updatePRComment(existingComment.id, commentBody);
  } else {
    await client.createPRComment(prNumber, commentBody);
  }
}

/**
 * Formats the VerifyResult into a markdown comment.
 */
function formatComment(result: VerifyResult): string {
  const totalChanges =
    result.newActions.length + result.changed.length + result.removed.length;

  const lines: string[] = [
    COMMENT_MARKER,
    "## :lock: Actions Lockfile Mismatch",
    "",
    "The lockfile verification failed. Please run `gh-actions-lockfile generate` to update the lockfile.",
    "",
    "<details>",
    `<summary>View changes (${totalChanges} action${totalChanges !== 1 ? "s" : ""} affected)</summary>`,
    "",
  ];

  if (result.newActions.length > 0) {
    lines.push("### New Actions");
    lines.push("");
    for (const action of result.newActions) {
      const repoLink = buildRepoLink(action.action);
      if (repoLink) {
        lines.push(`- \`${action.action}@${action.newVersion}\` ([view repo](${repoLink}))`);
      } else {
        lines.push(`- \`${action.action}@${action.newVersion}\``);
      }
    }
    lines.push("");
  }

  if (result.changed.length > 0) {
    lines.push("### Changed Actions");
    lines.push("");
    for (const action of result.changed) {
      const diffLink = buildDiffLink(action);
      if (diffLink) {
        lines.push(
          `- \`${action.action}\`: ${action.oldVersion} -> ${action.newVersion} ([compare](${diffLink}))`
        );
      } else {
        lines.push(
          `- \`${action.action}\`: ${action.oldVersion} -> ${action.newVersion}`
        );
      }
    }
    lines.push("");
  }

  if (result.removed.length > 0) {
    lines.push("### Removed Actions");
    lines.push("");
    for (const action of result.removed) {
      const commitLink = buildCommitLink(action);
      if (commitLink) {
        lines.push(
          `- \`${action.action}@${action.oldVersion}\` ([view commit](${commitLink}))`
        );
      } else {
        lines.push(`- \`${action.action}@${action.oldVersion}\``);
      }
    }
    lines.push("");
  }

  lines.push("</details>");

  return lines.join("\n");
}

/**
 * Builds a GitHub compare URL for changed actions.
 * Returns null if SHAs are not available.
 */
function buildDiffLink(change: ChangeInfo): string | null {
  if (!change.oldSha || !change.newSha) {
    return null;
  }

  const parts = change.action.split("/");
  if (parts.length < 2) {
    return null;
  }

  const owner = parts[0];
  const repo = parts[1];

  return `https://github.com/${owner}/${repo}/compare/${change.oldSha}...${change.newSha}`;
}

/**
 * Builds a GitHub commit URL for removed actions.
 * Returns null if oldSha is not available.
 */
function buildCommitLink(change: ChangeInfo): string | null {
  if (!change.oldSha) {
    return null;
  }

  const parts = change.action.split("/");
  if (parts.length < 2) {
    return null;
  }

  const owner = parts[0];
  const repo = parts[1];

  return `https://github.com/${owner}/${repo}/commit/${change.oldSha}`;
}

/**
 * Builds a GitHub repo URL for an action.
 * Returns null if action format is invalid.
 */
function buildRepoLink(action: string): string | null {
  const parts = action.split("/");
  if (parts.length < 2) {
    return null;
  }

  const owner = parts[0];
  const repo = parts[1];

  return `https://github.com/${owner}/${repo}`;
}
