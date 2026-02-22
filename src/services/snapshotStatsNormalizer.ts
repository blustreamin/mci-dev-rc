
import { CategorySnapshotStore } from './categorySnapshotStore';
import { SnapshotKeywordRow } from '../types';
import { FirestoreClient } from './firestoreClient';

export const SnapshotStatsNormalizer = {
    async normalizeSnapshotStats(
        categoryId: string, 
        snapshotId: string, 
        rows: SnapshotKeywordRow[], 
        country: string, 
        lang: string
    ): Promise<string[]> {
        const logs: string[] = [];
        
        try {
            // 1. Calculate Stats (Relaxed Rule: trust volume > 0)
            const total = rows.length;
            const valid = rows.filter(r => r.active && (r.status === 'VALID' || (r.volume || 0) > 0)).length;
            const zero = rows.filter(r => r.active && (r.status === 'ZERO' || (r.volume || 0) === 0)).length;
            
            const validated = rows.filter(r => r.status !== 'UNVERIFIED').length;
            const low = rows.filter(r => r.status === 'LOW').length;
            const error = rows.filter(r => r.status === 'ERROR').length;
            const unverified = total - validated;

            const perAnchorValid: Record<string, number> = {};
            const perAnchorTotal: Record<string, number> = {};

            rows.forEach(r => {
                const aid = r.anchor_id || 'unknown';
                perAnchorTotal[aid] = (perAnchorTotal[aid] || 0) + 1;
                if (r.active && (r.status === 'VALID' || (r.volume || 0) > 0)) {
                    perAnchorValid[aid] = (perAnchorValid[aid] || 0) + 1;
                }
            });
            
            // Sample Status Counts for Debug
            const sampleStatusCounts: Record<string, number> = {};
            rows.slice(0, 100).forEach(r => {
                sampleStatusCounts[r.status] = (sampleStatusCounts[r.status] || 0) + 1;
            });

            // 2. Get Snapshot
            const snapRes = await CategorySnapshotStore.getSnapshotById({ categoryId, countryCode: country, languageCode: lang }, snapshotId);
            if (!snapRes.ok) {
                logs.push(`[STATS_NORMALIZE][FAIL] Snapshot not found ${snapshotId}`);
                return logs;
            }
            const snap = snapRes.data;

            // 3. Update Stats
            snap.stats = {
                anchors_total: snap.anchors.length,
                keywords_total: total,
                valid_total: valid,
                zero_total: zero,
                validated_total: validated,
                low_total: low,
                error_total: error,
                per_anchor_total_counts: perAnchorTotal,
                per_anchor_valid_counts: perAnchorValid
            };
            snap.updated_at_iso = new Date().toISOString();

            // 4. Write Back
            await CategorySnapshotStore.writeSnapshot(snap);
            logs.push(`[STATS_NORMALIZE][DONE] ${snapshotId} valid=${valid}/${total}`);
            
            const summary = `[VALIDATION_DONE] category=${categoryId} rows=${total} valid=${valid} zero=${zero} unverified=${unverified} sampleStatusCounts=${JSON.stringify(sampleStatusCounts)}`;
            console.log(summary);
            logs.push(summary);

            // Log Sample Rows
            if (rows.length > 0) {
                 const sample = rows.slice(0, 3).map(r => `${r.keyword_text}:${r.status}:${r.volume}`).join(', ');
                 console.log(`[VALIDATION_SAMPLE] ${sample}`);
            }
            
            return logs;
        } catch (e: any) {
            logs.push(`[STATS_NORMALIZE][ERROR] ${e.message}`);
            return logs;
        }
    }
};
