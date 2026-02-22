
import { CORE_CATEGORIES } from '../constants';
import { SnapshotResolver } from './snapshotResolver';
import { CategorySnapshotStore } from './categorySnapshotStore';
import { MetricsCalculatorV3 } from './metricsCalculatorV3';

export const Bench25BackendRunner = {
    async runBench25BackendAudit() {
        const ts = new Date().toISOString();
        const auditId = `bench25_${Date.now()}`;
        console.log(`[BENCH25_BACKEND] Starting 25x Audit at ${ts}`);

        const results = [];
        let missingCount = 0;
        let goCount = 0;
        let warnCount = 0;
        let failCount = 0;

        // Deterministic Sort of Categories
        const sortedCats = [...CORE_CATEGORIES].sort((a, b) => a.id.localeCompare(b.id));

        for (const cat of sortedCats) {
            console.log(`[BENCH25_BACKEND][CAT] categoryId=${cat.id}`);
            
            // 1. Resolve Snapshot (Certified Preferred, Read Only)
            let snapshotId: string | null = null;
            let lifecycle = 'UNKNOWN';

            try {
                const res = await SnapshotResolver.resolveActiveSnapshot(cat.id, 'IN', 'en');
                if (res.ok && res.snapshot) {
                    snapshotId = res.snapshot.snapshot_id;
                    lifecycle = res.snapshot.lifecycle;
                }
            } catch (e) {
                console.warn(`[BENCH25_BACKEND] Snapshot resolve error for ${cat.id}`);
            }
            
            if (!snapshotId) {
                results.push({
                    categoryId: cat.id,
                    snapshotId: null,
                    lifecycle: 'MISSING',
                    verdict: 'MISSING',
                    driftPct: { demand: 0, readiness: 0, spread: 0, max: 0 },
                    median: { demandMn: 0, readiness: 0, spread: 0 },
                    runs: { demandMn: [], readiness: [], spread: [] }
                });
                missingCount++;
                console.log(`[BENCH25_BACKEND][DONE_CAT] categoryId=${cat.id} verdict=MISSING`);
                continue;
            }

            // 2. Load Rows (Read Only)
            let rows: any[] = [];
            try {
                const rowsRes = await CategorySnapshotStore.readAllKeywordRows(
                    { categoryId: cat.id, countryCode: 'IN', languageCode: 'en' }, 
                    snapshotId
                );
                if (rowsRes.ok && rowsRes.data) {
                    rows = rowsRes.data;
                }
            } catch (e) {
                console.warn(`[BENCH25_BACKEND] Row read error for ${cat.id}`);
            }

            if (rows.length === 0) {
                results.push({
                    categoryId: cat.id,
                    snapshotId,
                    lifecycle,
                    verdict: 'MISSING',
                    driftPct: { demand: 0, readiness: 0, spread: 0, max: 0 },
                    median: { demandMn: 0, readiness: 0, spread: 0 },
                    runs: { demandMn: [], readiness: [], spread: [] }
                });
                missingCount++;
                console.log(`[BENCH25_BACKEND][DONE_CAT] categoryId=${cat.id} verdict=MISSING (0 rows)`);
                continue;
            }

            // 3. Mock Trend (Prevent Write Side-Effects)
            // We use a fixed trend to ensure the audit tests purely the demand calculator stability
            const trendInput = {
                fiveYearTrendPct: 5.5,
                trendStatus: 'Growing' as const,
                trendError: undefined
            };

            // 4. Run 25x
            const demandRuns: number[] = [];
            const readinessRuns: number[] = [];
            const spreadRuns: number[] = [];

            for (let i = 0; i < 25; i++) {
                try {
                    // MetricsCalculatorV3.calculate is pure given the inputs
                    const metrics = MetricsCalculatorV3.calculate(cat.id, snapshotId, rows, trendInput);
                    demandRuns.push(metrics.demand_index_mn || 0);
                    readinessRuns.push(metrics.metric_scores?.readiness || 0);
                    spreadRuns.push(metrics.metric_scores?.spread || 0);
                } catch (e) {
                    // Swallow individual calculation errors, fill with 0 to show failure in stats
                    demandRuns.push(0);
                    readinessRuns.push(0);
                    spreadRuns.push(0);
                }
            }

            // 5. Compute Stats
            const computeStats = (arr: number[]) => {
                const sorted = [...arr].sort((a,b) => a-b);
                const min = sorted[0];
                const max = sorted[sorted.length-1];
                const mid = Math.floor(sorted.length/2);
                const median = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid-1] + sorted[mid])/2;
                const drift = median > 0 ? ((max - min) / median) * 100 : (max > 0 ? 999 : 0);
                return { median, drift };
            };

            const dStats = computeStats(demandRuns);
            const rStats = computeStats(readinessRuns);
            const sStats = computeStats(spreadRuns);
            
            const maxDriftOverall = Math.max(dStats.drift, rStats.drift, sStats.drift);

            // Verdict
            let verdict = 'FAIL';
            if (maxDriftOverall <= 1.0) verdict = 'GO';
            else if (maxDriftOverall <= 5.0) verdict = 'WARN';
            
            // Special Case: If demand is 0, it's MISSING data, not just fail
            if (dStats.median === 0) {
                verdict = 'MISSING';
                missingCount++;
            } else {
                if (verdict === 'GO') goCount++;
                else if (verdict === 'WARN') warnCount++;
                else failCount++;
            }

            console.log(`[BENCH25_BACKEND][DONE_CAT] categoryId=${cat.id} driftMax=${maxDriftOverall.toFixed(3)} verdict=${verdict}`);

            results.push({
                categoryId: cat.id,
                snapshotId,
                lifecycle,
                verdict,
                driftPct: {
                    demand: dStats.drift,
                    readiness: rStats.drift,
                    spread: sStats.drift,
                    max: maxDriftOverall
                },
                median: {
                    demandMn: dStats.median,
                    readiness: rStats.median,
                    spread: sStats.median
                },
                runs: {
                    demandMn: demandRuns,
                    readiness: readinessRuns,
                    spread: spreadRuns
                }
            });
        }

        const validDrifts = results.filter(r => r.verdict !== 'MISSING').map(r => r.driftPct.max);
        const maxDriftOverallPct = validDrifts.length > 0 ? Math.max(...validDrifts) : 0;

        const report = {
            kind: "bench25_audit_backend_only",
            auditId,
            ts,
            month: "2026-02",
            runsPerCat: 25,
            categoriesTotal: 16,
            maxDriftOverallPct,
            verdictCounts: {
                GO: goCount,
                WARN: warnCount,
                FAIL: failCount,
                MISSING: missingCount
            },
            results
        };

        console.log(`[BENCH25_BACKEND][DONE] maxDriftOverall=${maxDriftOverallPct.toFixed(4)}`);
        // Note: The caller is expected to use the returned object, we also log it for debugging
        return report;
    }
};
