
import { StrategyRunner } from './strategyRunner';
import { runCategorySweep, runSingleDeepDive } from './geminiService';
import { CORE_CATEGORIES } from '../constants';
import { WindowingService } from './windowing';
import { SweepResult, DeepDiveResult, PreSweepData } from '../types';

export interface BacktestAudit {
    categoryId: string;
    timestamp: string;
    strategy: {
        hash: string;
        keywordCount: number;
        anchorCount: number;
        topAnchors: string[];
    };
    demand: {
        runs: number;
        metrics: {
            index: number[];
            readiness: number[];
            spread: number[];
        };
        stats: {
            indexVariance: number;
            resolvedCount: number;
            zeroVolCount: number;
        };
        passed: boolean;
    };
    deepDive: {
        runs: number;
        successCount: number;
        passed: boolean;
    };
    logs: string[];
}

export const FullBacktestService = {
    async runCycle(categoryId: string, onUpdate: (log: string) => void): Promise<BacktestAudit> {
        const logs: string[] = [];
        const log = (msg: string) => {
            const m = `[${new Date().toLocaleTimeString()}] ${msg}`;
            logs.push(m);
            onUpdate(m);
        };

        log(`Starting 10x Backtest for ${categoryId} (Stable V2.5)`);
        
        const cat = CORE_CATEGORIES.find(c => c.id === categoryId);
        if (!cat) throw new Error("Category not found");

        const windowId = WindowingService.getCurrentMonthWindowId();

        // 1. STRATEGY (1x Baseline)
        log(`Phase 1: Generating Strategy Baseline...`);
        let strategyData: PreSweepData;
        try {
            const stratRes = await StrategyRunner.execute(cat, 'India', () => {}, new AbortController().signal);
            strategyData = stratRes; // Assuming execute throws on failure, so this is data
            if (!strategyData.strategyContract) throw new Error("No Contract generated");
            log(`Strategy Generated. Hash: ${strategyData.strategyContract.contract_hash.substring(0,8)}`);
        } catch (e: any) {
            log(`Strategy Failed: ${e.message}`);
            throw e;
        }

        const strategyReport = {
            hash: strategyData.strategyContract.contract_hash,
            keywordCount: strategyData.selected_keywords.length,
            anchorCount: strategyData.intentMap.flatMap(i => i.anchors).length,
            topAnchors: strategyData.intentMap.flatMap(i => i.anchors).slice(0,5).map(a => a.anchor)
        };

        // 2. DEMAND (10x)
        log(`Phase 2: Running 10 Demand Sweeps (Determinism Check)...`);
        const demandResults: SweepResult[] = [];
        
        for (let i = 0; i < 10; i++) {
            try {
                const res = await runCategorySweep(
                    cat, 
                    strategyData.strategyContract, 
                    'India', 
                    () => {}, 
                    new AbortController().signal, 
                    undefined, 
                    { jobId: 'BT', runId: `BT-${i}`, windowId, registryHash: 'v2.5', keywordBaseHash: strategyReport.hash, budget: {} as any }
                );
                
                if (res.ok && res.data) {
                    demandResults.push(res.data);
                    log(`Run ${i+1}: Index=${res.data.demand_index_mn.toFixed(2)}, Res=${res.data.resolvedKeywordCount}`);
                } else {
                    const errorMsg = !res.ok ? (res as any).error : 'Unknown Error';
                    log(`Run ${i+1}: FAILED - ${errorMsg}`);
                }
            } catch (e: any) {
                log(`Run ${i+1}: EXCEPTION - ${e.message}`);
            }
        }

        // 3. DEEP DIVE (10x)
        log(`Phase 3: Running 10 Deep Dives (Output Stability)...`);
        let ddSuccess = 0;
        if (demandResults.length > 0) {
            const baseDemand = demandResults[0];
            for (let i = 0; i < 10; i++) {
                const dd = await runSingleDeepDive(cat.category, `BT-DD-${i}`, baseDemand);
                // V1 Accessor Fix
                if (dd.ok && (dd.data?.synthesis?.primaryTension?.narrative || (dd.data as any)?.executive_summary?.core_truth)) {
                    ddSuccess++;
                } else {
                    log(`Deep Dive ${i+1} Failed/Empty`);
                }
            }
        } else {
            log(`Skipping Deep Dive (No Demand Data)`);
        }

        // Stats
        const indexes = demandResults.map(r => r.demand_index_mn);
        const minI = Math.min(...indexes);
        const maxI = Math.max(...indexes);
        const meanI = indexes.reduce((a,b)=>a+b,0)/indexes.length;
        const variance = meanI > 0 ? ((maxI - minI)/meanI)*100 : 0;

        const demandPassed = demandResults.length === 10 && variance < 0.01 && meanI > 0;
        const ddPassed = ddSuccess >= 9;

        return {
            categoryId,
            timestamp: new Date().toISOString(),
            strategy: strategyReport,
            demand: {
                runs: demandResults.length,
                metrics: {
                    index: indexes,
                    readiness: demandResults.map(r => r.metric_scores.readiness),
                    spread: demandResults.map(r => r.metric_scores.spread)
                },
                stats: {
                    indexVariance: variance,
                    resolvedCount: demandResults[0]?.resolvedKeywordCount || 0,
                    zeroVolCount: demandResults[0]?.demandAudit?.zeroVolumeCount || 0
                },
                passed: demandPassed
            },
            deepDive: {
                runs: 10,
                successCount: ddSuccess,
                passed: ddPassed
            },
            logs
        };
    }
};
