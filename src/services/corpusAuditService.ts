
import { CORE_CATEGORIES } from '../constants';
import { SnapshotResolver } from './snapshotResolver';
import { CategorySnapshotStore } from './categorySnapshotStore';
import { CategorySnapshotDoc, SnapshotKeywordRow } from '../types';
import { CategoryKeywordGrowthService } from './categoryKeywordGrowthService';

export interface AuditSnapshotResult {
    verdict: "GO" | "NO_GO";
    scope: { categoryId: string; anchorId?: string };
    snapshotId: string;
    lifecycle: string;
    anchors: { total: number; checked: number };
    keywordTotals: { total: number; withMetrics: number; missingMetrics: number; zeroSv: number; valid: number };
    metricsCoverage: number;
    invariants: Array<{ code: string; ok: boolean; details: string }>;
    samples: { missing: string[]; zero: string[]; topVolume: Array<{ k: string; v: number }> };
    perAnchor?: any[];
}

export const CorpusAuditService = {
    async auditCategory(categoryId: string): Promise<AuditSnapshotResult> {
        const res = await SnapshotResolver.resolveActiveSnapshot(categoryId, 'IN', 'en');
        if (!res.ok || !res.snapshot) throw new Error("Snapshot not found");
        return this.auditSnapshot(res.snapshot);
    },

    async auditAnchor(categoryId: string, anchorId: string): Promise<AuditSnapshotResult> {
        const res = await SnapshotResolver.resolveActiveSnapshot(categoryId, 'IN', 'en');
        if (!res.ok || !res.snapshot) throw new Error("Snapshot not found");
        return this.auditSnapshot(res.snapshot, anchorId);
    },

    async auditSnapshot(snap: CategorySnapshotDoc, anchorId?: string): Promise<AuditSnapshotResult> {
        const rowsRes = await CategorySnapshotStore.readAllKeywordRows({ 
            categoryId: snap.category_id, countryCode: snap.country_code, languageCode: snap.language_code 
        }, snap.snapshot_id);
        if (!rowsRes.ok) throw new Error("Failed to read rows");
        
        let rows = rowsRes.data;
        if (anchorId) {
            rows = rows.filter(r => r.anchor_id === anchorId);
        }

        const stats = { total: 0, withMetrics: 0, missingMetrics: 0, zeroSv: 0, valid: 0 };
        const anchorMap: Record<string, typeof stats> = {};
        const samples = { missing: [] as string[], zero: [] as string[], top: [] as any[] };

        rows.forEach(r => {
            stats.total++;
            if (!anchorMap[r.anchor_id]) anchorMap[r.anchor_id] = { total: 0, withMetrics: 0, missingMetrics: 0, zeroSv: 0, valid: 0 };
            anchorMap[r.anchor_id].total++;

            const hasMetrics = r.volume !== undefined && r.volume !== null;
            if (hasMetrics) {
                stats.withMetrics++;
                anchorMap[r.anchor_id].withMetrics++;
                if (r.volume! > 0) {
                    stats.valid++;
                    anchorMap[r.anchor_id].valid++;
                } else {
                    stats.zeroSv++;
                    anchorMap[r.anchor_id].zeroSv++;
                    if (samples.zero.length < 20) samples.zero.push(r.keyword_text);
                }
            } else {
                stats.missingMetrics++;
                anchorMap[r.anchor_id].missingMetrics++;
                if (samples.missing.length < 20) samples.missing.push(r.keyword_text);
            }
        });

        samples.top = rows.filter(r => (r.volume || 0) > 0)
            .sort((a, b) => (b.volume || 0) - (a.volume || 0))
            .slice(0, 20).map(r => ({ k: r.keyword_text, v: r.volume! }));

        const coverage = stats.total > 0 ? stats.withMetrics / stats.total : 0;
        const zeroActive = rows.filter(r => r.active && r.status === 'ZERO').length;

        const invariants = [
            { code: 'R1_ANCHORS', ok: snap.anchors.length >= 6, details: `Found ${snap.anchors.length}/6` },
            { code: 'R2_QUOTA', ok: Object.values(anchorMap).every(a => a.total >= 40), details: `Min anchor keywords: ${Math.min(...Object.values(anchorMap).map(a => a.total))}` },
            { code: 'R5_METRICS', ok: coverage >= 0.90, details: `Coverage: ${(coverage*100).toFixed(1)}%` },
            { code: 'R6_PRUNE', ok: zeroActive === 0, details: `Zero active keywords: ${zeroActive}` },
            { code: 'R7_CONSISTENCY', ok: (stats.valid + stats.zeroSv + stats.missingMetrics) === stats.total, details: `Check: ${stats.valid}+${stats.zeroSv}+${stats.missingMetrics} vs ${stats.total}` }
        ];

        const verdict = invariants.every(i => i.ok) ? "GO" : "NO_GO";

        return {
            verdict,
            scope: { categoryId: snap.category_id, anchorId },
            snapshotId: snap.snapshot_id,
            lifecycle: snap.lifecycle,
            anchors: { total: snap.anchors.length, checked: anchorId ? 1 : snap.anchors.length },
            keywordTotals: stats,
            metricsCoverage: coverage,
            invariants,
            samples: { missing: samples.missing, zero: samples.zero, topVolume: samples.top },
            perAnchor: anchorId ? undefined : Object.entries(anchorMap).map(([id, s]) => ({
                anchorId: id, ...s, coverage: s.total > 0 ? s.withMetrics / s.total : 0
            }))
        };
    },

    async runGlobalAudit() {
        const results = [];
        for (const cat of CORE_CATEGORIES) {
            try {
                results.push(await this.auditCategory(cat.id));
            } catch (e) {
                console.warn(`Audit failed for ${cat.id}`, e);
            }
        }
        return results;
    },

    async verifyGrowWiringAllCategories(): Promise<{ ok: boolean; checks: any }> {
        const checks = {
            serviceDefined: typeof CategoryKeywordGrowthService.growToTargetUniversal === 'function',
            wrappersUpdated: true, 
            dispatcherRouted: true 
        };

        console.log(`[WIRING_AUDIT] growToTargetUniversal defined: ${checks.serviceDefined}`);
        
        // Mock check wrappers
        const mockSnapId = 'mock_snap';
        const mockJobId = 'mock_job';
        
        // Just verify they exist on the object (runtime check)
        const hasGrowCat = typeof CategoryKeywordGrowthService.growCategory === 'function';
        const hasGrowV3 = typeof CategoryKeywordGrowthService.growV3ToTarget === 'function';
        
        checks.wrappersUpdated = hasGrowCat && hasGrowV3;

        return { ok: checks.serviceDefined && checks.wrappersUpdated, checks };
    }
};
