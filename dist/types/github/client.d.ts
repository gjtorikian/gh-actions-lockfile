import type { ActionConfig } from "../types.js";
export declare class GitHubClient {
    private token;
    private limiter;
    constructor(token?: string, maxConcurrent?: number);
    resolveRef(owner: string, repo: string, ref: string): Promise<string>;
    private resolveTag;
    private resolveBranch;
    getActionConfig(owner: string, repo: string, sha: string, path?: string): Promise<ActionConfig | null>;
    getArchiveSHA256(owner: string, repo: string, sha: string): Promise<string>;
    private get;
    private fetch;
}
