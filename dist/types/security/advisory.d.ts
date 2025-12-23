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
export declare function checkAdvisories(lockfile: Lockfile, client: GitHubClient): Promise<AdvisoryResult>;
export declare function printAdvisoryResults(result: AdvisoryResult): void;
