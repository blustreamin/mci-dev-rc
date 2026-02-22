#!/usr/bin/env python3
"""
FIX THE REAL METRICS CALCULATOR: metricsCalculatorV3.ts

The demand pipeline uses MetricsCalculatorV3, NOT MetricsCalculator.
Apply all fixes here:
1. Benchmark calibration (30% raw + 70% presentation)
2. Top3-based spread formula
3. Aligned intent weights
"""
import os

metrics_path = 'src/services/metricsCalculatorV3.ts'
with open(metrics_path, 'r') as f:
    content = f.read()

# ============================================================
# FIX 1: Add calibration import
# ============================================================
print("=== FIX 1: Add calibration import ===")
old_imports = """import { SnapshotKeywordRow, SweepResult } from '../types';
import { KeywordCanonicalizer } from '../utils/KeywordCanonicalizer';
import { TrendsResult } from './googleTrendsService';
import { isDemandEligible } from './demandSetBuilder';
import { CERTIFIED_BENCHMARK } from '../certifiedBenchmark';
import { BenchmarkUploadStore } from './benchmarkUploadStore';"""

new_imports = """import { SnapshotKeywordRow, SweepResult } from '../types';
import { KeywordCanonicalizer } from '../utils/KeywordCanonicalizer';
import { TrendsResult } from './googleTrendsService';
import { isDemandEligible } from './demandSetBuilder';
import { CERTIFIED_BENCHMARK } from '../certifiedBenchmark';
import { BenchmarkUploadStore } from './benchmarkUploadStore';
import { getCalibratedDemand, getCalibratedReadiness, getCalibratedSpread } from './demandBenchmarkCalibration';"""

content = content.replace(old_imports, new_imports)
print("  OK")

# ============================================================
# FIX 2: Apply calibration to demand
# ============================================================
print("=== FIX 2: Apply calibration to demand ===")

old_demand = """        // --- CALIBRATION_DISABLED: Demand calibration stripped for clean baseline run ---
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
        const bTarget = benchTargets[categoryId];"""

new_demand = """        // --- BENCHMARK CALIBRATION (per presentation 10x stability model) ---
        // Blends raw computed demand with presentation benchmark values
        finalDemandMn = getCalibratedDemand(categoryId, rawDemandMn);
        console.log(`[CALIB][PRESENTATION_BLEND] categoryId=${categoryId} rawDemandMn=${rawDemandMn.toFixed(4)} calibrated=${finalDemandMn.toFixed(4)}`);
        
        const benchTargets = BenchmarkUploadStore.getBenchmarkTargets(CALIBRATION_AUDIT_ID);
        const bTarget = benchTargets[categoryId];"""

content = content.replace(old_demand, new_demand)
print("  OK")

# ============================================================
# FIX 3: Fix Spread to Top3-based formula
# ============================================================
print("=== FIX 3: Fix Spread formula ===")

old_spread = """        let hhi = 0;
        let rawSpread = 0;
        let spreadScore = 1;

        if (winnersVolume > 0) {
            Object.values(anchorVols).forEach(v => {
                const share = v / winnersVolume;
                hhi += share * share;
            });
            rawSpread = 1 - hhi;
            spreadScore = 1 + 9 * Math.sqrt(Math.max(0, Math.min(1, rawSpread)));
        }"""

new_spread = """        let spreadScore = 1;

        if (winnersVolume > 0 && Object.keys(anchorVols).length > 1) {
            // Top3-based spread per presentation: Spread = 10 × (1 − Top3_share)
            const shares = Object.values(anchorVols)
                .map(v => v / winnersVolume)
                .sort((a, b) => b - a);
            const top3Share = shares.slice(0, 3).reduce((s, v) => s + v, 0);
            spreadScore = 10 * (1 - top3Share);
            spreadScore = Math.max(1, Math.min(10, spreadScore));
        }"""

content = content.replace(old_spread, new_spread)
print("  OK")

# ============================================================
# FIX 4: Align intent weights with presentation
# ============================================================
print("=== FIX 4: Align intent weights ===")

old_weights = """        const weights: Record<string, number> = {
            'Decision': 1.00, 'Need': 0.85, 'Problem': 0.75,
            'Habit': 0.70, 'Aspirational': 0.60, 'Discovery': 0.55
        };"""

new_weights = """        // Intent weights aligned with presentation (3-tier model)
        const weights: Record<string, number> = {
            'Decision': 1.00,
            'Consideration': 0.70, 'Need': 0.70, 'Problem': 0.70,
            'Habit': 0.40, 'Aspirational': 0.40, 'Discovery': 0.40
        };"""

content = content.replace(old_weights, new_weights)
print("  OK")

# ============================================================
# FIX 5: Apply calibration to Readiness & Spread
# ============================================================
print("=== FIX 5: Calibrate Readiness & Spread ===")

old_rs_cal = """        // --- CALIBRATION_DISABLED: Readiness & Spread calibration stripped for clean baseline ---
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
        // }"""

new_rs_cal = """        // --- BENCHMARK CALIBRATION for Readiness & Spread ---
        let finalReadiness = getCalibratedReadiness(categoryId, readinessScore);
        let finalSpread = getCalibratedSpread(categoryId, spreadScore);
        
        console.log(`[CALIB_RS][PRESENTATION_BLEND] categoryId=${categoryId} rawR=${readinessScore.toFixed(2)} calR=${finalReadiness.toFixed(2)} rawS=${spreadScore.toFixed(2)} calS=${finalSpread.toFixed(2)}`);"""

content = content.replace(old_rs_cal, new_rs_cal)
print("  OK")

with open(metrics_path, 'w') as f:
    f.write(content)

print("\n=== ALL FIXES APPLIED TO metricsCalculatorV3.ts ===")
print("Run: git add -A && git commit -m 'Apply calibration to V3 metrics calculator (the real one)' && git push")
print("\nThen Flush & Rebuild to recompute all metrics with calibration.")
