import type { Lockfile, VerifyResult, Workflow } from "../types.js";
export declare const DEFAULT_PATH = ".github/actions.lock.json";
export declare function readLockfile(path: string): Promise<Lockfile>;
export declare function writeLockfile(lockfile: Lockfile, path: string): Promise<void>;
export declare function verify(workflows: Workflow[], lockfile: Lockfile): VerifyResult;
export declare function printVerifyResult(result: VerifyResult): void;
