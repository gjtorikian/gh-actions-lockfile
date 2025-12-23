export type Limiter = <T>(fn: () => Promise<T>) => Promise<T>;
export declare function createLimiter(maxConcurrent: number): Limiter;
