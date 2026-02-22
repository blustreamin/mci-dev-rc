
import { SnapshotKeywordRow } from '../types';

/**
 * Single Source of Truth for Corpus Validity (Certification V2).
 * Enforces Google-Volume-Only logic, ignoring Amazon volume for certification gates.
 */
export const CorpusValidity = {
    getGoogleVolume(row: SnapshotKeywordRow): number {
        return row.volume || 0;
    },

    isGoogleValidRow(row: SnapshotKeywordRow): boolean {
        // Certification Validity V2: Active AND Google Volume > 0
        // We ignore amazonVolume completely for certification purposes.
        return (row.active !== false) && ((row.volume || 0) > 0);
    },

    isGoogleZeroRow(row: SnapshotKeywordRow): boolean {
        // Active but 0 Google volume
        return (row.active !== false) && ((row.volume || 0) === 0);
    },
    
    /**
     * Computes per-anchor validity stats (count & max head volume).
     * Used for "Anchor Passing" check: needs count >= 20 AND maxVol >= 1000.
     */
    getAnchorStats(rows: SnapshotKeywordRow[]) {
        const stats = new Map<string, { valid: number, maxVol: number }>();
        
        rows.forEach(r => {
            if (this.isGoogleValidRow(r)) {
                if (!stats.has(r.anchor_id)) stats.set(r.anchor_id, { valid: 0, maxVol: 0 });
                const s = stats.get(r.anchor_id)!;
                s.valid++;
                s.maxVol = Math.max(s.maxVol, this.getGoogleVolume(r));
            }
        });
        
        return stats;
    }
};
