
import { StorageAdapter } from '../storageAdapter';
import { KeywordVolumeRecord } from '../../types';
import { normalizeKeywordString } from '../../driftHash';

const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 Days

export const KeywordVolumeStore = {
    
    getKey(normalizedKeyword: string): string {
        return normalizedKeyword;
    },

    async getMany(keywords: string[]): Promise<Map<string, KeywordVolumeRecord>> {
        const result = new Map<string, KeywordVolumeRecord>();
        const now = Date.now();

        // Batch reads not supported by generic StorageAdapter, so parallelize
        const promises = keywords.map(async (k) => {
            const norm = normalizeKeywordString(k);
            const key = this.getKey(norm);
            const record = await StorageAdapter.get<KeywordVolumeRecord>(key, StorageAdapter.STORES.VOLUME_CACHE);
            
            if (record) {
                const age = now - new Date(record.fetched_at_iso).getTime();
                if (age < TTL_MS) {
                    result.set(norm, record);
                } else {
                    // Cleanup expired
                    await StorageAdapter.remove(key, StorageAdapter.STORES.VOLUME_CACHE);
                }
            }
        });

        await Promise.all(promises);
        return result;
    },

    async setMany(records: KeywordVolumeRecord[]): Promise<void> {
        const promises = records.map(r => {
            const key = this.getKey(r.keyword_norm);
            return StorageAdapter.set(key, r, StorageAdapter.STORES.VOLUME_CACHE);
        });
        await Promise.all(promises);
    }
};
