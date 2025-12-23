import type { ActionConfig } from "../types.js";
export interface Advisory {
    ghsaId: string;
    severity: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
    summary: string;
    vulnerableVersionRange: string;
    permalink: string;
}
interface PRComment {
    id: number;
    body: string;
}
export declare class GitHubClient {
    private token;
    private limiter;
    private owner?;
    private repo?;
    constructor(token?: string, maxConcurrent?: number, owner?: string, repo?: string);
    getToken(): string;
    getOwner(): string | undefined;
    getRepo(): string | undefined;
    resolveRef(owner: string, repo: string, ref: string): Promise<string>;
    private resolveTag;
    private resolveBranch;
    getActionConfig(owner: string, repo: string, sha: string, path?: string): Promise<ActionConfig | null>;
    getArchiveSHA256(owner: string, repo: string, sha: string): Promise<string>;
    private get;
    private fetch;
    private post;
    private graphql;
    findPRComment(prNumber: number, marker: string): Promise<PRComment | null>;
    createPRComment(prNumber: number, body: string): Promise<void>;
    updatePRComment(commentId: number, body: string): Promise<void>;
    checkActionAdvisories(actionName: string): Promise<Advisory[]>;
}
export {};
