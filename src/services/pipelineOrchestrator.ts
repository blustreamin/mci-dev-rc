
import { FirestoreClient } from './firestoreClient';
import { doc, setDoc, updateDoc, collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { SnapshotResolver } from './snapshotResolver';
import { DemandSnapshotResolver, SignalSnapshotResolver } from './deepDiveSnapshotResolvers';
import { runPreSweepIntelligence, runCategorySweep, runSingleDeepDive, runSinglePlaybook } from './geminiService';
import { OutputSnapshotStore } from './outputSnapshotStore';
import { DeepDiveSnapshotStore } from './deepDiveSnapshotStore';
import { CORE_CATEGORIES } from '../constants';
import { safeText } from '../utils/safety';
import { JobControlService } from './jobControlService';
import { DateUtils } from '../utils/dateUtils';
import { CategorySnapshotStore } from './categorySnapshotStore';
import { yieldToUI } from '../utils/yield';

export interface PipelineRunOptions {
    categoryId: string;
    month?: string;
    tier: 'LITE' | 'FULL';
    jobId?: string;
    mode: 'DRY_RUN' | 'FULL_RUN';
}

export interface PipelineResult {
    runId: string;
    categoryId: string;
    month: string;
    verdict: 'GO' | 'WARN' | 'NO_GO';
    artifacts: {
        corpusSnapshotId: string;
        cnaResultId: string;
        demandSnapshotId: string;
        signalSnapshotId: string | null;
        deepDiveResultId: string;
        deepDiveSnapshotId: string;
        playbookId: string;
    };
    warnings: string[];
    blockers: string[];
    timingsMs: Record<string, number>;
}

export const PipelineOrchestrator = {
    
    async runOrderedPipeline(opts: PipelineRunOptions): Promise<PipelineResult> {
        const runId = `PIPE_${opts.categoryId}_${Date.now()}`;
        const month = opts.month || DateUtils.getCurrentMonthKey();
        
        const result: PipelineResult = {
            runId,
            categoryId: opts.categoryId,
            month,
            verdict: 'GO',
            artifacts: {
                corpusSnapshotId: '',
                cnaResultId: '',
                demandSnapshotId: '',
                signalSnapshotId: null,
                deepDiveResultId: '',
                deepDiveSnapshotId: '',
                playbookId: ''
            },
            warnings: [],
            blockers: [],
            timingsMs: {}
        };

        const db = FirestoreClient.getDbSafe();
        if (!db) throw new Error("DB_INIT_FAIL");

        // --- HEARTBEAT & PERSISTENCE HELPERS ---
        const runDocRef = doc(db, 'pipeline_runs', runId);
        let heartbeatInterval: any = null;

        const updateRunDoc = async (stage: string, pct: number, extra: any = {}) => {
            const payload = {
                categoryId: opts.categoryId,
                month,
                mode: opts.mode,
                tier: opts.tier,
                currentStage: stage,
                progress: pct,
                updatedAt: new Date().toISOString(),
                ...extra
            };
            try {
                await setDoc(runDocRef, payload, { merge: true });
                if (opts.jobId) {
                    await JobControlService.updateProgress(opts.jobId, { 
                        message: `Pipeline: ${stage}`, 
                        progress: { processed: pct, total: 100 } 
                    });
                }
            } catch (e) { console.warn("RunDoc update failed", e); }
        };

        const startHeartbeat = () => {
            heartbeatInterval = setInterval(() => updateRunDoc('HEARTBEAT', 0, {}), 3000);
        };
        const stopHeartbeat = () => {
            if (heartbeatInterval) clearInterval(heartbeatInterval);
        };

        const logStage = (stage: string, msg: string) => {
            console.log(`[PIPE][${stage}] ${msg}`);
        };

        const measure = async <T>(stage: string, fn: () => Promise<T>): Promise<T> => {
            await yieldToUI(); // Initial yield for responsiveness
            const start = Date.now();
            logStage(stage, "START");
            await updateRunDoc(stage, 0, { stageStartedAt: new Date().toISOString() });
            
            try {
                const res = await fn();
                const duration = Date.now() - start;
                result.timingsMs[stage] = duration;
                logStage(stage, `DONE (${duration}ms)`);
                await updateRunDoc(stage, 100, { stageCompletedAt: new Date().toISOString() });
                return res;
            } catch (e: any) {
                logStage(stage, `FAIL: ${e.message}`);
                result.blockers.push(`${stage}: ${e.message}`);
                result.verdict = 'NO_GO';
                await updateRunDoc(stage, 0, { error: e.message, status: 'FAILED' });
                throw e; // Controlled re-throw
            }
        };

        // --- PIPELINE EXECUTION ---

        try {
            startHeartbeat();
            await setDoc(runDocRef, { 
                runId, 
                startedAt: new Date().toISOString(), 
                config: opts,
                status: 'RUNNING'
            });

            // S1: Corpus Snapshot Loaded
            let corpusSnap: any = null;
            await measure('S1', async () => {
                const res = await SnapshotResolver.resolveActiveSnapshot(opts.categoryId, 'IN', 'en');
                if (!res.ok || !res.snapshot) throw new Error("No active corpus snapshot found");
                corpusSnap = res.snapshot;
                result.artifacts.corpusSnapshotId = corpusSnap.snapshot_id;
                logStage('S1', `corpusSnapshotLoaded snapshotId=${corpusSnap.snapshot_id} rows=${corpusSnap.stats.keywords_total}`);
            });

            // S2: CNA Calls Snapshot
            // Gate check
            await measure('S2', async () => {
                if (!corpusSnap) throw new Error("S1 Failed");
                // Verify we can read rows
                const rowsCheck = await CategorySnapshotStore.readAllKeywordRows({ categoryId: opts.categoryId, countryCode: 'IN', languageCode: 'en' }, corpusSnap.snapshot_id);
                if (!rowsCheck.ok) throw new Error("S1 Rows Unreadable");
                
                logStage('S2', `cnaInputBound snapshotId=${corpusSnap.snapshot_id} rowsAvailable=${rowsCheck.data.length}`);
            });

            // S3: CNA Results
            let cnaData: any = null;
            await measure('S3', async () => {
                const categoryBase = CORE_CATEGORIES.find(c => c.id === opts.categoryId)!;
                
                if (opts.mode === 'DRY_RUN') {
                     logStage('S3', 'DRY_RUN: Skipping LLM');
                     cnaData = { summary: "Dry Run Mock" };
                     return;
                }

                // Explicitly pass snapshot ID to ensure it reads the same one
                const res = await runPreSweepIntelligence(categoryBase, 'India', 
                    (l) => console.log(`[GEMINI] ${l.message}`), 
                    new AbortController().signal, 
                    undefined, 
                    corpusSnap.snapshot_id 
                );

                if (!res.ok) throw new Error((res as any).error);
                cnaData = res.data;
                result.artifacts.cnaResultId = `CNA_${Date.now()}`;
                logStage('S3', `cnaResultReady`);
            });

            // S4: Demand Snapshot Loaded
            let demandSnap: any = null;
            await measure('S4', async () => {
                const res = await DemandSnapshotResolver.resolve(opts.categoryId, month);
                
                // If we have a demand snapshot, great. If not, we will be creating one in S6.
                // The prompt says "Demand must resolve snapshot from Demand snapshot store (or same corpus snapshot)".
                // We will treat the corpus snapshot as the base for the new Demand run.
                
                if (res.ok && res.snapshotId) {
                    demandSnap = res.data;
                    logStage('S4', `demandSnapshotLoaded snapshotId=${res.snapshotId} mode=${res.mode}`);
                } else {
                    // Fallback to corpus snap for fresh run
                    if (result.artifacts.corpusSnapshotId) {
                        logStage('S4', `demandSnapshotLoaded FALLBACK to CorpusId=${result.artifacts.corpusSnapshotId}`);
                    } else {
                         throw new Error("No base snapshot for Demand");
                    }
                }
            });

            // S5: Demand Result
            let demandResult: any = null;
            await measure('S5', async () => {
                const categoryBase = CORE_CATEGORIES.find(c => c.id === opts.categoryId)!;
                if (opts.mode === 'DRY_RUN') {
                    demandResult = { demand_index_mn: 100, metric_scores: { readiness: 5, spread: 5 } };
                    return;
                }

                // Run Demand Sweep using the Corpus Snapshot
                // This ensures we are using the same foundation
                // Fixed: Passing correct arguments to runCategorySweep to satisfy expected signature.
                const r1 = await runCategorySweep(
                    categoryBase, 
                    cnaData, // Pass strategy data to guide synthesis
                    'India', 
                    () => {}, 
                    new AbortController().signal, 
                    undefined, 
                    { jobId: runId, runId: `${runId}_1`, windowId: month, registryHash: '', keywordBaseHash: '', budget: {} },
                    undefined,
                    corpusSnap.snapshot_id // Force same snapshot
                );
                
                if (!r1.ok || !r1.data) throw new Error("Demand Run Failed");
                
                demandResult = r1.data;
                logStage('S5', `demandComputed demand=${demandResult.demand_index_mn.toFixed(2)}`);
            });

            // S6: Demand Result Snapshot Created
            await measure('S6', async () => {
                if (opts.mode === 'DRY_RUN') {
                    result.artifacts.demandSnapshotId = "DRY_RUN_DEMAND_ID";
                    return;
                }
                const res = await OutputSnapshotStore.createOutputSnapshot(
                    result.artifacts.corpusSnapshotId, 
                    opts.categoryId, 
                    'IN', 
                    'en', 
                    month,
                    cnaData, // Strategy 
                    demandResult // Demand
                );
                
                if (!res.ok) throw new Error("Failed to save Demand Snapshot");
                result.artifacts.demandSnapshotId = res.data.snapshot_id;
                logStage('S6', `demandSnapshotCreated id=${res.data.snapshot_id}`);
            });

            // S7: Signal Harvester
            let signals: any = null;
            await measure('S7', async () => {
                const res = await SignalSnapshotResolver.resolve(opts.categoryId, month);
                if (res.ok && res.data) {
                    signals = res.data;
                    result.artifacts.signalSnapshotId = res.snapshotId || "UNKNOWN";
                    logStage('S7', `signalsResolved mode=${res.mode} id=${res.snapshotId}`);
                } else {
                    result.warnings.push("Signals Missing - Using Backfill");
                    logStage('S7', `signalsResolved mode=BACKFILL`);
                }
            });

            // S8: Deep Dive Synthesis
            await measure('S8', async () => {
               if (!result.artifacts.demandSnapshotId && opts.mode !== 'DRY_RUN') throw new Error("Missing Demand Snapshot");
               logStage('S8', `deepDiveInputsBound demand=${result.artifacts.demandSnapshotId} signals=${result.artifacts.signalSnapshotId || 'BACKFILL'}`);
            });

            // S9: Deep Dive Result
            let ddResult: any = null;
            await measure('S9', async () => {
                if (opts.mode === 'DRY_RUN') {
                    ddResult = { synthesis: { consumerTruth: "Mock Truth" } };
                    return;
                }
                
                const res = await runSingleDeepDive(opts.categoryId, runId, demandResult); 
                
                if (!res.ok) throw new Error((res as any).error);
                ddResult = res.data;
                result.artifacts.deepDiveResultId = `DD_RES_${Date.now()}`;
                logStage('S9', `deepDiveResultReady`);
            });

            // S10: Deep Dive Result Snapshot
            await measure('S10', async () => {
                if (opts.mode === 'DRY_RUN') {
                    result.artifacts.deepDiveSnapshotId = "DRY_RUN_DD_ID";
                    return;
                }
                const res = await DeepDiveSnapshotStore.createDeepDiveSnapshot(
                    result.artifacts.demandSnapshotId, // Link to output snapshot
                    opts.categoryId,
                    'IN',
                    'en',
                    ddResult
                );
                if (!res.ok) throw new Error("Failed to save Deep Dive Snapshot");
                result.artifacts.deepDiveSnapshotId = res.data.snapshot_id;
                logStage('S10', `deepDiveSnapshotCreated id=${res.data.snapshot_id}`);
            });

            // S11: Playbook
            await measure('S11', async () => {
                if (opts.mode === 'DRY_RUN') return;
                const res = await runSinglePlaybook(opts.categoryId, ddResult);
                if (!res.ok) throw new Error((res as any).error);
                
                // Persist playbook run
                const pbId = `PB_${Date.now()}`;
                try {
                    await setDoc(doc(db, 'playbook_runs', pbId), {
                        runId,
                        categoryId: opts.categoryId,
                        createdAt: new Date().toISOString(),
                        result: FirestoreClient.sanitize(res.data)
                    });
                    result.artifacts.playbookId = pbId;
                } catch (e) {
                    console.warn("Playbook save failed", e);
                }
                logStage('S11', `playbookReady id=${pbId}`);
            });

            // FINAL SUCCESS
            await setDoc(runDocRef, { 
                status: 'COMPLETED', 
                completedAt: new Date().toISOString(),
                result 
            }, { merge: true });

        } catch (e: any) {
            console.error("Pipeline Failed", e);
            result.verdict = 'NO_GO';
        } finally {
            stopHeartbeat();
        }

        console.log("[PIPE] FINAL REPORT", result);
        return result;
    },

    // Helper to capture index errors in queries
    async safeQuery(queryFn: () => Promise<any>): Promise<any> {
        try {
            return await queryFn();
        } catch (e: any) {
            if (e.message && e.message.includes("requires an index")) {
                console.error("[PIPE][INDEX_FALLBACK] Missing Index:", e.message);
                const match = e.message.match(/https:\/\/console\.firebase\.google\.com[^\s]*/);
                if (match) {
                    console.warn("CREATE INDEX HERE:", match[0]);
                }
                throw new Error(`MISSING_INDEX: ${e.message}`);
            }
            throw e;
        }
    }
};
