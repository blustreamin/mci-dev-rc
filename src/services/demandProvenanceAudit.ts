
import { SnapshotResolver } from './snapshotResolver';
import { CategorySnapshotStore } from './categorySnapshotStore';
import { SnapshotKeywordRow } from '../types';
import { computeCorpusCounts } from './corpusCounts';

export const DemandProvenanceAudit = {
    computeFingerprint(rows: SnapshotKeywordRow[], categoryId: string, month: string): string {
        const active = rows.filter(r => r.active !== false);
        const valid = active.filter(r => (r.volume || 0) > 0);
        const sumGoogle = valid.reduce((s, r) => s + (r.volume || 0), 0);
        const sumAmazon = active.reduce((s, r) => s + (r.amazonVolume || 0), 0);
        return `${month}:${categoryId}:${active.length}:${valid.length}:${sumGoogle}:${sumAmazon}`;
    },

    /**
     * strict audit that verifies demand metrics are derived solely from the active snapshot rows.
     */
    async auditCategory(categoryId: string, month: string = "UNKNOWN"): Promise<{ ok: boolean; data?: any; fingerprint?: string; error?: string; counts?: any }> {
        try {
            // 1. Resolve Active Snapshot via CorpusIndex (Source of Truth)
            const res = await SnapshotResolver.resolveActiveSnapshot(categoryId, 'IN', 'en');
            
            if (!res.ok || !res.snapshot) {
                return { ok: false, error: "NO_SNAPSHOT" };
            }

            const snapshotId = res.snapshot.snapshot_id;

            // 2. Load Rows directly from storage
            // This bypasses any in-memory caches or UI aggregates
            const rowsRes = await CategorySnapshotStore.readAllKeywordRows(
                { categoryId, countryCode: 'IN', languageCode: 'en' }, 
                snapshotId
            );

            if (!rowsRes.ok) {
                 return { ok: false, error: "SNAPSHOT_READ_FAIL" };
            }

            const rows = rowsRes.data;
            if (rows.length === 0) {
                 return { ok: false, error: "EMPTY_SNAPSHOT" };
            }

            // 3. Compute Aggregates from rows (Proof of Calculation)
            let sumGoogle = 0;
            let sumAmazon = 0;
            
            // MetricsCalculatorV3 Logic Mirror: Active & Volume > 0
            rows.forEach(r => {
                if (r.active !== false) { 
                    if ((r.volume || 0) > 0) sumGoogle += r.volume!;
                    if ((r.amazonVolume || 0) > 0) sumAmazon += r.amazonVolume!;
                }
            });

            const fingerprint = this.computeFingerprint(rows, categoryId, month);
            
            // NEW: Canonical counts
            const counts = computeCorpusCounts(rows);

            console.log(`[DEMAND_PROVENANCE] Audit Complete: ${categoryId} snap=${snapshotId} rows=${rows.length} google=${sumGoogle} fingerprint=${fingerprint}`);

            return {
                ok: true,
                fingerprint,
                counts, // Return full counts
                data: {
                    snapshotId,
                    rowsLoaded: rows.length,
                    sumGoogleVolumeActiveRows: sumGoogle,
                    sumAmazonVolumeActiveRows: sumAmazon,
                    sourceOfTruth: "SNAPSHOT_ROWS_ONLY"
                }
            };

        } catch (e: any) {
            return { ok: false, error: e.message };
        }
    }
};
