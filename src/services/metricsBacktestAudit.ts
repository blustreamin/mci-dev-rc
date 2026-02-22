
import { CORE_CATEGORIES } from '../constants';
import { SnapshotResolver } from './snapshotResolver';
import { CategorySnapshotStore } from './categorySnapshotStore';
import { MetricsCalculatorV3 } from './metricsCalculatorV3';
import { FirestoreClient } from './firestoreClient';
import { DbConnectivityProbe } from './dbConnectivityProbe';
import { doc, setDoc, getDoc, collection } from 'firebase/firestore';
import { normalizeKeywordString } from '../driftHash';
import { TrendRollupService } from './trendRollup';
import { MetricsCalculator } from './metricsCalculator'; // Legacy compat
import { computeCorpusCounts, logCountsConsistency } from './corpusCounts';
import { DemandRunner } from './demandRunner';
import { DateUtils } from '../utils/dateUtils';
import { DemandOutputStore, DEMAND_OUTPUT_VERSION } from './demandOutputStore';

export interface MetricStats {
    median: number;
    min: number;
    max: number;
    deviationPct: number;
}

export interface MetricStatsNullable {
    median: number | null;
    min: number | null;
    max: number | null;
    deviationPct: number;
}

export interface CategoryResult {
    categoryId: string;
    snapshotId: string | null;
    lifecycle: string | null;
    metrics: {
        demand_index_mn: MetricStats;
        readinessScore: MetricStats;
        spreadScore: MetricStats;
        fiveYearTrend: MetricStatsNullable;
    };
    maxDeviationPct: number;
    verdict: 'GO' | 'WARN' | 'MISSING' | 'MISSING_INPUTS';
}

export interface BacktestReport {
    auditId: string;
    ts: string;
    runs: number;
    target: { projectId: string; databaseId: string };
    results: CategoryResult[];
    summary: {
        maxDeviationPctOverall: number;
        medianDeviationPctOverall: number;
        goCount: number;
        warnCount: number;
        missingCount: number;
        perMetricMedianDeviationPctAcrossCategories: {
            demand_index_mn: number;
            readinessScore: number;
            spreadScore: number;
            fiveYearTrend: number;
        };
    };
    kind?: string;
}

export interface Bench25Item {
    categoryId: string;
    snapshotId: string | null;
    lifecycle: string | null;
    verdict: 'GO' | 'WARN' | 'FAIL' | 'MISSING';
    drift: number | null;
    demandMn: number | null;
    readiness: number | null;
    spread: number | null;
}

export interface Bench25Report {
    kind: "bench25_audit";
    auditId: string;
    ts: string;
    runsPerCat: number;
    categoriesTotal: number;
    maxDriftOverallPct: number | null;
    verdictCounts: { GO: number; WARN: number; FAIL: number; MISSING: number };
    results: Bench25Item[];
}

function calculateStats(values: number[]): MetricStats {
    if (values.length === 0) return { median: 0, min: 0, max: 0, deviationPct: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    
    // deviationPct = (max-min)/median * 100 (Handle div by 0)
    const deviationPct = median !== 0 ? ((max - min) / Math.abs(median)) * 100 : 0;

    return { median, min, max, deviationPct };
}

function calculateStatsNullable(values: (number | null)[]): MetricStatsNullable {
    const validValues = values.filter((v): v is number => v !== null);
    if (validValues.length === 0) return { median: null, min: null, max: null, deviationPct: 0 };
    
    const stats = calculateStats(validValues);
    return { ...stats };
}

export const MetricsBacktestAudit = {
    
    // NEW: P0 Bench25 Runner (Flat Output)
    async runBench25(opts: { 
        month: string; 
        categoryIds: string[]; 
        runsPerCat: number; 
        onProgress?: (msg: string, pct: number) => void 
    }): Promise<Bench25Report> {
        const { month, categoryIds, runsPerCat, onProgress } = opts;
        const auditId = `bench25_${Date.now()}`;
        
        const results: Bench25Item[] = [];
        const targetCats = CORE_CATEGORIES.filter(c => categoryIds.includes(c.id));
        let catsProcessed = 0;

        for (const cat of targetCats) {
            catsProcessed++;
            if (onProgress) onProgress(`Bench25: ${cat.category}...`, (catsProcessed / targetCats.length) * 100);

            let verdict: Bench25Item['verdict'] = 'MISSING';
            let snapshotId = null;
            let lifecycle = null;
            const runMetrics: { d: number; r: number; s: number }[] = [];

            try {
                // Pre-check snapshot existence
                const res = await SnapshotResolver.resolveActiveSnapshot(cat.id, 'IN', 'en');
                if (res.ok && res.snapshot) {
                    snapshotId = res.snapshot.snapshot_id;
                    lifecycle = res.snapshot.lifecycle;
                    
                    // Run iterations
                    for (let i = 0; i < runsPerCat; i++) {
                        if (i % 5 === 0) await new Promise(r => setTimeout(r, 0)); // Yield

                        const runRes = await DemandRunner.runDemand({
                            categoryId: cat.id,
                            month: month,
                            country: 'IN',
                            language: 'en',
                            force: true,
                            baselineMode: true, // Deterministic inputs
                            skipPersistence: true,
                            jobId: `${auditId}_${cat.id}_${i}`
                        });

                        if (runRes.ok) {
                            runMetrics.push({
                                d: runRes.demand_index_mn,
                                r: runRes.data.metric_scores.readiness,
                                s: runRes.data.metric_scores.spread
                            });
                        }
                    }

                    // Verdict Logic
                    if (runMetrics.length > 0) {
                        const dStats = calculateStats(runMetrics.map(m => m.d));
                        const maxDev = dStats.deviationPct;
                        
                        if (dStats.median === 0) {
                            verdict = 'MISSING'; // Treated as missing/invalid
                        } else if (maxDev <= 1.0) {
                            verdict = 'GO';
                        } else if (maxDev <= 5.0) {
                            verdict = 'WARN';
                        } else {
                            verdict = 'FAIL'; // Previously WARN, but for 25x we can be stricter or keep FAIL
                        }
                        
                        console.log(`[BENCH25][CAT_DONE] categoryId=${cat.id} maxDrift=${maxDev.toFixed(4)}% verdict=${verdict}`);
                    }
                }
            } catch (e) {
                console.error(`[Bench25] Error ${cat.id}`, e);
            }

            // Compute Item Stats
            const dStats = calculateStats(runMetrics.map(m => m.d));
            const rStats = calculateStats(runMetrics.map(m => m.r));
            const sStats = calculateStats(runMetrics.map(m => m.s));

            results.push({
                categoryId: cat.id,
                snapshotId,
                lifecycle,
                verdict,
                drift: runMetrics.length > 0 ? dStats.deviationPct : null,
                demandMn: runMetrics.length > 0 ? dStats.median : null,
                readiness: runMetrics.length > 0 ? rStats.median : null,
                spread: runMetrics.length > 0 ? sStats.median : null
            });
        }

        // Summary Compute
        const validResults = results.filter(r => r.drift !== null);
        const maxDriftOverallPct = validResults.length > 0 ? Math.max(...validResults.map(r => r.drift!)) : 0;
        
        const verdictCounts = {
            GO: results.filter(r => r.verdict === 'GO').length,
            WARN: results.filter(r => r.verdict === 'WARN').length,
            FAIL: results.filter(r => r.verdict === 'FAIL').length,
            MISSING: results.filter(r => r.verdict === 'MISSING').length
        };
        
        console.log(`[BENCH25][DONE] auditId=${auditId} maxDriftOverall=${maxDriftOverallPct.toFixed(4)}% rows=${results.length}`);

        return {
            kind: "bench25_audit",
            auditId,
            ts: new Date().toISOString(),
            runsPerCat,
            categoriesTotal: targetCats.length,
            maxDriftOverallPct: validResults.length > 0 ? maxDriftOverallPct : null,
            verdictCounts,
            results
        };
    },

    // Backend-Only Console Runner
    async runBench25AuditBackendOnly(month: string = '2026-02'): Promise<void> {
        console.log(`[BENCH25_BACKEND][START] month=${month}`);
        const auditId = `bench25_${Date.now()}`;
        const results: any[] = [];
        
        // Deterministic Sort
        const sortedCats = [...CORE_CATEGORIES].sort((a, b) => a.id.localeCompare(b.id));

        for (const cat of sortedCats) {
            let snapshotId = "UNKNOWN";
            let lifecycle = "UNKNOWN";
            
            try {
                const res = await SnapshotResolver.resolveActiveSnapshot(cat.id, 'IN', 'en');
                if (res.ok && res.snapshot) {
                    snapshotId = res.snapshot.snapshot_id;
                    lifecycle = res.snapshot.lifecycle;
                }
            } catch (e) {
                console.warn(`[BENCH25_BACKEND] Snapshot resolve failed for ${cat.id}`);
            }

            console.log(`[BENCH25_BACKEND][CAT] categoryId=${cat.id} snapshotId=${snapshotId}`);

            const runValues = {
                d: [] as number[],
                r: [] as number[],
                s: [] as number[]
            };

            // Run 25x
            for (let i = 0; i < 25; i++) {
                try {
                    const res = await DemandRunner.runDemand({
                        categoryId: cat.id,
                        month: month,
                        country: 'IN',
                        language: 'en',
                        force: true,
                        baselineMode: true,
                        skipPersistence: true,
                        jobId: `BENCH_BE_${cat.id}_${i}`
                    });
                    
                    if (res.ok) {
                        runValues.d.push(res.demand_index_mn);
                        runValues.r.push(res.data.metric_scores.readiness);
                        runValues.s.push(res.data.metric_scores.spread);
                    }
                } catch (e) {
                    // Ignore individual failures
                }
            }

            if (runValues.d.length === 0) {
                 results.push({
                     categoryId: cat.id,
                     snapshotId,
                     lifecycle,
                     verdict: "MISSING",
                     driftPct: { demand: 0, readiness: 0, spread: 0, max: 0 },
                     median: { demandMn: 0, readiness: 0, spread: 0 },
                     runs: { demandMn: [], readiness: [], spread: [] }
                 });
                 console.log(`[BENCH25_BACKEND][DONE_CAT] categoryId=${cat.id} verdict=MISSING`);
                 continue;
            }

            // Calc Stats
            const getStats = (vals: number[]) => {
                if (vals.length === 0) return { median: 0, drift: 0 };
                const sorted = [...vals].sort((a,b) => a-b);
                const mid = Math.floor(sorted.length/2);
                const median = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid-1] + sorted[mid])/2;
                
                let drift = 0;
                if (median > 0) {
                    const maxDev = Math.max(...vals.map(v => Math.abs(v - median)));
                    drift = (maxDev / median) * 100;
                } else {
                    const hasNonZero = vals.some(v => v !== 0);
                    drift = hasNonZero ? 999 : 0;
                }
                return { median, drift };
            };

            const sD = getStats(runValues.d);
            const sR = getStats(runValues.r);
            const sS = getStats(runValues.s);

            const maxDrift = Math.max(sD.drift, sR.drift, sS.drift);

            let verdict = "FAIL";
            if (maxDrift <= 1.0) verdict = "GO";
            else if (maxDrift <= 5.0) verdict = "WARN";

            console.log(`[BENCH25_BACKEND][DONE_CAT] categoryId=${cat.id} driftMax=${maxDrift.toFixed(3)} verdict=${verdict}`);

            results.push({
                categoryId: cat.id,
                snapshotId,
                lifecycle,
                verdict,
                driftPct: {
                    demand: sD.drift,
                    readiness: sR.drift,
                    spread: sS.drift,
                    max: maxDrift
                },
                median: {
                    demandMn: sD.median,
                    readiness: sR.median,
                    spread: sS.median
                },
                runs: {
                    demandMn: runValues.d,
                    readiness: runValues.r,
                    spread: runValues.s
                }
            });
        }

        const validRes = results.filter(r => r.verdict !== 'MISSING');
        const maxDriftOverallPct = validRes.length > 0 ? Math.max(...validRes.map(r => r.driftPct.max)) : 0;

        const counts = { GO: 0, WARN: 0, FAIL: 0, MISSING: 0 };
        results.forEach(r => counts[r.verdict as keyof typeof counts]++);

        const finalReport = {
            kind: "bench25_audit_backend_only",
            auditId,
            ts: new Date().toISOString(),
            month,
            runsPerCat: 25,
            categoriesTotal: 16,
            maxDriftOverallPct,
            verdictCounts: counts,
            results
        };

        console.log(`[BENCH25_BACKEND][DONE] maxDriftOverall=${maxDriftOverallPct.toFixed(4)}`);
        console.log(JSON.stringify(finalReport, null, 2));
    },

    // 25x Benchmark for Baseline Stability (P0) - Legacy/Backwards Compat for 25x button if referenced
    async run25xBenchmark(
        mode: 'AUDIT_ONLY' | 'PUBLISH_BASELINE', 
        onProgress?: (msg: string, pct: number) => void
    ): Promise<{ ok: boolean; report?: BacktestReport; error?: string }> {
        // Redirect to new robust runner if just auditing
        if (mode === 'AUDIT_ONLY') {
             const bench25 = await this.runBench25({
                 month: DateUtils.getCurrentMonthKey(),
                 categoryIds: CORE_CATEGORIES.map(c => c.id),
                 runsPerCat: 25,
                 onProgress
             });
             // Map back to BacktestReport shape for legacy compatibility
             return {
                 ok: true,
                 report: {
                     auditId: bench25.auditId,
                     ts: bench25.ts,
                     runs: 25,
                     target: { projectId: 'local', databaseId: 'memory' },
                     results: bench25.results.map(r => ({
                         categoryId: r.categoryId,
                         snapshotId: r.snapshotId,
                         lifecycle: r.lifecycle,
                         metrics: {
                             demand_index_mn: { median: r.demandMn || 0, min: 0, max: 0, deviationPct: r.drift || 0 },
                             readinessScore: { median: r.readiness || 0, min: 0, max: 0, deviationPct: 0 },
                             spreadScore: { median: r.spread || 0, min: 0, max: 0, deviationPct: 0 },
                             fiveYearTrend: { median: 0, min: 0, max: 0, deviationPct: 0 }
                         },
                         maxDeviationPct: r.drift || 0,
                         verdict: r.verdict as any
                     })),
                     summary: {
                         maxDeviationPctOverall: bench25.maxDriftOverallPct || 0,
                         medianDeviationPctOverall: 0,
                         goCount: bench25.verdictCounts.GO,
                         warnCount: bench25.verdictCounts.WARN,
                         missingCount: bench25.verdictCounts.MISSING,
                         perMetricMedianDeviationPctAcrossCategories: { demand_index_mn: 0, readinessScore: 0, spreadScore: 0, fiveYearTrend: 0 }
                     },
                     kind: 'bench25_audit'
                 }
             };
        }

        return { ok: false, error: "Legacy PUBLISH_BASELINE not supported in this fix" };
    },

    // Legacy method stub
    async runAndPublish10x(opts: { dryRun?: boolean } = {}): Promise<any> {
        return this.run25xBenchmark('AUDIT_ONLY');
    },
    
    async getLatestBacktestReport(): Promise<BacktestReport | null> {
         const db = FirestoreClient.getDbSafe();
         if (!db) return null;
         try {
             const indexSnap = await getDoc(doc(db, 'mci_audits_backtests_index', 'latest'));
             if (!indexSnap.exists()) return null;
             const auditId = indexSnap.data().auditId;
             return this.getBacktestReport(auditId);
         } catch(e) { return null; }
    },
    
    async getBacktestReport(auditId: string): Promise<BacktestReport | null> {
         const db = FirestoreClient.getDbSafe();
         if (!db) return null;
         const snap = await getDoc(doc(db, 'demand_benchmarks', auditId));
         if (snap.exists()) return snap.data() as BacktestReport;
         // Fallback legacy
         const legacy = await getDoc(doc(db, 'mci_audits_backtests', auditId));
         if (legacy.exists()) return legacy.data() as BacktestReport;
         return null;
    },

    async publishExternalReport(reportData: BacktestReport): Promise<{ ok: boolean; auditId: string; error?: string }> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return { ok: false, auditId: '', error: 'DB_INIT_FAIL' };
        
        try {
            if (!reportData.auditId || !reportData.results) throw new Error("Invalid Report Format");

            const auditId = reportData.auditId;
            const now = new Date().toISOString();

            await setDoc(doc(db, 'demand_benchmarks', auditId), {
                ...reportData,
                uploadedAt: now,
                source: 'MANUAL_UPLOAD'
            });

            await setDoc(doc(db, 'mci_audits_backtests_index', 'latest'), {
                auditId,
                updatedAt: now,
                source: 'MANUAL_UPLOAD'
            });

            console.log(`[BENCH_JSON][UPLOAD_WRITE_OK] auditId=${auditId}`);
            return { ok: true, auditId };
        } catch (e: any) {
            console.error('[BENCH_JSON][UPLOAD_WRITE_FAIL]', e);
            return { ok: false, auditId: '', error: e.message };
        }
    }
};
