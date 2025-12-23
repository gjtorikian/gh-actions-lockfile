import type { VerifyResult } from "../types.js";
/**
 * Posts or updates the lockfile mismatch comment on a PR.
 * Uses a hidden marker to identify and update existing comments.
 */
export declare function postOrUpdatePRComment(prNumber: number, result: VerifyResult): Promise<void>;
