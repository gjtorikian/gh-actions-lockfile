interface GenerateOptions {
    workflows: string;
    output: string;
    token?: string;
    requireSha?: boolean;
}
export declare function generate(options: GenerateOptions): Promise<void>;
export {};
