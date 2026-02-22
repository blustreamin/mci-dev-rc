
// Fixed: src/services/backtestService.ts should import from ../../types (root) not ../types
import { DemandArtifact, SweepResult } from '../../types';
import { StorageAdapter } from './storageAdapter';
import { runCategorySweep } from './geminiService';
import { CORE_CATEGORIES } from '../constants';
import { MetricsCalculator } from './metricsCalculator';

// Local interface definition to avoid conflict with new BacktestReport in types.ts
interface LegacyBacktestReport {
    id: string;
    categoryId: string;
    windowId: string;
    runDate: string;
    iterations: number;
    status: string;
    baseline: { demandIndex: number; readiness: number; spread: number };
    variances: {
        demandIndexMaxDiffPct: number;
        readinessMaxDiff: number;
        spreadMaxDiff: number;
    };
    runs: number;
    results: any[];
}

export const BacktestService = {
    
    async runBacktest(
        categoryId: string, 
        windowId: string, 
        iterations: number = 10
    ): Promise<LegacyBacktestReport> {
        
        // 1. Fetch Artifact
        const allKeys = await StorageAdapter.getAllKeys(StorageAdapter.STORES.DEMAND_ARTIFACT);
        const artifactKey = allKeys.find(k => k.startsWith(`${categoryId}-${windowId}`));
        if (!artifactKey) throw new Error("No DemandArtifact found for backtest.");
        
        // 2. Run Loop
        const runResults = [];
        const cat = CORE_CATEGORIES.find(c => c.id === categoryId)!;
        
        for (let i = 0; i < iterations; i++) {
            const res = await runCategorySweep(
                cat, 
                undefined, 
                'India', 
                () => {}, 
                new AbortController().signal, 
                undefined, 
                { jobId: 'BACKTEST', runId: `BT-${i}`, windowId, registryHash: '', keywordBaseHash: '', budget: {} as any }
            );
            
            if (res.ok && res.data) {
                // Ensure metrics are consistent (using the same calculation)
                // runCategorySweep already computes them via MetricsCalculator, so we just read them.
                runResults.push({
                    iter: i + 1,
                    demandIndex: res.data.demand_index_mn,
                    readiness: res.data.metric_scores.readiness,
                    spread: res.data.metric_scores.spread
                });
            }
        }

        // 3. Stats
        const base = runResults[0];
        const variances = runResults.map(r => ({
            d: Math.abs(r.demandIndex - base.demandIndex) / (base.demandIndex || 1), // Avoid div by 0
            r: Math.abs(r.readiness - base.readiness),
            s: Math.abs(r.spread - base.spread)
        }));
        
        const maxVarD = Math.max(...variances.map(v => v.d));
        const status = maxVarD < 0.00001 ? 'PASS' : 'FAIL'; // Strict float equality practically

        const report: LegacyBacktestReport = {
            id: `BT-${Date.now()}`,
            categoryId,
            windowId,
            runDate: new Date().toISOString(),
            iterations,
            status,
            baseline: { demandIndex: base.demandIndex, readiness: base.readiness, spread: base.spread },
            variances: {
                demandIndexMaxDiffPct: maxVarD * 100,
                readinessMaxDiff: Math.max(...variances.map(v => v.r)),
                spreadMaxDiff: Math.max(...variances.map(v => v.s))
            },
            runs: iterations,
            results: runResults
        };

        await StorageAdapter.set(report.id, report, StorageAdapter.STORES.BACKTEST);
        return report;
    }
};
