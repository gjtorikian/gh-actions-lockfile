interface VerifyOptions {
    workflows: string;
    output: string;
    comment?: boolean;
}
export declare function verifyCommand(options: VerifyOptions): Promise<void>;
export {};
