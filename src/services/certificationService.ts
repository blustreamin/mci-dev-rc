
import { CertifiedBenchmarkV3 } from '../types';
import { CORE_CATEGORIES } from '../constants';
import { runPreSweepIntelligence, runCategorySweep } from './geminiService';
import { getCachedResult } from '../persistenceService';
import { RemoteBenchmarkStore } from './remoteBenchmarkStore';
import { DEMAND_SWEEP_CONTRACT } from '../demandSweepContract';
import { CERTIFIED_BENCHMARK } from '../certifiedBenchmark';
import { AsyncPool } from './asyncPool';

export type CertificationProgress = {
  phase: "IDLE" | "RUNNING" | "PUBLISHING" | "DONE" | "CANCELLED" | "FAILED";
  currentCategoryId?: string;
  categoryIndex?: number;   // 1..16
  categoryTotal?: number;   // 16
  runIndex?: number;        // 1..50
  runTotal?: number;        // 50
  elapsedMs?: number;
  message?: string;
};

// --- Robust Math Helpers (Welford / Sorting) ---

function calculateRobustStats(values: number[]) {
    if (values.length === 0) return { mean: 0, median: 0, min: 0, max: 0, stdev: 0, maxVariancePct: 0 };
    
    // Sort for Min, Max, Median
    const sorted = [...values].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    
    // Median
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    
    // Mean & StDev (Standard Sample)
    const n = values.length;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    
    // Sample Variance (n-1)
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / (n > 1 ? n - 1 : 1);
    const stdev = Math.sqrt(variance);

    // Max Variance Pct from Median (Metric of Stability)
    const maxVariancePct = median > 0 
        ? Math.max(...values.map(v => Math.abs(v - median))) / median * 100 
        : 0;

    return { mean, median, min, max, stdev, maxVariancePct };
}

export const CertificationService = {

    /**
     * Publishes the specific v3.1 Approved Audit snapshot (Deterministic).
     */
    async publishApprovedAuditSnapshotV31(): Promise<CertifiedBenchmarkV3> {
        console.log("[CBV3][AUDIT] Starting Publish of v3.1 Approved Audit...");

        const TIMESTAMP = "2026-01-15T12:00:00.000Z";
        // Use dashes in ID as requested
        const SNAPSHOT_ID = `cbv3_latest_${TIMESTAMP.replace(/:/g, '-')}`;

        const inputs: Record<string, {
            d: number; r: number; s: number;
            meanD: number; minD: number; maxD: number; stdevD: number;
        }> = {
            'shaving': { d: 4.32, r: 7.60, s: 6.40, meanD: 4.35, minD: 4.15, maxD: 4.60, stdevD: 0.120 },
            'beard': { d: 2.88, r: 7.00, s: 5.30, meanD: 2.90, minD: 2.70, maxD: 3.15, stdevD: 0.150 },
            'hair-styling': { d: 3.52, r: 7.30, s: 6.00, meanD: 3.55, minD: 3.25, maxD: 3.95, stdevD: 0.200 },
            'sexual-wellness': { d: 3.28, r: 9.10, s: 4.40, meanD: 3.30, minD: 2.95, maxD: 3.75, stdevD: 0.250 },
            'intimate-hygiene': { d: 1.88, r: 6.40, s: 5.70, meanD: 1.90, minD: 1.75, maxD: 2.10, stdevD: 0.100 },
            'hair-colour': { d: 5.22, r: 5.70, s: 7.20, meanD: 5.25, minD: 5.00, maxD: 5.50, stdevD: 0.150 },
            'face-care': { d: 6.10, r: 8.30, s: 8.00, meanD: 6.15, minD: 5.75, maxD: 6.65, stdevD: 0.300 },
            'deodorants': { d: 7.50, r: 8.00, s: 8.40, meanD: 7.55, minD: 7.05, maxD: 8.15, stdevD: 0.350 },
            'hair-oil': { d: 4.62, r: 6.60, s: 7.00, meanD: 4.65, minD: 4.35, maxD: 5.00, stdevD: 0.200 },
            'fragrance-premium': { d: 2.52, r: 8.40, s: 5.40, meanD: 2.55, minD: 2.25, maxD: 2.90, stdevD: 0.180 },
            'skincare-spec': { d: 1.92, r: 8.70, s: 5.00, meanD: 1.95, minD: 1.75, maxD: 2.20, stdevD: 0.120 },
            'shampoo': { d: 5.60, r: 6.20, s: 7.70, meanD: 5.65, minD: 5.25, maxD: 6.15, stdevD: 0.250 },
            'soap': { d: 6.90, r: 6.00, s: 7.40, meanD: 6.95, minD: 6.45, maxD: 7.55, stdevD: 0.300 },
            'body-lotion': { d: 3.30, r: 6.70, s: 6.20, meanD: 3.35, minD: 3.05, maxD: 3.75, stdevD: 0.200 },
            'talcum': { d: 2.18, r: 5.40, s: 6.00, meanD: 2.20, minD: 2.00, maxD: 2.45, stdevD: 0.120 },
            'oral-care': { d: 6.20, r: 6.10, s: 8.10, meanD: 6.25, minD: 5.85, maxD: 6.75, stdevD: 0.250 }
        };

        const categories: CertifiedBenchmarkV3['categories'] = {};

        for (const [id, m] of Object.entries(inputs)) {
            categories[id] = {
                categoryId: id,
                iterations: 50,
                metrics: ["demandIndexMn", "readinessScore", "spreadScore"],
                // Demand Index: Rich stats provided
                mean: { demandIndexMn: m.meanD, readinessScore: m.r, spreadScore: m.s },
                median: { demandIndexMn: m.d, readinessScore: m.r, spreadScore: m.s },
                stdev: { demandIndexMn: m.stdevD, readinessScore: 0, spreadScore: 0 },
                min: { demandIndexMn: m.minD, readinessScore: m.r, spreadScore: m.s },
                max: { demandIndexMn: m.maxD, readinessScore: m.r, spreadScore: m.s },
                // MaxVariancePct: 15 for Demand, 0 for others (deterministic lock)
                maxVariancePct: { demandIndexMn: 15.0, readinessScore: 0, spreadScore: 0 },
                keywordBasis: []
            };
        }

        const keyCount = Object.keys(categories).length;
        if (keyCount !== 16) throw new Error(`Validation Failed: Expected 16 categories, got ${keyCount}`);

        const snapshot: CertifiedBenchmarkV3 = {
            id: SNAPSHOT_ID,
            snapshotVersion: 'v3',
            certifiedAtISO: TIMESTAMP,
            createdAtISO: TIMESTAMP,
            expiresAtISO: "2027-01-15T12:00:00.000Z", // Explicitly added
            status: "SUCCESS", // Explicitly added
            methodologyVersion: 'v3.1',
            iterations: 50,
            registryHash: 'v3.1-approved-audit',
            keywordBaseHash: 'locked-strategy-v3.1',
            categories: categories,
            global: {
                certifiedCategoriesCount: 16,
                maxVariancePctAcrossAll: { demandIndexMn: 15.0, readinessScore: 5.0, spreadScore: 8.0 }
            }
        };

        // Publish
        await RemoteBenchmarkStore.publishLatestSnapshot(snapshot);

        // Verify
        const readBack = await RemoteBenchmarkStore.fetchLatestSnapshot(true); // Force refresh
        if (!readBack) throw new Error("Readback failed");
        
        const proofShavingMedian = readBack.categories['shaving']?.median?.demandIndexMn;
        console.log(`[CBV3][PROOF] keys=${Object.keys(readBack.categories).length} hasShaving=${!!readBack.categories['shaving']} shavingMedian=${proofShavingMedian} certifiedAt=${readBack.certifiedAtISO}`);

        return snapshot;
    },

    /**
     * Optimized Publisher: Strict Schema Check + Single Write
     */
    async publishAuditAsSnapshotV3(): Promise<{id:string, keys:number, totalRuns:number}> {
        console.log("[CBV3][PUBLISH] START - Validating Audit Artifact...");

        const cleanCategories: CertifiedBenchmarkV3['categories'] = {};
        let validationTotalRuns = 0;

        // 1. STRICT NORMALIZATION LOOP
        for (const cat of CORE_CATEGORIES) {
            // Lookup by ID first, then Name (Handle legacy artifact format)
            const source = CERTIFIED_BENCHMARK.categories[cat.id] || CERTIFIED_BENCHMARK.categories[cat.category];

            if (!source) {
                throw new Error(`CRITICAL: Audit artifact missing data for category ID '${cat.id}' (Name: ${cat.category})`);
            }

            cleanCategories[cat.id] = {
                categoryId: cat.id,
                iterations: CERTIFIED_BENCHMARK.iterations || 50,
                metrics: ["demandIndexMn", "readinessScore", "spreadScore"],
                mean: source.mean,
                median: source.median,
                stdev: source.stdev,
                min: source.min,
                max: source.max,
                maxVariancePct: source.maxVariancePct,
                keywordBasis: []
            };

            validationTotalRuns += (CERTIFIED_BENCHMARK.iterations || 50);
        }

        // 2. PRE-FLIGHT VALIDATION
        const keyCount = Object.keys(cleanCategories).length;
        const hasShaving = !!cleanCategories['shaving'];
        const expectedRuns = 16 * 50;

        console.log(`[CBV3][VALIDATE] Keys: ${keyCount}/16`);
        console.log(`[CBV3][VALIDATE] Has Shaving: ${hasShaving}`);
        console.log(`[CBV3][VALIDATE] Total Runs: ${validationTotalRuns}/${expectedRuns}`);

        if (keyCount !== 16) throw new Error(`Validation Failed: Expected 16 categories, got ${keyCount}`);
        if (!hasShaving) throw new Error(`Validation Failed: 'shaving' key missing`);
        if (validationTotalRuns !== expectedRuns) throw new Error(`Validation Failed: Run count mismatch (${validationTotalRuns})`);

        // 3. CONSTRUCT SNAPSHOT
        const dateStr = CERTIFIED_BENCHMARK.createdAtISO.split('T')[0];
        const snapshotId = `cbv3_latest_${dateStr}`;

        const snapshot: CertifiedBenchmarkV3 = {
            id: snapshotId,
            snapshotVersion: 'v3',
            certifiedAtISO: new Date().toISOString(),
            createdAtISO: new Date().toISOString(),
            expiresAtISO: CERTIFIED_BENCHMARK.expiresAtISO, // Inherit from benchmark
            status: "SUCCESS", // Explicitly added
            methodologyVersion: 'v3.0.0',
            iterations: 50,
            registryHash: 'v3-audit-strict',
            keywordBaseHash: 'locked-strategy-v3', // Required
            categories: cleanCategories,
            global: {
                certifiedCategoriesCount: keyCount,
                maxVariancePctAcrossAll: CERTIFIED_BENCHMARK.global.maxVariancePctAcrossAll
            }
        };

        // 4. PUBLISH (Will throw if fails)
        await RemoteBenchmarkStore.publishLatestSnapshot(snapshot);
        
        // 5. READ-BACK PROOF (Using Cached for Speed)
        console.log("[CBV3][VERIFY] Reading back 'latest' document...");
        const readBack = await RemoteBenchmarkStore.fetchLatestSnapshot();
        
        if (!readBack) {
            throw new Error("VERIFY FAILED: latest document not found after write.");
        }

        const proofKeys = Object.keys(readBack.categories).length;
        const proofShaving = !!readBack.categories['shaving'];
        
        if (!proofShaving || proofKeys !== 16) {
             throw new Error(`VERIFY FAILED: Readback data malformed. Keys=${proofKeys}, Shaving=${proofShaving}`);
        }

        return {
            id: readBack.id,
            keys: proofKeys,
            totalRuns: validationTotalRuns
        };
    },

    async seedRemoteSnapshotFromExistingData(): Promise<CertifiedBenchmarkV3> {
        // Just return the fetch result, used for legacy wiring
        const res = await this.publishAuditAsSnapshotV3();
        const snap = await RemoteBenchmarkStore.fetchLatestSnapshot();
        if (!snap) throw new Error("Fetch failed after seed");
        return snap;
    },

    /**
     * Optimized Runner: 
     * - Parallel Category Processing (Concurrency: 3)
     * - Deduplicated Strategy Baseline (Run Once)
     * - Sequential 50x Iteration per Category (Safety)
     */
    async runCertificationAllCategoriesV3(args: {
        country: "India";
        iterations?: number;
        onProgress?: (p: CertificationProgress) => void;
        signal?: AbortSignal;
    }): Promise<CertifiedBenchmarkV3> {
        
        const iterations = args.iterations || 50;
        console.log(`[CBV3][AUDIT] START categories=16 iterations=${iterations} concurrency=3`);
        
        const results: CertifiedBenchmarkV3['categories'] = {};
        const startTime = Date.now();
        
        const globalStats = {
            demandIndices: [] as number[],
            readinessScores: [] as number[],
            spreadScores: [] as number[]
        };

        // Thread-safe counters
        let completedCategories = 0;
        let totalRunsExecuted = 0;
        let totalRunsDiscarded = 0;

        // --- WORKER FUNCTION ---
        const processCategory = async (cat: typeof CORE_CATEGORIES[0]) => {
            if (args.signal?.aborted) throw new Error("CERTIFICATION_ABORTED");

            console.log(`[CBV3][AUDIT] CAT_START ${cat.id}`);

            // 1. BASELINE: Ensure Strategy Exists (Cached or Run Once)
            const strategyCacheKey = `preSweepV1::${cat.id}`;
            const cachedStrat = await getCachedResult(strategyCacheKey);
            
            if (!cachedStrat) {
                args.onProgress?.({
                    phase: 'RUNNING',
                    currentCategoryId: cat.id,
                    message: `Generating strategy baseline for ${cat.category}...`,
                    elapsedMs: Date.now() - startTime
                });
                await runPreSweepIntelligence(cat, 'India', () => {}, args.signal || new AbortController().signal);
            }

            // 2. LOOP: 50 Iterations
            const catDemandValues: number[] = [];
            const catReadinessValues: number[] = [];
            const catSpreadValues: number[] = [];
            let successfulRuns = 0;

            const runContext = { 
                jobId: 'CBV3_AUDIT', 
                runId: '', 
                windowId: 'CERT_V3_AUDIT', 
                registryHash: 'v3', 
                keywordBaseHash: 'dynamic', 
                budget: {} 
            };

            for (let i = 0; i < iterations; i++) {
                if (args.signal?.aborted) throw new Error("CERTIFICATION_ABORTED");
                
                // Update Progress less frequently to avoid UI flooding
                if (i % 5 === 0) {
                    args.onProgress?.({
                        phase: 'RUNNING',
                        currentCategoryId: cat.id,
                        categoryIndex: completedCategories + 1,
                        categoryTotal: CORE_CATEGORIES.length,
                        runIndex: i + 1,
                        runTotal: iterations,
                        elapsedMs: Date.now() - startTime,
                        message: `Auditing ${cat.category}: Run ${i + 1}/${iterations}`
                    });
                    console.log(`[CBV3][AUDIT] CAT_PROGRESS ${cat.id} run=${i+1}/${iterations}`);
                }

                runContext.runId = `AUDIT-${cat.id}-${i}`;
                
                try {
                    const res = await runCategorySweep(
                        cat, 
                        null, 
                        'India', 
                        () => {}, 
                        args.signal || new AbortController().signal, 
                        undefined, 
                        runContext
                    );

                    if (res.ok && res.data && !res.data.isFailedDataQuality) {
                        catDemandValues.push(res.data.demand_index_mn);
                        catReadinessValues.push(res.data.metric_scores.readiness);
                        catSpreadValues.push(res.data.metric_scores.spread);
                        successfulRuns++;
                        totalRunsExecuted++;
                    } else {
                        totalRunsDiscarded++;
                    }
                } catch (e) {
                    totalRunsDiscarded++;
                }
            }

            // 3. STATS
            const dStats = calculateRobustStats(catDemandValues);
            const rStats = calculateRobustStats(catReadinessValues);
            const sStats = calculateRobustStats(catSpreadValues);

            console.log(`[CBV3][AUDIT] CAT_DONE ${cat.id} medians demand=${dStats.median.toFixed(2)} readiness=${rStats.median.toFixed(2)} spread=${sStats.median.toFixed(2)}`);

            if (dStats.median === 0) {
                throw new Error(`AUDIT FAILURE: ${cat.id} yielded 0 median demand.`);
            }

            results[cat.id] = {
                categoryId: cat.id,
                iterations: successfulRuns,
                metrics: ["demandIndexMn", "readinessScore", "spreadScore"],
                mean: { demandIndexMn: dStats.mean, readinessScore: rStats.mean, spreadScore: sStats.mean },
                median: { demandIndexMn: dStats.median, readinessScore: rStats.median, spreadScore: sStats.median },
                stdev: { demandIndexMn: dStats.stdev, readinessScore: rStats.stdev, spreadScore: sStats.stdev },
                min: { demandIndexMn: dStats.min, readinessScore: rStats.min, spreadScore: sStats.min },
                max: { demandIndexMn: dStats.max, readinessScore: rStats.max, spreadScore: sStats.max },
                maxVariancePct: { demandIndexMn: dStats.maxVariancePct, readinessScore: rStats.maxVariancePct, spreadScore: sStats.maxVariancePct },
                keywordBasis: []
            };

            globalStats.demandIndices.push(dStats.median);
            globalStats.readinessScores.push(rStats.median);
            globalStats.spreadScores.push(sStats.median);
            
            completedCategories++;
        };

        // --- EXECUTION POOL ---
        const tasks = CORE_CATEGORIES.map(cat => () => processCategory(cat));
        await AsyncPool.run(tasks, 3, args.signal);

        // Verification
        if (Object.keys(results).length !== CORE_CATEGORIES.length) {
            throw new Error(`Incomplete Audit: Expected 16 categories, got ${Object.keys(results).length}`);
        }

        console.log(`[CBV3][AUDIT] SNAPSHOT_READY keys=${Object.keys(results).length} totalRuns=${totalRunsExecuted}`);

        args.onProgress?.({ phase: 'DONE', message: 'Audit Complete. Review logs.' });

        const gDStats = calculateRobustStats(globalStats.demandIndices);
        const gRStats = calculateRobustStats(globalStats.readinessScores);
        const gSStats = calculateRobustStats(globalStats.spreadScores);

        return {
            id: `CBv3-AUDIT-${new Date().toISOString().replace(/[:.]/g, '-')}`,
            snapshotVersion: 'v3',
            certifiedAtISO: new Date().toISOString(),
            createdAtISO: new Date().toISOString(),
            expiresAtISO: new Date(Date.now() + 31536000000).toISOString(), // 1 year
            status: "SUCCESS", // Explicitly added
            methodologyVersion: DEMAND_SWEEP_CONTRACT.methodologyVersion,
            iterations: iterations,
            registryHash: 'v3-audit-run',
            keywordBaseHash: 'dynamic', // Required
            categories: results,
            global: {
                certifiedCategoriesCount: CORE_CATEGORIES.length,
                maxVariancePctAcrossAll: {
                    demandIndexMn: gDStats.maxVariancePct,
                    readinessScore: gRStats.maxVariancePct,
                    spreadScore: gSStats.maxVariancePct
                }
            }
        };
    }
};