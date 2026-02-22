
/**
 * DFS Rate Limiter Utility
 * Enforces strict RPM limits and handles exponential backoff for 429s.
 */

export type DfsKind = 'google' | 'amazon';

export class DfsRateLimitError extends Error {
    constructor(public kind: DfsKind, message: string) {
        super(message);
        this.name = 'DfsRateLimitError';
    }
}

export class DfsUnavailableError extends Error {
    constructor(public kind: DfsKind, message: string) {
        super(message);
        this.name = 'DfsUnavailableError';
    }
}

interface LimiterConfig {
    maxRpm: number;
    maxRetries: number;
    baseDelayMs: number;
}

const DEFAULT_CONFIG: LimiterConfig = {
    maxRpm: 10, // Safe buffer below 12/min
    maxRetries: 5,
    baseDelayMs: 2000,
};

class RateLimiter {
    private queue: Promise<any> = Promise.resolve();
    private lastCallTs = 0;
    private minIntervalMs: number;

    constructor(private config: LimiterConfig) {
        this.minIntervalMs = (60 / config.maxRpm) * 1000;
    }

    async execute<T>(
        kind: DfsKind,
        categoryId: string,
        snapshotId: string,
        keywordCount: number,
        path: string,
        fn: () => Promise<T>
    ): Promise<T> {
        return new Promise((resolve, reject) => {
            this.queue = this.queue.then(async () => {
                let attempt = 1;
                while (attempt <= this.config.maxRetries) {
                    const now = Date.now();
                    const timeSinceLast = now - this.lastCallTs;
                    const waitMs = Math.max(0, this.minIntervalMs - timeSinceLast);
                    
                    if (waitMs > 0) {
                        await new Promise(r => setTimeout(r, waitMs));
                    }

                    // Log Attempt: [DFS_CALL][RL]
                    console.log(`[DFS_CALL][RL] kind=${kind} category=${categoryId} snapshot=${snapshotId} keywords=${keywordCount} attempt=${attempt} wait_ms=${waitMs} endpoint=https://api.dataforseo.com/v3 path=${path}`);

                    try {
                        const start = Date.now();
                        const result = await fn() as any;
                        const latency = Date.now() - start;
                        this.lastCallTs = Date.now();

                        // Check for rate limit indicators in response body or status
                        // DataForSEO sometimes returns 200 OK but with a task error
                        const isRateLimited = 
                            result.status === 429 || 
                            (result.error && typeof result.error === 'string' && (
                                result.error.toLowerCase().includes('rates limit') ||
                                result.error.toLowerCase().includes('limit per minute')
                            ));

                        if (isRateLimited) {
                            const backoffMs = this.calculateBackoff(attempt);
                            console.warn(`[DFS_BACKOFF][RL] kind=${kind} attempt=${attempt} reason=429_RATE sleep_ms=${backoffMs}`);
                            await new Promise(r => setTimeout(r, backoffMs));
                            attempt++;
                            continue;
                        }

                        // Check for 5xx server errors
                        if (!result.ok && result.status >= 500) {
                            const backoffMs = this.calculateBackoff(attempt);
                            console.warn(`[DFS_BACKOFF][RL] kind=${kind} attempt=${attempt} reason=5XX sleep_ms=${backoffMs}`);
                            await new Promise(r => setTimeout(r, backoffMs));
                            attempt++;
                            continue;
                        }

                        // Success or Final Logical Error
                        const dfsCode = result.status === 200 ? (result.parsedRows ? 20000 : result.status) : result.status;
                        console.log(`[DFS_RESP][RL] kind=${kind} http=${result.status} ok=${result.ok} dfs_status_code=${dfsCode} tasks=${result.parsedRows?.length || 0} latency_ms=${latency}`);
                        
                        resolve(result);
                        return;

                    } catch (e: any) {
                        const isTimeout = e.message?.includes('TIMEOUT') || e.name === 'AbortError';
                        const backoffMs = this.calculateBackoff(attempt);
                        
                        if (attempt < this.config.maxRetries) {
                            console.warn(`[DFS_BACKOFF][RL] kind=${kind} attempt=${attempt} reason=${isTimeout ? 'timeout' : 'network'} sleep_ms=${backoffMs}`);
                            await new Promise(r => setTimeout(r, backoffMs));
                            attempt++;
                            continue;
                        }

                        console.error(`[DFS_FAIL][RL] kind=${kind} category=${categoryId} code=${isTimeout ? 'DFS_UNAVAILABLE' : 'DFS_ERROR'} msg=${e.message}`);
                        reject(e);
                        return;
                    }
                }

                const finalMsg = `Rates limit per minute exceeded after ${this.config.maxRetries} attempts`;
                console.error(`[DFS_FAIL][RL] kind=${kind} category=${categoryId} code=DFS_RATE_LIMIT msg=${finalMsg}`);
                reject(new DfsRateLimitError(kind, finalMsg));
            });
        });
    }

    private calculateBackoff(attempt: number): number {
        // 60s base window + jitter to clear the minute limit
        const base = 60000; 
        const jitter = Math.random() * 5000;
        return base + jitter;
    }
}

export const DfsGlobalLimiter = new RateLimiter(DEFAULT_CONFIG);
