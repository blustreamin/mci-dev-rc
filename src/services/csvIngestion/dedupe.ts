
import { SeedKeywordRow } from './types';

export const Dedupe = {
    process(rows: SeedKeywordRow[]): { uniqueRows: SeedKeywordRow[], removedCount: number } {
        const map = new Map<string, SeedKeywordRow>();
        let removed = 0;

        for (const row of rows) {
            const key = row.keywordKey;
            
            if (!map.has(key)) {
                map.set(key, row);
            } else {
                const existing = map.get(key)!;
                // Conflict Resolution Logic
                
                // 1. Prefer Resolved Volume over Unresolved
                if (existing.baseVolume === null && row.baseVolume !== null) {
                    map.set(key, row);
                }
                // 2. Prefer Higher Volume if both resolved
                else if (existing.baseVolume !== null && row.baseVolume !== null) {
                    if (row.baseVolume > existing.baseVolume) {
                        map.set(key, row);
                    }
                }
                // 3. Prefer More Metadata (Trend)
                else if (row.trend_5y_cagr_pct !== undefined && existing.trend_5y_cagr_pct === undefined) {
                    map.set(key, row);
                }
                
                removed++;
            }
        }

        return {
            uniqueRows: Array.from(map.values()),
            removedCount: removed
        };
    }
};
