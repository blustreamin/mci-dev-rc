
import { normalizeKeywordString } from '../../../driftHash';

export interface RawCsvRow {
    originalKeyword: string;
    volume: number;
    monthlySeries: { date: string; volume: number }[]; // YYYY-MM
    raw: any;
}

export interface CollapsedConcept {
    canonicalKeyword: string;
    conceptKey: string;
    aggregateVolume: number;
    variantCount: number;
    variants: string[];
    monthlySeries: { date: string; volume: number }[];
    representativeRow: RawCsvRow;
}

export const Canonicalize = {
    
    normalize(text: string): string {
        // Basic cleanup for key generation, but preserve text
        return normalizeKeywordString(text);
    },

    /**
     * EXACT DEDUPLICATION:
     * Does NOT collapse "best razor" and "razor best".
     * Only merges rows that are string-identical after normalization.
     * Keeps the row with the highest volume/fidelity.
     */
    collapse(rows: RawCsvRow[]): CollapsedConcept[] {
        const uniqueMap = new Map<string, RawCsvRow>();

        // 1. Deduplicate by Exact Normalized String
        for (const row of rows) {
            const key = this.normalize(row.originalKeyword);
            
            if (!uniqueMap.has(key)) {
                uniqueMap.set(key, row);
            } else {
                const existing = uniqueMap.get(key)!;
                
                // Conflict Resolution: Max Volume
                if (row.volume > existing.volume) {
                    uniqueMap.set(key, row);
                }
                // Tie-break: Prefer series data
                else if (row.volume === existing.volume && row.monthlySeries.length > existing.monthlySeries.length) {
                    uniqueMap.set(key, row);
                }
            }
        }

        // 2. Map to Concept Structure
        // In this "granularity preserved" mode, 1 Concept = 1 Keyword
        return Array.from(uniqueMap.entries()).map(([key, row]) => ({
            canonicalKeyword: row.originalKeyword, // Keep original casing/formatting for display
            conceptKey: key,
            aggregateVolume: row.volume,
            variantCount: 1, // No merging happened
            variants: [row.originalKeyword],
            monthlySeries: row.monthlySeries,
            representativeRow: row
        }));
    }
};
