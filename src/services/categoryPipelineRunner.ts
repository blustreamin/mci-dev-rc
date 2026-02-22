import { JobControlService } from './jobControlService';
import { SnapshotResolver } from './snapshotResolver';
import { CategorySnapshotBuilder } from './categorySnapshotBuilder';
import { CategoryKeywordGrowthService } from './categoryKeywordGrowthService';
import { CategorySnapshotStore } from './categorySnapshotStore';
import { DataForSeoClient } from './demand_vNext/dataforseoClient';
import { WiringTrace } from './wiringTrace';

const TIMEOUT_GROW = 120000;
const TIMEOUT_VALIDATE = 240000;
const TIMEOUT_CERTIFY = 120000;

const withTimeout = <T>(promise: Promise<T>, ms: number, errorMsg: string): Promise<T> => {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error(errorMsg)), ms))
    ]);
};

export const CategoryPipelineRunner = {
    async runCategoryPipeline(categoryId: string, signal?: AbortSignal) {
        const runId = `PIPE_${categoryId}_${Date.now()}`;
        console.log(`[PIPELINE][START] runId=${runId} categoryId=${categoryId}`);
        WiringTrace.log(runId, categoryId, 'PIPELINE_START', { timestamp: new Date().toISOString() });

        try {
            // 1. HYDRATE / RESOLVE
            let snapshotId: string;
            let currentLifecycle: string;

            const res = await SnapshotResolver.resolveActiveSnapshot(categoryId, 'IN', 'en');
            if (res.ok && res.snapshot) {
                snapshotId = res.snapshot.snapshot_id;
                currentLifecycle = res.snapshot.lifecycle;
            } else {
                console.log(`[PIPELINE] No active snapshot, ensuring draft...`);
                const draft = await CategorySnapshotBuilder.ensureDraft(categoryId, 'IN', 'en');
                if (!draft.ok) throw new Error(`Draft creation failed: ${(draft as any).error}`);
                snapshotId = draft.data.snapshot_id;
                currentLifecycle = 'DRAFT';
            }
            
            const snapRes = await CategorySnapshotStore.getSnapshotById({ categoryId: categoryId, countryCode: 'IN', languageCode: 'en' }, snapshotId);
            if(snapRes.ok) {
                 console.log(`[PIPELINE][RESOLVE_OK] ${snapshotId} (${snapRes.data.lifecycle}) Stats:`, snapRes.data.stats);
                 WiringTrace.log(runId, categoryId, 'RESOLVE_OK', { snapshotId, lifecycle: snapRes.data.lifecycle });
            }

            if (signal?.aborted) throw new Error("ABORTED");

            // 2. GROW
            {
                const jobId = await JobControlService.startJob('GROW', categoryId, { 
                    message: `Pipeline Growth ${runId}`
                });
                
                try {
                    console.log(`[PIPELINE][GROW] Starting...`);
                    const growRes = await withTimeout(
                        CategoryKeywordGrowthService.growCategory(categoryId, snapshotId, 300, undefined, jobId),
                        TIMEOUT_GROW,
                        "TIMEOUT_GROW"
                    );

                    // Fix: added type check and cast to resolve unknown to object assignability
                    if (growRes && typeof growRes === 'object' && 'ok' in growRes && !(growRes as any).ok) {
                        throw new Error((growRes as any).error || "Grow failed");
                    }
                    
                    // Fix: use 'COMPLETED'
                    await JobControlService.finishJob(jobId, 'COMPLETED');
                    console.log(`[PIPELINE][GROW_OK]`);
                    WiringTrace.log(runId, categoryId, 'GROW_OK', {});
                } catch (e: any) {
                    await JobControlService.finishJob(jobId, 'FAILED', e.message);
                    throw e;
                }
            }

            if (signal?.aborted) throw new Error("ABORTED");

            // 3. VALIDATE
            {
                const jobId = await JobControlService.startJob('VALIDATE', categoryId, {
                    message: `Pipeline Validate ${runId}`
                });

                try {
                    console.log(`[PIPELINE][VALIDATE] Starting...`);
                    const valRes = await withTimeout(
                        CategoryKeywordGrowthService.validateSnapshot(categoryId, snapshotId, 'IN', 'en', undefined, jobId),
                        TIMEOUT_VALIDATE,
                        "TIMEOUT_VALIDATE"
                    );

                    // Fixed: type check explicitly to access error
                    if (valRes && 'ok' in valRes && !valRes.ok) {
                        throw new Error((valRes as any).error || "Validate failed");
                    }

                    // Fix: use 'COMPLETED'
                    await JobControlService.finishJob(jobId, 'COMPLETED');
                    console.log(`[PIPELINE][VALIDATE_OK] Usage: ${DataForSeoClient.getUsageReport()}`);
                    WiringTrace.log(runId, categoryId, 'VALIDATE_OK', { usage: DataForSeoClient.getUsageReport() });
                } catch (e: any) {
                    await JobControlService.finishJob(jobId, 'FAILED', e.message);
                    throw e;
                }
            }

            if (signal?.aborted) throw new Error("ABORTED");

            // 4. CERTIFY
            {
                const jobId = await JobControlService.startJob('CERTIFY', categoryId, {
                    message: `Pipeline Certify ${runId}`
                });

                try {
                    console.log(`[PIPELINE][CERTIFY] Starting...`);
                    const certRes = await withTimeout(
                        CategorySnapshotBuilder.certify(snapshotId, categoryId, 'IN', 'en', 'LITE', jobId),
                        TIMEOUT_CERTIFY,
                        "TIMEOUT_CERTIFY"
                    );

                    if (!certRes.ok) {
                        const err = (certRes as any).error;
                        await JobControlService.finishJob(jobId, 'FAILED', err);
                        console.warn(`[PIPELINE][CERTIFY_FAIL] ${err}`);
                        return { ok: false, stage: "CERTIFY", error: err, runId, categoryId };
                    }

                    // Fix: use 'COMPLETED'
                    await JobControlService.finishJob(jobId, 'COMPLETED');
                    console.log(`[PIPELINE][CERTIFY_OK]`);
                    WiringTrace.log(runId, categoryId, 'CERTIFY_OK', { lifecycle: certRes.data.lifecycle });
                } catch (e: any) {
                    await JobControlService.finishJob(jobId, 'FAILED', e.message);
                    throw e;
                }
            }

            // 5. VERIFY
            const finalSnap = await CategorySnapshotStore.getSnapshotById({ categoryId: categoryId, countryCode: 'IN', languageCode: 'en' }, snapshotId);
            if (!finalSnap.ok) throw new Error("Final read failed");

            console.log(`[PIPELINE][COMPLETE] ${categoryId} ${finalSnap.data.lifecycle}`, finalSnap.data.lifecycle, finalSnap.data.stats);
            
            return {
                ok: true,
                categoryId,
                snapshotId,
                lifecycle: finalSnap.data.lifecycle,
                stats: finalSnap.data.stats,
                runId
            };

        } catch (e: any) {
            console.error(`[PIPELINE][FATAL]`, e);
            WiringTrace.log(runId, categoryId, 'PIPELINE_FATAL', { error: e.message });
            return { ok: false, stage: 'FATAL', error: e.message, runId, categoryId };
        }
    }
};