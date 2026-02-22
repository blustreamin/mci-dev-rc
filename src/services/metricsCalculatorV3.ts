
import { SnapshotKeywordRow, SweepResult } from '../types';
import { KeywordCanonicalizer } from '../utils/KeywordCanonicalizer';
import { TrendsResult } from './googleTrendsService';
import { isDemandEligible } from './demandSetBuilder';
import { CERTIFIED_BENCHMARK } from '../certifiedBenchmark';
import { BenchmarkUploadStore } from './benchmarkUploadStore';

const CALIBRATION_AUDIT_ID = "backtest_upload_1769418899090";

export const MetricsCalculatorV3 = {
    /**
     * Primary entry point for V3 Absolute Metrics.
     * ALIGNED WITH BENCHMARK (Raw Volume / 1M) + CALIBRATION LAYER.
     */
    calculate(
        categoryId: string,
        snapshotId: string,
        rows: SnapshotKeywordRow[],
        trends: TrendsResult
    ): Partial<SweepResult> {
        console.log(`[DEMAND_V3][START] categoryId=${categoryId} snapshotId=${snapshotId}`);

        // 1. DEDUPLICATION (Canonical Identity)
        const groups = new Map<string, SnapshotKeywordRow[]>();
        rows.forEach(r => {
            const key = KeywordCanonicalizer.canonicalKey(r.keyword_text);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(r);
        });

        const winners: SnapshotKeywordRow[] = [];
        groups.forEach((group, key) => {
            // Sort by Volume DESC to pick winner
            const winner = group.sort((a, b) => (b.volume || 0) - (a.volume || 0))[0];
            winners.push(winner);
        });

        // 2. DEMAND INDEX CALCULATION
        // Use ALL eligible rows (not just winners) for Total Demand Volume to match Standard Candle logic
        const rowsForDemand = rows.filter(isDemandEligible);
        const totalValidatedVolume = rowsForDemand.reduce((sum, r) => sum + (r.volume || 0), 0);

        // RAW Demand (Option A Logic)
        const rawDemandMn = totalValidatedVolume / 1_000_000;
        let finalDemandMn = rawDemandMn;

        // --- CALIBRATION_DISABLED: Demand calibration stripped for clean baseline run ---
        // The calibration layer was force-fitting raw demand to uploaded benchmark targets
        // from audit backtest_upload_1769418899090. Those targets were from a non-deterministic
        // run and introduced circular drift. Raw metrics are now used directly.
        // To re-enable: uncomment the block below and update CALIBRATION_AUDIT_ID with a clean baseline.
        console.log(`[CALIB][DISABLED_BY_DESIGN] categoryId=${categoryId} rawDemandMn=${rawDemandMn.toFixed(4)} — using raw value (no calibration)`);
        
        // CALIBRATION_DISABLED: Original calibration block preserved for future re-enablement
        // const benchTargets = BenchmarkUploadStore.getBenchmarkTargets(CALIBRATION_AUDIT_ID);
        // const bTarget = benchTargets[categoryId];
        // if (bTarget && rawDemandMn > 0) {
        //     const globalMult = 1.0; 
        //     const scaled = rawDemandMn * globalMult;
        //     const ratio = bTarget.d / scaled;
        //     const catMult = Math.max(0.25, Math.min(4.0, ratio));
        //     const calibrated = scaled * catMult;
        //     finalDemandMn = calibrated;
        // }
        
        // Keep bTarget reference for Readiness/Spread section below (also disabled)
        const benchTargets = BenchmarkUploadStore.getBenchmarkTargets(CALIBRATION_AUDIT_ID);
        const bTarget = benchTargets[categoryId];
        
        const demandIndexMn = parseFloat(finalDemandMn.toFixed(2));

        // AUDIT LOGS (P0 Requirement)
        console.log(`[DEMAND_ALIGN_AUDIT][BENCH_SRC] file=metricsCalculatorV3.ts fn=calculate demandFormula=calibrated(raw/1M) units=Mn`);
        console.log(`[DEMAND_ALIGN_AUDIT][ROWSET] categoryId=${categoryId} rowsLoaded=${rows.length} active=${rowsForDemand.length} volumeSum=${totalValidatedVolume}`);
        console.log(`[DEMAND_ALIGN_AUDIT][UNIT_CHECK] categoryId=${categoryId} totalValidatedVolume=${totalValidatedVolume} demand_index_mn=${demandIndexMn}`);

        // 3. METRIC SCORES (Readiness & Spread)
        // Use deduplicated winners for quality metrics to avoid skew
        const winnersEligible = winners.filter(isDemandEligible);
        const winnersVolume = winnersEligible.reduce((sum, w) => sum + (w.volume || 0), 0);
        
        // Spread (HHI)
        const anchorVols: Record<string, number> = {};
        winnersEligible.forEach(w => {
            anchorVols[w.anchor_id] = (anchorVols[w.anchor_id] || 0) + w.volume!;
        });

        let hhi = 0;
        let rawSpread = 0;
        let spreadScore = 1;

        if (winnersVolume > 0) {
            Object.values(anchorVols).forEach(v => {
                const share = v / winnersVolume;
                hhi += share * share;
            });
            rawSpread = 1 - hhi;
            spreadScore = 1 + 9 * Math.sqrt(Math.max(0, Math.min(1, rawSpread)));
        }

        // Readiness (Intent Mix)
        const weights: Record<string, number> = {
            'Decision': 1.00, 'Need': 0.85, 'Problem': 0.75,
            'Habit': 0.70, 'Aspirational': 0.60, 'Discovery': 0.55
        };
        let weightedSum = 0;
        winnersEligible.forEach(w => {
            const weight = weights[w.intent_bucket || 'Discovery'] || 0.55;
            weightedSum += (w.volume || 0) * weight;
        });
        
        const avgIntent = winnersVolume === 0 ? 0 : weightedSum / winnersVolume;
        const normReadiness = Math.max(0, Math.min(1, (avgIntent - 0.5) / 0.5));
        const readinessScore = 1 + 9 * Math.sqrt(normReadiness);
        
        // --- CALIBRATION_DISABLED: Readiness & Spread calibration stripped for clean baseline ---
        let finalReadiness = readinessScore;
        let finalSpread = spreadScore;

        console.log(`[CALIB_RS][DISABLED_BY_DESIGN] categoryId=${categoryId} rawReadiness=${readinessScore.toFixed(3)} rawSpread=${spreadScore.toFixed(3)} — using raw values (no calibration)`);

        // CALIBRATION_DISABLED: Original R&S calibration block preserved for future re-enablement
        // if (bTarget) {
        //     if (bTarget.r > 0) {
        //          const rawR = readinessScore;
        //          const ratioR = rawR === 0 ? 1 : bTarget.r / rawR;
        //          const catMultR = Math.max(0.5, Math.min(1.5, ratioR));
        //          let calR = rawR * catMultR;
        //          calR = Math.min(10, Math.max(1, Math.round(calR * 10) / 10));
        //          finalReadiness = calR;
        //     }
        //     if (bTarget.s > 0) {
        //          const rawS = spreadScore;
        //          const ratioS = rawS === 0 ? 1 : bTarget.s / rawS;
        //          const catMultS = Math.max(0.5, Math.min(1.5, ratioS));
        //          let calS = rawS * catMultS;
        //          calS = Math.min(10, Math.max(1, Math.round(calS * 10) / 10));
        //          finalSpread = calS;
        //     }
        // }

        const readinessScoreFinal = finalReadiness;
        const spreadScoreFinal = finalSpread;

        // VERIFICATION LOG (P0 Requirement)
        // NOTE: This compares against the OLD certified benchmark (fabricated data).
        // After running a clean 25x benchmark, update certifiedBenchmark.ts with real values.
        // Until then, these delta logs will show large differences — that is EXPECTED.
        if (CERTIFIED_BENCHMARK && CERTIFIED_BENCHMARK.categories[categoryId]) {
             const bench = CERTIFIED_BENCHMARK.categories[categoryId];
             const bD = bench.median.demandIndexMn;
             const bR = bench.median.readinessScore;
             const bS = bench.median.spreadScore;
             
             // Compare Calibrated Value
             const dDelta = bD > 0 ? (Math.abs(demandIndexMn - bD) / bD) * 100 : 0;
             const rDelta = Math.abs(readinessScoreFinal - bR);
             const sDelta = Math.abs(spreadScoreFinal - bS);
             
             console.log(`[DEMAND_ALIGN_VERIFY] categoryId=${categoryId} computedDemandMn=${demandIndexMn.toFixed(2)} benchDemandMn=${bD.toFixed(2)} deltaPct=${dDelta.toFixed(2)}%`);
             console.log(`[DEMAND_ALIGN_VERIFY] categoryId=${categoryId} computedReadiness=${readinessScoreFinal.toFixed(2)} benchReadiness=${bR.toFixed(2)} delta=${rDelta.toFixed(2)}`);
             console.log(`[DEMAND_ALIGN_VERIFY] categoryId=${categoryId} computedSpread=${spreadScoreFinal.toFixed(2)} benchSpread=${bS.toFixed(2)} delta=${sDelta.toFixed(2)}`);
        }

        return {
            demand_index_mn: demandIndexMn,
            metric_scores: { readiness: readinessScoreFinal, spread: spreadScoreFinal },
            trend_5y: {
                value_percent: trends.fiveYearTrendPct,
                trend_label: trends.trendStatus as any,
                source: "Google Trends Grounding",
                coverage: 1,
                windowId: "now",
                keywordCountTotal: winners.length,
                keywordCountWithTrend: winners.length,
                method: "MODEL_ESTIMATE",
                period: "5y",
                timestamp: new Date().toISOString()
            },
            // Legacy/Output compat fields
            demandIndexAbsolute: totalValidatedVolume,
            demandIndexMn: demandIndexMn,
            readinessScore: readinessScoreFinal,
            spreadScore: spreadScoreFinal,
            fiveYearTrendPct: trends.fiveYearTrendPct,
            trendStatus: trends.trendStatus,
            metricsVersion: "ABS_V3",
            demandAudit: {
                totalKeywordsInput: rows.length,
                resolvedKeywordCount: winners.length,
                zeroVolumeCount: winners.filter(w => (w.volume || 0) === 0).length,
                anchorVolumes: Object.entries(anchorVols).map(([name, vol]) => ({
                    anchorName: name,
                    totalVolume: vol,
                    keywordCount: winners.filter(w => w.anchor_id === name).length,
                    resolvedCount: winnersEligible.filter(w => w.anchor_id === name).length
                })),
                strategyHashUsed: "ABS_V3_DEDUP",
                demandIndexRowsUsed: rowsForDemand.length
            }
        };
    }
};
