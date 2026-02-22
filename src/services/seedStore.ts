
import { StorageAdapter } from './storageAdapter';
import { SeedKeywordRow, SeedMeta } from './csvIngestion/types';

export const SeedStore = {
    
    getMetaKey(categoryId: string, monthWindowId: string): string {
        return `${categoryId}|${monthWindowId}`;
    },

    getCombinedKey(categoryId: string, monthWindowId: string, keywordKey: string): string {
        return `${categoryId}|${monthWindowId}|${keywordKey}`;
    },

    // --- Meta Operations ---

    async getSeedMeta(categoryId: string, monthWindowId: string): Promise<SeedMeta | null> {
        return await StorageAdapter.get<SeedMeta>(
            this.getMetaKey(categoryId, monthWindowId), 
            StorageAdapter.STORES.SEED_META
        );
    },

    async saveSeedMeta(meta: SeedMeta): Promise<void> {
        await StorageAdapter.set(
            this.getMetaKey(meta.categoryId, meta.monthWindowId), 
            meta, 
            StorageAdapter.STORES.SEED_META
        );
    },

    // --- Keyword Operations ---

    async saveSeedKeywords(rows: SeedKeywordRow[]): Promise<void> {
        // This is a batch op, but IDB wrapper is single put. 
        // In prod we'd use a transaction. For V1 we iterate.
        // Optimization: Parallelize promises.
        const promises = rows.map(row => 
            StorageAdapter.set(
                this.getCombinedKey(row.categoryId, row.monthWindowId, row.keywordKey),
                row,
                StorageAdapter.STORES.SEED_KEYWORDS
            )
        );
        await Promise.all(promises);
    },

    /**
     * Retrieves all seed keywords for a specific category/month.
     * Note: This uses a scan filter which can be slow for massive datasets, 
     * but fine for typical 1-5k keyword sets.
     */
    async getSeedKeywords(categoryId: string, monthWindowId: string): Promise<SeedKeywordRow[]> {
        const allKeys = await StorageAdapter.getAllKeys(StorageAdapter.STORES.SEED_KEYWORDS);
        const prefix = `${categoryId}|${monthWindowId}|`;
        
        const matchingKeys = allKeys.filter(k => k.startsWith(prefix));
        
        const rows: SeedKeywordRow[] = [];
        // Fetch in batches to avoid locking UI
        const BATCH = 50;
        for (let i = 0; i < matchingKeys.length; i += BATCH) {
            const batchKeys = matchingKeys.slice(i, i + BATCH);
            const batchPromises = batchKeys.map(k => 
                StorageAdapter.get<SeedKeywordRow>(k, StorageAdapter.STORES.SEED_KEYWORDS)
            );
            const batchResults = await Promise.all(batchPromises);
            batchResults.forEach(r => { if(r) rows.push(r); });
        }
        return rows;
    }
};
