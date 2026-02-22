
/**
 * Yields control to the main thread to allow UI updates.
 * Usage: await yieldToUI();
 */
export const yieldToUI = () => new Promise(resolve => setTimeout(resolve, 0));

/**
 * Helper to pause execution for a set time.
 */
export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Yields every N iterations.
 * Usage: 
 * for (let i=0; i<items.length; i++) {
 *   await yieldEvery(i, 100);
 *   process(items[i]);
 * }
 */
export async function yieldEvery(index: number, chunk: number = 50) {
    if (index > 0 && index % chunk === 0) {
        await yieldToUI();
    }
}
