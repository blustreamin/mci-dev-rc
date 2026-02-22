
import { StorageAdapter } from './storageAdapter';
import { Normalization } from './normalization';

export interface MasterCsvRecord {
    operatingMonth: string; // YYYY-MM
    categoryId: string;
    keywordNormalized: string;
    rawKeyword: string;
    volume: number; // Strictly > 0
    timeSeries?: { date: string; volume: number }[];
    ingestedAt: string;
}

const STORE_NAME = 'master_csv_store';

export const MasterCsvStore = {
    
    getKey(categoryId: string, operatingMonth: string, keywordNormalized: string): string {
        return `${categoryId}::${operatingMonth}::${keywordNormalized}`;
    },

    async saveRecords(records: MasterCsvRecord[]): Promise<void> {
        // In IDB adapter, we loop. In better implementation, transaction.
        const promises = records.map(r => 
            StorageAdapter.set(
                this.getKey(r.categoryId, r.operatingMonth, r.keywordNormalized),
                r,
                STORE_NAME
            )
        );
        await Promise.all(promises);
    },

    async getRecord(categoryId: string, operatingMonth: string, keywordNormalized: string): Promise<MasterCsvRecord | null> {
        return await StorageAdapter.get<MasterCsvRecord>(
            this.getKey(categoryId, operatingMonth, keywordNormalized),
            STORE_NAME
        );
    },

    /**
     * Efficiently retrieves all records for a category/month.
     * Note: This assumes StorageAdapter.getAllKeys works for this store.
     */
    async getCategoryRecords(categoryId: string, operatingMonth: string): Promise<MasterCsvRecord[]> {
        const allKeys = await StorageAdapter.getAllKeys(STORE_NAME);
        const prefix = `${categoryId}::${operatingMonth}::`;
        const matching = allKeys.filter(k => k.startsWith(prefix));
        
        const records: MasterCsvRecord[] = [];
        // Batch fetch
        const BATCH = 50;
        for (let i = 0; i < matching.length; i += BATCH) {
            const batchKeys = matching.slice(i, i + BATCH);
            const batch = await Promise.all(batchKeys.map(k => StorageAdapter.get<MasterCsvRecord>(k, STORE_NAME)));
            batch.forEach(r => { if(r) records.push(r); });
        }
        return records;
    },

    async clearCategory(categoryId: string, operatingMonth: string): Promise<void> {
        const allKeys = await StorageAdapter.getAllKeys(STORE_NAME);
        const prefix = `${categoryId}::${operatingMonth}::`;
        const matching = allKeys.filter(k => k.startsWith(prefix));
        await Promise.all(matching.map(k => StorageAdapter.remove(k, STORE_NAME)));
    }
};
