import { GitHubClient } from "../github/client.js";
import type { Lockfile } from "../types.js";
interface VerifyOptions {
    workflows: string;
    output: string;
    comment?: boolean;
    skipSha?: boolean;
    skipIntegrity?: boolean;
    skipAdvisories?: boolean;
    token?: string;
}
export interface IntegrityResult {
    passed: boolean;
    checked: number;
    failures: IntegrityFailure[];
}
export interface IntegrityFailure {
    action: string;
    version: string;
    expected: string;
    actual: string;
}
export interface ShaValidationResult {
    passed: boolean;
    checked: number;
    failures: ShaValidationFailure[];
}
export interface ShaValidationFailure {
    action: string;
    version: string;
    lockfileSha: string;
    remoteSha: string;
}
export declare function verifyCommand(options: VerifyOptions): Promise<void>;
export declare function verifyIntegrity(lockfile: Lockfile, client: GitHubClient): Promise<IntegrityResult>;
export declare function verifyShas(lockfile: Lockfile, client: GitHubClient): Promise<ShaValidationResult>;
export {};
