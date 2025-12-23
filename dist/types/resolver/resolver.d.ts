import { GitHubClient } from "../github/client.js";
import type { ActionRef, Lockfile } from "../types.js";
export declare class Resolver {
    private client;
    private visited;
    constructor(client: GitHubClient);
    resolveAll(refs: ActionRef[]): Promise<Lockfile>;
    private resolveAction;
    private findTransitiveDeps;
}
