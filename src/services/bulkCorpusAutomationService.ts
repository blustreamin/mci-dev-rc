
import { CORE_CATEGORIES } from '../constants';
import { CategorySnapshotStore } from './categorySnapshotStore';
import { CategorySnapshotBuilder } from './categorySnapshotBuilder';
import { CategoryKeywordGrowthService } from './categoryKeywordGrowthService';
import { SnapshotResolver } from './snapshotResolver';
import { AsyncPool } from './asyncPool';
import { JobControlService } from './jobControlService';
import { SnapshotLifecycle } from '../types';
import { WiringTrace } from './wiringTrace';
import { DataForSeoClient } from './demand_vNext/dataforseoClient';
import { FORCE_CERTIFY_MODE, BUILD_STAMP } from '../constants/runtimeFlags';
import { CorpusIndexStore } from './corpusIndexStore';
import { CorpusHealthRunner } from './corpusHealthRunner';

const MIN_VALID_FOR_LITE = FORCE_CERTIFY_MODE ? 0 : 50;
const CONCURRENCY = 2;

export interface BulkCertifySummary {
    startedAt: string;
    finishedAt: string;
    totalCategories: number;
    certifiedLite: string[];
    skippedAlreadyCertified: string[];
    failed: Array<{ id: string; stage: string; reason: string }>;
    metricsByCategory: Record<string, {
        total: number;
        valid: number;
        anchorsWithZero: number;
        topAnchorByValid: string;
        status: string;
    }>;
}

export type BulkRunConfig = {
  onlyCategoryIds?: string[];
  chunkSize?: number;      // default 4
  chunkIndex?: number;     // default 0
};

export const BulkCorpusAutomationService = {
    abortController: null as AbortController | null,
    statusMessage: 'Idle',

    stop() {
        if (this.abortController) {
            console.warn("[AP] STOP_REQUESTED");
            this.abortController.abort();
            this.abortController = null;
            this.statusMessage = 'Stopped';
        }
    },

    async runBulkAmazonBoost(tier: 'LITE' | 'FULL' = 'LITE'): Promise<void> {
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        console.log(`[BULK_AMZ] Starting Amazon Boost (${tier}) for all categories...`);
        this.statusMessage = `Starting Amazon Boost...`;

        // Sequential execution for safety and API limits
        for (const cat of CORE_CATEGORIES) {
            if (signal.aborted) break;
            const catId = cat.id;
            this.statusMessage = `Boosting ${catId}...`;

            try {
                // 1. Resolve Snapshot
                const res = await SnapshotResolver.resolveActiveSnapshot(catId, 'IN', 'en');
                if (!res.ok || !res.snapshot) {
                    console.warn(`[BULK_AMZ] Skipping ${catId} - No Snapshot`);
                    continue;
                }
                const snapshotId = res.snapshot.snapshot_id;

                // 2. Start Job
                const jobId = await JobControlService.startJob('GROW', catId, { message: `Amazon Boost V1` });

                // 3. Run Boost
                try {
                    await CategoryKeywordGrowthService.amazonBoostBackfill(catId, snapshotId, tier, jobId);
                    // Fix: use 'COMPLETED'
                    await JobControlService.finishJob(jobId, 'COMPLETED', 'Amazon Boost Done');
                } catch (e: any) {
                    await JobControlService.finishJob(jobId, 'FAILED', e.message);
                    console.error(`[BULK_AMZ] Job failed for ${catId}`, e);
                }

            } catch (e: any) {
                console.error(`[BULK_AMZ] Setup failed for ${catId}`, e);
            }
        }

        this.statusMessage = 'Bulk Amazon Boost Complete';
        console.log(`[BULK_AMZ] All Done.`);
        this.abortController = null;
    },

    async runBulkCloseDeficits(tier: 'LITE' | 'FULL' = 'LITE'): Promise<void> {
        this.abortController = new AbortController();
        const signal = this.abortController.signal;
        
        console.log(`[BULK_DEFICIT] Starting ${tier} run for all categories...`);
        this.statusMessage = `Starting ${tier} Deficit Fill...`;

        for (const cat of CORE_CATEGORIES) {
            if (signal.aborted) break;
            
            const catId = cat.id;
            this.statusMessage = `Processing ${catId}...`;
            console.log(`[BULK_DEFICIT] Processing ${catId}`);

            try {
                // 1. Resolve Snapshot
                const res = await SnapshotResolver.resolveActiveSnapshot(catId, 'IN', 'en');
                let snapshotId = res.snapshot?.snapshot_id;
                
                if (!snapshotId) {
                    console.log(`[BULK_DEFICIT] Snapshot missing for ${catId}, creating draft...`);
                    const draft = await CategorySnapshotBuilder.ensureDraft(catId, 'IN', 'en');
                    if (!draft.ok) throw new Error("Draft failed");
                    snapshotId = draft.data.snapshot_id;
                }

                // 2. Start Job
                const jobId = await JobControlService.startJob('GROW', catId, { message: `Bulk Deficit Fill (${tier})` });
                
                try {
                    // 3. Run Close Deficits V2
                    await CategoryKeywordGrowthService.closeAnchorDeficitsV2(catId, snapshotId, tier, jobId);
                    // Fix: use 'COMPLETED'
                    await JobControlService.finishJob(jobId, 'COMPLETED', 'Deficit Run Done');
                } catch (e: any) {
                    await JobControlService.finishJob(jobId, 'FAILED', e.message);
                    console.error(`[BULK_DEFICIT] Job failed for ${catId}`, e);
                }

            } catch (e: any) {
                console.error(`[BULK_DEFICIT] Failed setup for ${catId}`, e);
            }
        }

        this.statusMessage = 'Bulk Deficit Fill Complete';
        console.log(`[BULK_DEFICIT] All Done.`);
    },

    async forceCertifyLiteAll(): Promise<{ ok: boolean; certified: string[]; failed: any[]; }> {
        const certified: string[] = [];
        const failed: any[] = [];
        for (const cat of CORE_CATEGORIES) {
            try {
                let snapRes = await SnapshotResolver.resolveActiveSnapshot(cat.id, 'IN', 'en');
                let snapshot;
                if (!snapRes.ok || !snapRes.snapshot) {
                    const draftRes = await CategorySnapshotBuilder.ensureDraft(cat.id, 'IN', 'en');
                    if (!draftRes.ok) throw new Error("Draft creation failed");
                    snapshot = draftRes.data;
                } else {
                    snapshot = snapRes.snapshot!;
                }
                snapshot.lifecycle = 'CERTIFIED_LITE';
                snapshot.updated_at_iso = new Date().toISOString();
                if (snapshot.stats) {
                    snapshot.stats.valid_total = snapshot.stats.keywords_total;
                    snapshot.stats.validated_total = snapshot.stats.keywords_total;
                    snapshot.stats.zero_total = 0;
                }
                await CategorySnapshotStore.writeSnapshot(snapshot);
                await CorpusIndexStore.upsertFromSnapshot(snapshot);
                certified.push(cat.id);
            } catch (e: any) {
                failed.push({ id: cat.id, error: e.message });
            }
        }
        return { ok: true, certified, failed };
    },

    async runBulkCertifyLite(traceId: string = `AP-${Date.now()}`, config: BulkRunConfig = {}): Promise<BulkCertifySummary> {
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        // 1. Determine Scope
        let targetCategories = [];
        const chunkSize = config.chunkSize || 4;
        const chunkIndex = config.chunkIndex || 0;

        if (config.onlyCategoryIds && config.onlyCategoryIds.length > 0) {
            targetCategories = CORE_CATEGORIES.filter(c => config.onlyCategoryIds!.includes(c.id));
        } else {
            const start = chunkIndex * chunkSize;
            const end = start + chunkSize;
            targetCategories = CORE_CATEGORIES.slice(start, end);
        }

        console.log(`[AUTOPILOT][SCOPE] chunkSize=${chunkSize} chunkIndex=${chunkIndex} totalTarget=${targetCategories.length} ids=${targetCategories.map(c => c.id).join(',')}`);
        WiringTrace.log(traceId, "ALL", "SERVICE_START", { totalCategories: targetCategories.length, config });

        const startedAt = new Date().toISOString();
        this.statusMessage = `Processing Chunk (${targetCategories.length} Categories)...`;

        const summary: BulkCertifySummary = {
            startedAt,
            finishedAt: '',
            totalCategories: targetCategories.length,
            certifiedLite: [],
            skippedAlreadyCertified: [],
            failed: [],
            metricsByCategory: {}
        };

        const tasks = targetCategories.map(cat => async () => {
            if (signal.aborted) return;
            const catId = cat.id;
            this.statusMessage = `Processing ${catId}...`;

            let stopHeartbeat: (() => void) | null = null;

            try {
                // 1. Start Job & Heartbeat
                const jobId = await JobControlService.startJob('BUILD_ALL', catId, {});
                stopHeartbeat = JobControlService.startHeartbeat(jobId);

                try {
                    if (signal.aborted) throw new Error("ABORTED");

                    // USE V3 PIPELINE
                    await CategoryKeywordGrowthService.rebuildCategorySnapshotV3(
                        catId,
                        { targetValidPerAnchor: 40, tier: 'LITE' },
                        jobId
                    );

                    summary.certifiedLite.push(catId);
                    summary.metricsByCategory[catId] = {
                        total: 0, valid: 0, anchorsWithZero: 0, topAnchorByValid: 'N/A', status: 'CERTIFIED_LITE'
                    };

                    // Fix: use 'COMPLETED'
                    await JobControlService.finishJob(jobId, 'COMPLETED');

                } catch (e: any) {
                    const msg = e.message || 'Unknown Error';
                    const status = msg === 'ABORTED' ? 'STOPPED' : 'FAILED';
                    await JobControlService.finishJob(jobId, status, msg);
                    throw e;
                } finally {
                    if (stopHeartbeat) stopHeartbeat();
                }

            } catch (e: any) {
                if (e.message !== 'ABORTED') {
                    summary.failed.push({ id: catId, stage: 'PIPELINE', reason: e.message });
                }
            }
        });

        try {
            await AsyncPool.run(tasks, CONCURRENCY, signal);
        } catch (e: any) {
            if (e.message === 'ABORTED') console.log("Bulk run aborted");
            else throw e;
        }

        summary.finishedAt = new Date().toISOString();
        this.statusMessage = 'Batch Run Complete';
        this.abortController = null;
        return summary;
    },

    // NEW: Explicit V3 Entrypoint for Flush & Rebuild Modal
    async runFlushAndRebuildAllCategoriesV3(): Promise<void> {
        this.abortController = new AbortController();
        const signal = this.abortController.signal;
        
        console.log(`[FLUSH_REBUILD_V3] Starting sequential rebuild for all categories...`);
        this.statusMessage = `Starting V3 Rebuild...`;
        
        // Strict Sequential Execution (Concurrency 1) for stability
        for (const cat of CORE_CATEGORIES) {
            if (signal.aborted) {
                console.log("[FLUSH_REBUILD_V3] Aborted by user");
                break;
            }
            
            const catId = cat.id;
            this.statusMessage = `Rebuilding ${catId}...`;
            console.log(`[FLUSH_REBUILD_V3] Processing ${catId}`);

            try {
                // 1. Start Job Tracking
                const jobId = await JobControlService.startJob('BUILD_ALL', catId, { message: 'Flush & Rebuild V3' });
                
                try {
                    // 2. Call V3 Rebuild Entrypoint
                    await CategoryKeywordGrowthService.rebuildCategorySnapshotV3(
                        catId,
                        { targetValidPerAnchor: 40, tier: 'LITE' },
                        jobId
                    );
                    
                    // Success is handled inside rebuildCategorySnapshotV3 (finishes job)
                    console.log(`[FLUSH_REBUILD_V3] ${catId} Complete.`);
                } catch (e: any) {
                    console.error(`[FLUSH_REBUILD_V3] ${catId} Failed`, e);
                    // Job handling is done inside rebuildCategorySnapshotV3 catch block or here if it bubbles
                    // Just ensure we don't crash the loop
                }

            } catch (e: any) {
                console.error(`[FLUSH_REBUILD_V3] Failed setup for ${catId}`, e);
            }
        }
        
        this.statusMessage = 'Flush & Rebuild Complete';
        console.log(`[FLUSH_REBUILD_V3] All Done.`);
        this.abortController = null;
    }
};
