/**
 * Gets the PR number from the GitHub Actions event context.
 * Returns null if not running in a PR context.
 */
export declare function getPRNumber(): number | null;
