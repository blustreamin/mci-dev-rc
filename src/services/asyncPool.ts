
/**
 * Lightweight Async Pool for managing concurrency.
 * strictly restricted to service layer usage.
 */
export const AsyncPool = {
    async run<T>(
        tasks: (() => Promise<T>)[],
        concurrency: number = 3,
        abortSignal?: AbortSignal
    ): Promise<T[]> {
        if (abortSignal?.aborted) throw new Error("ABORTED");

        const results: T[] = new Array(tasks.length);
        const executing: Promise<void>[] = [];
        let currentIndex = 0;

        const executeTask = async () => {
            while (currentIndex < tasks.length) {
                if (abortSignal?.aborted) return;

                const index = currentIndex++;
                const task = tasks[index];

                try {
                    results[index] = await task();
                } catch (error) {
                    if (abortSignal?.aborted) return;
                    // Re-throw to fail fast for certification stability
                    throw error;
                }
            }
        };

        for (let i = 0; i < Math.min(concurrency, tasks.length); i++) {
            executing.push(executeTask());
        }

        await Promise.all(executing);
        
        if (abortSignal?.aborted) {
            throw new Error("ABORTED");
        }

        return results;
    }
};
