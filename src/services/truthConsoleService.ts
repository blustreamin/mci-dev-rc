
import { StorageAdapter } from './storageAdapter';
import { VolumeTruthStore, TruthVolume } from './volumeTruthStore';
import { WindowingService, WindowMeta } from './windowing';

// --- Types ---

export interface ConsoleSnapshot extends WindowMeta {
    isLatestStable: boolean;
}

export interface KeywordSummary {
    keywordId: string;
    keywordText: string;
    volume: number;
    demandScore: number;
    trend6m: number;
}

// --- Service ---

export const TruthConsoleService = {
    
    /**
     * GET /internal/truthstore/snapshots
     * Lists all snapshots (windows) with metadata and stability status.
     */
    async listSnapshots(): Promise<ConsoleSnapshot[]> {
        const keys = await StorageAdapter.getAllKeys();
        const metaKeys = keys.filter(k => k.startsWith('window_meta::'));
        const latestStableId = await WindowingService.getLatestStableWindowId();

        const snapshots: ConsoleSnapshot[] = [];
        for (const key of metaKeys) {
            const meta = await StorageAdapter.get<WindowMeta>(key);
            if (meta) {
                snapshots.push({
                    ...meta,
                    isLatestStable: meta.id === latestStableId
                });
            }
        }
        
        // Sort descending by ID (approx chronological)
        return snapshots.sort((a, b) => b.id.localeCompare(a.id));
    },

    /**
     * POST /internal/truthstore/snapshots/:snapshot_id/set-latest-stable
     */
    async setLatestStable(snapshotId: string): Promise<void> {
        // Verify existence
        const isSealed = await WindowingService.isWindowSealed(snapshotId);
        if (!isSealed) throw new Error(`Snapshot ${snapshotId} is not sealed or does not exist.`);
        
        await WindowingService.setLatestStableWindowId(snapshotId);
    },

    /**
     * GET /internal/truthstore/keywords/search
     * Scans keys for a specific snapshot.
     * Note: This is an expensive operation in IDB (O(N) scan). Use mainly for debugging.
     */
    async searchKeywords(snapshotId: string, query: string, limit = 50): Promise<KeywordSummary[]> {
        // Truth keys format: truth::{windowId}::{normalizedKeyword}
        const prefix = `truth::${snapshotId}::`;
        const allKeys = await StorageAdapter.getAllKeys();
        const snapshotKeys = allKeys.filter(k => k.startsWith(prefix));
        
        const results: KeywordSummary[] = [];
        const lowerQuery = query.toLowerCase();

        for (const key of snapshotKeys) {
            if (results.length >= limit) break;
            
            // Optimization: checking key string before fetch
            if (!key.includes(lowerQuery)) continue;

            const record = await StorageAdapter.get<TruthVolume>(key);
            if (record) {
                // Re-check query against actual text if needed, but key match is usually enough
                results.push({
                    keywordId: record.keywordKey,
                    keywordText: record.keywordKey, // Original text might be lost if strictly normalized, but usually we map back or store it. TruthVolume schema has keywordKey.
                    volume: record.truthVolume,
                    demandScore: record.derivedMetrics?.demandScore || 0,
                    trend6m: record.derivedMetrics?.trend6m || 0
                });
            }
        }
        
        return results.sort((a, b) => b.volume - a.volume);
    },

    /**
     * GET /internal/truthstore/keywords/:keyword_id/derived
     */
    async getKeywordDetails(snapshotId: string, keywordKey: string): Promise<TruthVolume | null> {
        return await VolumeTruthStore.getTruthVolume(keywordKey, snapshotId);
    },

    /**
     * GET /internal/truthstore/health
     * Basic connectivity check.
     */
    async checkHealth(): Promise<{ status: string; store: string; records: number }> {
        const keys = await StorageAdapter.getAllKeys();
        return {
            status: 'OK',
            store: 'IndexedDB',
            records: keys.length
        };
    }
};
