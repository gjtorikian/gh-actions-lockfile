import type { ActionRef, Workflow } from "../types.js";
export declare function shouldSkipActionRef(uses: string): boolean;
export declare function parseWorkflowDir(dir: string): Promise<Workflow[]>;
export declare function parseWorkflowFile(path: string): Promise<Workflow | null>;
export declare function extractActionRefs(workflows: Workflow[]): ActionRef[];
export declare function parseActionRef(uses: string): ActionRef | null;
export declare function getFullName(ref: ActionRef): string;
export declare function getRepoFullName(ref: ActionRef): string;
/**
 * Check if a ref string is a full SHA (40-character hex string)
 */
export declare function isSHA(ref: string): boolean;
