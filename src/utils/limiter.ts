export type Limiter = <T>(fn: () => Promise<T>) => Promise<T>;

export function createLimiter(maxConcurrent: number): Limiter {
  let running = 0;
  const queue: (() => void)[] = [];

  return async <T>(fn: () => Promise<T>): Promise<T> => {
    while (running >= maxConcurrent) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    running++;
    try {
      return await fn();
    } finally {
      running--;
      queue.shift()?.();
    }
  };
}
