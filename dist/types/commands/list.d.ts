interface ListOptions {
    workflows: string;
    output: string;
}
export declare function list(options: ListOptions): Promise<void>;
export {};
