
/**
 * Simple concurrency limiter (Semaphore)
 * Used to throttle API requests to prevent 429s.
 */
export class RateLimiter {
    private activeCount = 0;
    private queue: (() => void)[] = [];
    private maxConcurrency: number;

    constructor(concurrency: number) {
        this.maxConcurrency = concurrency;
    }

    /**
     * Updates concurrency limit dynamically.
     * Use this to downgrade if 429s occur.
     */
    setConcurrency(newLimit: number) {
        this.maxConcurrency = Math.max(1, newLimit);
    }

    async add<T>(fn: () => Promise<T>): Promise<T> {
        if (this.activeCount >= this.maxConcurrency) {
            await new Promise<void>(resolve => this.queue.push(resolve));
        }

        this.activeCount++;
        try {
            return await fn();
        } finally {
            this.activeCount--;
            if (this.queue.length > 0) {
                const next = this.queue.shift();
                if (next) next();
            }
        }
    }
}

export const GlobalLimiter = new RateLimiter(3); // Default 3 concurrent
