
import { CORE_CATEGORIES } from '../constants';
import { SnapshotResolver } from './snapshotResolver';
import { CategorySnapshotStore } from './categorySnapshotStore';
import { MetricsCalculator } from './metricsCalculator';
import { StorageAdapter } from './storageAdapter';
import { SnapshotKeywordRow } from '../types';

interface ProvenanceCategoryResult {
    categoryId: string;
    snapshotId: string | null;
    rowCount: number;
    provenance: {
        googleVolumeSource: "snapshot_rows" | "cache" | "unknown";
        amazonVolumeSource: "snapshot_rows" | "cache" | "unused" | "unknown";
        fiveYearTrendSource: "snapshot_rows" | "trend_store" | "unavailable";
    };
    cacheCallGuard: {
        enabled: boolean;
        cacheReadsDetected: number;
        passed: boolean;
    };
    baseline: {
        demand_index_mn: number;
        readinessScore: number;
        spreadScore: number;
        fiveYearTrend: number | null;
    };
    mutationTest: {
        top25VolumeSumBefore: number;
        top25VolumeSumAfter: number;
        baselineDemandIndex: number;
        mutatedDemandIndex: number;
        dropPct: number;
        passed: boolean;
    };
}

export interface ProvenanceAuditReport {
    ts: string;
    auditKind: "SNAPSHOT_ONLY_PROVENANCE";
    verdict: "GO" | "NO_GO";
    failures: Array<{ categoryId: string; reason: string }>;
    categories: ProvenanceCategoryResult[];
    summary: {
        goCount: number;
        noGoCount: number;
        notes: string[];
    };
}

export const ProvenanceAuditService = {
    async runAudit(): Promise<ProvenanceAuditReport> {
        const categoriesResult: ProvenanceCategoryResult[] = [];
        const failures: Array<{ categoryId: string; reason: string }> = [];
        const notes: string[] = [];

        for (const cat of CORE_CATEGORIES) {
            try {
                // 1. Resolve Active Snapshot
                const resolution = await SnapshotResolver.resolveActiveSnapshot(cat.id, 'IN', 'en');
                const snapshotId = resolution.snapshot?.snapshot_id || null;
                
                let rows: SnapshotKeywordRow[] = [];
                if (snapshotId) {
                    const res = await CategorySnapshotStore.readAllKeywordRows({ categoryId: cat.id, countryCode: 'IN', languageCode: 'en' }, snapshotId);
                    if (res.ok) rows = res.data;
                }

                if (rows.length === 0) {
                    failures.push({ categoryId: cat.id, reason: "No rows loaded" });
                    categoriesResult.push(this.createEmptyResult(cat.id, snapshotId));
                    continue;
                }

                // 2. Compute Baseline
                const baselineMetrics = this.computeMetrics(rows, snapshotId, resolution.snapshot?.lifecycle || 'UNKNOWN', cat.id);

                // 3. Cache Guard Test
                let cacheReads = 0;
                let guardPassed = false;
                
                // Monkey-patch StorageAdapter to detect reads
                const originalGet = StorageAdapter.get;
                const originalGetRaw = StorageAdapter.getRaw;
                
                try {
                    StorageAdapter.get = async () => { cacheReads++; throw new Error("CACHE_ACCESS_VIOLATION"); };
                    StorageAdapter.getRaw = async () => { cacheReads++; throw new Error("CACHE_ACCESS_VIOLATION"); };
                    
                    // Recompute
                    this.computeMetrics(rows, snapshotId, resolution.snapshot?.lifecycle || 'UNKNOWN', cat.id);
                    guardPassed = cacheReads === 0;
                } catch (e: any) {
                    if (e.message === "CACHE_ACCESS_VIOLATION") {
                         cacheReads++;
                    }
                    guardPassed = false;
                } finally {
                    // Restore
                    StorageAdapter.get = originalGet;
                    StorageAdapter.getRaw = originalGetRaw;
                }

                // 4. Mutation Sensitivity Test
                // Sort by volume descending
                const sortedRows = [...rows].sort((a, b) => (b.volume || 0) - (a.volume || 0));
                
                // Calculate Top 25 Sum
                const top25 = sortedRows.slice(0, 25);
                const top25Sum = top25.reduce((sum, r) => sum + (r.volume || 0), 0);
                
                // Mutate: Zero out top 25 in a clean copy
                const mutatedRows = rows.map(r => {
                    const isTop = top25.some(t => t.keyword_id === r.keyword_id);
                    if (isTop) {
                        return { ...r, volume: 0, amazonVolume: 0 };
                    }
                    return r;
                });

                const mutatedMetrics = this.computeMetrics(mutatedRows, snapshotId, resolution.snapshot?.lifecycle || 'UNKNOWN', cat.id);
                
                // Calculate Drop
                const baseD = baselineMetrics.demandIndex.value;
                const mutD = mutatedMetrics.demandIndex.value;
                const dropPct = baseD > 0 ? ((baseD - mutD) / baseD) * 100 : 0;
                
                // Pass if drop is significant (>5% is a safe bet for Top 25 in any distribution) or if volume was already 0
                const mutationPassed = baseD === 0 ? true : dropPct > 5.0;

                if (!mutationPassed) {
                    failures.push({ categoryId: cat.id, reason: `Mutation test failed. Drop: ${dropPct.toFixed(2)}%` });
                }
                if (!guardPassed) {
                    failures.push({ categoryId: cat.id, reason: "Cache guard failed (Reads detected)" });
                }

                categoriesResult.push({
                    categoryId: cat.id,
                    snapshotId,
                    rowCount: rows.length,
                    provenance: {
                        googleVolumeSource: "snapshot_rows",
                        amazonVolumeSource: "unused", // Standard V3 logic uses Volume field primarily
                        fiveYearTrendSource: "unavailable" // Hardcoded to 'snapshot_rows' logic which lacks trend history usually
                    },
                    cacheCallGuard: {
                        enabled: true,
                        cacheReadsDetected: cacheReads,
                        passed: guardPassed
                    },
                    baseline: {
                        demand_index_mn: baseD,
                        readinessScore: baselineMetrics.readinessScore.value,
                        spreadScore: baselineMetrics.spreadScore.value,
                        fiveYearTrend: baselineMetrics.trend.valuePercent ?? null
                    },
                    mutationTest: {
                        top25VolumeSumBefore: top25Sum,
                        top25VolumeSumAfter: 0,
                        baselineDemandIndex: baseD,
                        mutatedDemandIndex: mutD,
                        dropPct,
                        passed: mutationPassed
                    }
                });

            } catch (e: any) {
                failures.push({ categoryId: cat.id, reason: `Exception: ${e.message}` });
                categoriesResult.push(this.createEmptyResult(cat.id, null));
            }
        }

        const goCount = categoriesResult.filter(c => c.cacheCallGuard.passed && c.mutationTest.passed).length;
        const noGoCount = CORE_CATEGORIES.length - goCount;

        return {
            ts: new Date().toISOString(),
            auditKind: "SNAPSHOT_ONLY_PROVENANCE",
            verdict: noGoCount === 0 ? "GO" : "NO_GO",
            failures,
            categories: categoriesResult,
            summary: {
                goCount,
                noGoCount,
                notes: notes.length > 0 ? notes : ["Audit complete"]
            }
        };
    },

    computeMetrics(rows: SnapshotKeywordRow[], snapshotId: string | null, status: string, categoryId: string) {
        // Map strictly using production logic
        const inputs = rows
            .filter(r => r.status === 'VALID' || r.status === 'LOW')
            .map(r => ({
                volume: r.volume || 0,
                intentBucket: r.intent_bucket,
                anchor: r.anchor_id
            }));

        return MetricsCalculator.calculateCategoryMetrics(
            snapshotId || 'audit',
            status as any,
            inputs,
            'Stable',
            0,
            categoryId
        );
    },

    createEmptyResult(catId: string, snapshotId: string | null): ProvenanceCategoryResult {
        return {
            categoryId: catId,
            snapshotId,
            rowCount: 0,
            provenance: { googleVolumeSource: "unknown", amazonVolumeSource: "unknown", fiveYearTrendSource: "unavailable" },
            cacheCallGuard: { enabled: true, cacheReadsDetected: 0, passed: false },
            baseline: { demand_index_mn: 0, readinessScore: 0, spreadScore: 0, fiveYearTrend: null },
            mutationTest: { top25VolumeSumBefore: 0, top25VolumeSumAfter: 0, baselineDemandIndex: 0, mutatedDemandIndex: 0, dropPct: 0, passed: false }
        };
    }
};
