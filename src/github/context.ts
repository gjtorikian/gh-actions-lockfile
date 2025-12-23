import { readFileSync } from "node:fs";

interface GitHubEvent {
  pull_request?: {
    number: number;
  };
  issue?: {
    number: number;
  };
  number?: number;
}

/**
 * Gets the PR number from the GitHub Actions event context.
 * Returns null if not running in a PR context.
 */
export function getPRNumber(): number | null {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    return null;
  }

  try {
    const eventData = JSON.parse(readFileSync(eventPath, "utf-8")) as GitHubEvent;

    // pull_request event
    if (eventData.pull_request?.number) {
      return eventData.pull_request.number;
    }

    // issue_comment event (for PR comments)
    if (eventData.issue?.number) {
      return eventData.issue.number;
    }

    // Direct number (some event types)
    if (eventData.number) {
      return eventData.number;
    }

    return null;
  } catch {
    return null;
  }
}

