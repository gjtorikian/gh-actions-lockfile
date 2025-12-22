import type { VerifyResult, ChangeInfo } from "../types.js";
import { getRepository } from "./context.js";

const BASE_URL = "https://api.github.com";
const COMMENT_MARKER = "<!-- gh-actions-lockfile-comment -->";

interface Comment {
  id: number;
  body: string;
}

/**
 * Posts or updates the lockfile mismatch comment on a PR.
 * Uses a hidden marker to identify and update existing comments.
 */
export async function postOrUpdatePRComment(
  prNumber: number,
  result: VerifyResult
): Promise<void> {
  const repo = getRepository();
  if (!repo) {
    throw new Error("GITHUB_REPOSITORY environment variable not set");
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN environment variable not set");
  }

  const { owner, repo: repoName } = repo;
  const commentBody = formatComment(result);

  // Check for existing comment
  const existingComment = await findExistingComment(owner, repoName, prNumber, token);

  if (existingComment) {
    await updateComment(owner, repoName, existingComment.id, commentBody, token);
  } else {
    await createComment(owner, repoName, prNumber, commentBody, token);
  }
}

async function findExistingComment(
  owner: string,
  repo: string,
  prNumber: number,
  token: string
): Promise<Comment | null> {
  const url = `${BASE_URL}/repos/${owner}/${repo}/issues/${prNumber}/comments`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch comments: ${response.status}`);
  }

  const comments = (await response.json()) as Comment[];

  for (const comment of comments) {
    if (comment.body.includes(COMMENT_MARKER)) {
      return comment;
    }
  }

  return null;
}

async function createComment(
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
  token: string
): Promise<void> {
  const url = `${BASE_URL}/repos/${owner}/${repo}/issues/${prNumber}/comments`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ body }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to create comment: ${response.status} ${errorBody}`);
  }
}

async function updateComment(
  owner: string,
  repo: string,
  commentId: number,
  body: string,
  token: string
): Promise<void> {
  const url = `${BASE_URL}/repos/${owner}/${repo}/issues/comments/${commentId}`;

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ body }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Failed to update comment: ${response.status} ${errorBody}`);
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
      lines.push(`- \`${action.action}@${action.newVersion}\``);
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
