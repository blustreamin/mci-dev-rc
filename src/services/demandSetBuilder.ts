
import { SnapshotKeywordRow } from '../types';

export type DemandSet = {
    rowsUsed: SnapshotKeywordRow[];
    totalVolumeUsed: number;
    cappedKeywordCount: number;
    originalVolume: number;
};

/**
 * Dedicated predicate for Demand Metrics ONLY.
 * Treats any active keyword with volume as a valid demand signal.
 */
export function isDemandEligible(row: SnapshotKeywordRow): boolean {
    const vol = Number(row.volume ?? 0);
    return row.active !== false && vol > 0;
}

export const DemandSetBuilder = {
    /**
     * Builds a Demand Set from raw snapshot rows.
     * Rules:
     * 1. Uses isDemandEligible (active=true, volume > 0)
     * 2. Ignores status string (UNVERIFIED/ZERO keywords with volume are now included)
     * 3. Hard Cap: No single keyword can contribute > maxShare (default 5%) of TOTAL volume.
     */
    buildDemandSet(rows: SnapshotKeywordRow[], maxShare: number = 0.05): DemandSet {
        // 1. Filter Eligible Rows using the broader demand-only logic
        const eligible = rows.filter(isDemandEligible);

        // 2. Calculate Uncapped Total
        const rawTotal = eligible.reduce((sum, r) => sum + (r.volume || 0), 0);
        
        // 3. Apply Capping
        const capLimit = rawTotal * maxShare;
        let cappedCount = 0;

        const processedRows = eligible.map(r => {
            const vol = r.volume || 0;
            if (vol > capLimit) {
                cappedCount++;
                // Return a copy with capped volume for calculation purposes
                return { ...r, volume: capLimit, _originalVolume: vol };
            }
            return r;
        });

        const finalTotal = processedRows.reduce((sum, r) => sum + (r.volume || 0), 0);

        return {
            rowsUsed: processedRows,
            totalVolumeUsed: finalTotal,
            cappedKeywordCount: cappedCount,
            originalVolume: rawTotal
        };
    }
};
