interface GenerateOptions {
    workflows: string;
    output: string;
    token?: string;
}
export declare function generate(options: GenerateOptions): Promise<void>;
export {};
