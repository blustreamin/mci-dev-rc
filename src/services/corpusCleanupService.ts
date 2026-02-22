
import { CategorySnapshotStore } from './categorySnapshotStore';
import { SnapshotKeywordRow } from '../types';
import { FirestoreClient } from './firestoreClient';

export const CorpusCleanupService = {
    async cleanupZeroSvKeywords(categoryId: string, snapshotId: string): Promise<{ ok: boolean; zeroMarked: number; }> {
        const params = { categoryId, countryCode: 'IN', languageCode: 'en' };
        
        try {
            // 1. Read Rows
            const rowsRes = await CategorySnapshotStore.readAllKeywordRows(params, snapshotId);
            if (!rowsRes.ok) return { ok: false, zeroMarked: 0 };
            
            const rows = rowsRes.data;
            let markedCount = 0;

            // 2. Update logic
            const updatedRows = rows.map(row => {
                const hasExplicitZero = row.volume !== undefined && row.volume === 0;
                const isZeroStatus = row.status === 'ZERO';
                
                // Rule: Explicit search_volume === 0
                if (hasExplicitZero || isZeroStatus) {
                    // Check if already processed (optimization)
                    
                    // We mark as ZERO status which is the canonical "Invalid due to no volume" state.
                    if (row.status !== 'ZERO') {
                        markedCount++;
                        return {
                            ...row,
                            status: 'ZERO' as const, // Strict type
                            valid: false, // implied by status usually, but for safety
                            validation_tier: undefined // Clear tier
                        };
                    }
                }
                return row;
            });

            if (markedCount > 0) {
                // 3. Write back
                const writeRes = await CategorySnapshotStore.writeKeywordRows(params, snapshotId, updatedRows as SnapshotKeywordRow[]);
                if (!writeRes.ok) throw new Error("Cleanup write failed");

                // 4. Update Snapshot Stats
                const snapRes = await CategorySnapshotStore.getSnapshotById(params, snapshotId);
                if (snapRes.ok) {
                    const snap = snapRes.data;
                    const validTotal = updatedRows.filter(r => r.status === 'VALID' || r.status === 'LOW').length;
                    const zeroTotal = updatedRows.filter(r => r.status === 'ZERO').length;
                    
                    snap.stats.valid_total = validTotal;
                    snap.stats.zero_total = zeroTotal;
                    snap.updated_at_iso = new Date().toISOString();
                    
                    await CategorySnapshotStore.writeSnapshot(snap);
                }
            }

            return { ok: true, zeroMarked: markedCount };
        } catch (e) {
            console.error(`[CLEANUP] Failed for ${categoryId}`, e);
            return { ok: false, zeroMarked: 0 };
        }
    }
};
