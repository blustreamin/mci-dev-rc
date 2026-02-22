import { StorageAdapter } from './storageAdapter';
import { SourceItem } from '../types';

const SIGNAL_STORE_PREFIX = 'signals_v2_';

export const SignalStore = {
    
    getKey(categoryId: string, platform: string): string {
        return `${SIGNAL_STORE_PREFIX}${categoryId}::${platform.toLowerCase()}`;
    },

    /**
     * Retrieves stored signals for a category and platform.
     * Returns sorted by recency (newest first).
     */
    async getSignals(categoryId: string, platform: string): Promise<SourceItem[]> {
        const key = this.getKey(categoryId, platform);
        const stored = await StorageAdapter.get<SourceItem[]>(key, 'default'); // Using default store for now
        return stored || [];
    },

    /**
     * Persists new signals, ensuring deduplication by URL.
     * Accumulates up to 500 signals per platform/category.
     */
    async saveSignals(categoryId: string, platform: string, newSignals: SourceItem[]): Promise<void> {
        if (!newSignals || newSignals.length === 0) return;

        const key = this.getKey(categoryId, platform);
        const existing = await this.getSignals(categoryId, platform);
        
        const existingMap = new Map<string, SourceItem>();
        existing.forEach(s => existingMap.set(s.url, s));

        let addedCount = 0;
        newSignals.forEach(s => {
            // Only add if not backfilled and not duplicate
            if (!s.is_backfilled && !existingMap.has(s.url)) {
                existingMap.set(s.url, { ...s, capturedAt: new Date().toISOString() });
                addedCount++;
            }
        });

        // Convert back to array
        const merged = Array.from(existingMap.values());
        
        // Sort by capturedAt desc (newest first)
        merged.sort((a, b) => {
            const dA = a.capturedAt ? new Date(a.capturedAt).getTime() : 0;
            const dB = b.capturedAt ? new Date(b.capturedAt).getTime() : 0;
            return dB - dA;
        });

        // Cap at 500
        const final = merged.slice(0, 500);

        if (addedCount > 0) {
            await StorageAdapter.set(key, final, 'default');
            console.log(`[SignalStore] Persisted ${addedCount} new signals for ${categoryId}/${platform}. Total: ${final.length}`);
        }
    },

    /**
     * Gets the "Best 5" signals for display.
     * Prioritizes recent, high-confidence, real signals.
     */
    async getDisplaySignals(categoryId: string, platform: string): Promise<SourceItem[]> {
        const all = await this.getSignals(categoryId, platform);
        // Filter out backfills if we have real data
        const real = all.filter(s => !s.is_backfilled);
        
        if (real.length > 0) {
            return real.slice(0, 5);
        }
        
        // If no real data, return whatever we have (maybe empty)
        return all.slice(0, 5);
    },

    /**
     * Gets a larger context window for Synthesis.
     */
    async getSynthesisContext(categoryId: string, platform: string): Promise<SourceItem[]> {
        const all = await this.getSignals(categoryId, platform);
        return all.slice(0, 20); // Provide up to 20 for AI context
    }
};