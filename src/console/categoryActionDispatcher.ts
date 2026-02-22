
import { JobControlService } from '../services/jobControlService';
import { CategorySnapshotBuilder } from '../services/categorySnapshotBuilder';
import { CategoryKeywordGrowthService } from '../services/categoryKeywordGrowthService';
import { CorpusBuildService } from '../services/corpusBuildService';
import { SnapshotResolver } from '../services/snapshotResolver';
import { AnchorExpansionService } from '../services/anchorExpansionService';
import { GrowV3Service } from '../services/growV3Service';

export type CategoryActionKind =
  | 'REHYDRATE'
  | 'GROW'
  | 'GROW_V3'
  | 'REVALIDATE'
  | 'CERTIFY'
  | 'STOP'
  | 'BUILD_ALL_CORPUS'
  | 'AMAZON_BOOST'
  | 'EXPAND_ANCHORS';

export async function dispatchCategoryAction(args: {
  kind: CategoryActionKind;
  categoryId: string;
  categoryName: string;
  snapshotId?: string;
  context?: any;
}): Promise<{ ok: true; jobId?: string } | { ok: false; error: string }> {
    console.log(`[UI_ACTION] Dispatching ${args.kind} for ${args.categoryId} (${args.categoryName})`, args);

    try {
        if (!args.categoryId && args.kind !== 'BUILD_ALL_CORPUS') {
            return { ok: false, error: "Missing categoryId" };
        }

        // --- STOP ACTION ---
        if (args.kind === 'STOP') {
             const activeJob = await JobControlService.getActiveJobForCategory(args.categoryId);
             if (!activeJob) return { ok: false, error: "No active job found to stop." };
             
             await JobControlService.requestStop(activeJob.jobId);
             return { ok: true, jobId: activeJob.jobId };
        }

        // --- BUILD ALL ACTION ---
        if (args.kind === 'BUILD_ALL_CORPUS') {
            CorpusBuildService.buildAllCorpus('IN', 'en', (status) => console.log('Build progress:', status));
            return { ok: true, jobId: 'global-build-task' };
        }

        // --- PIPELINE ACTIONS ---
        
        let targetSnapshotId = args.snapshotId;

        if (args.kind === 'REHYDRATE' && !targetSnapshotId) {
             const draftRes = await CategorySnapshotBuilder.ensureDraft(args.categoryId, "IN", "en");
             if (draftRes.ok) {
                 targetSnapshotId = draftRes.data.snapshot_id;
             } else {
                 return { ok: false, error: (draftRes as any).error };
             }
        } 
        else if (!targetSnapshotId) {
             const res = await SnapshotResolver.resolveActiveSnapshot(args.categoryId, "IN", "en");
             if (res.ok && res.snapshot) {
                 targetSnapshotId = res.snapshot.snapshot_id;
             } else {
                 throw new Error("No active snapshot found. Please Hydrate first.");
             }
        }

        let jobKind: any = 'HYDRATE';
        if (args.kind === 'GROW') jobKind = 'GROW';
        else if (args.kind === 'GROW_V3') jobKind = 'GROW';
        else if (args.kind === 'REVALIDATE') jobKind = 'VALIDATE';
        else if (args.kind === 'CERTIFY') jobKind = 'CERTIFY';
        else if (args.kind === 'REHYDRATE') jobKind = 'HYDRATE';
        else if (args.kind === 'AMAZON_BOOST') jobKind = 'AMAZON_BOOST';
        else if (args.kind === 'EXPAND_ANCHORS') jobKind = 'GROW';

        console.log(`[JOB][RESOLVE] Requesting startJob for ${jobKind}`);
        const jobId = await JobControlService.startJob(jobKind, args.categoryId, { snapshotId: targetSnapshotId, message: args.kind === 'GROW_V3' ? 'Grow V3 (1500+)' : 'Processing...' });
        console.log(`[UI_ACTION] Created Job ID: ${jobId}`);
        
        if (args.kind === 'AMAZON_BOOST') {
            console.log(`[AMZ_BOOST][START] categoryId=${args.categoryId} jobId=${jobId}`);
        }
        
        // 3. Trigger Async Runner (Background)
        const runBackground = async () => {
            console.log(`[BG_RUNNER] Starting execution for ${jobId} kind=${args.kind}`);
            try {
                if (args.kind === 'REHYDRATE') {
                    await CategorySnapshotBuilder.hydrate(targetSnapshotId!, args.categoryId, "IN", "en", undefined, jobId);
                } else if (args.kind === 'GROW') {
                    await GrowV3Service.run({ categoryId: args.categoryId, snapshotId: targetSnapshotId!, jobId: jobId, tier: 'FULL' });
                } else if (args.kind === 'GROW_V3') {
                    await CategoryKeywordGrowthService.growV3ToTarget({
                        categoryId: args.categoryId,
                        snapshotId: targetSnapshotId!,
                        jobId,
                        targetVerifiedMin: 1500,
                        targetVerifiedMax: 2000,
                        minVolume: 20
                    });
                } else if (args.kind === 'REVALIDATE') {
                    await CategoryKeywordGrowthService.validateSnapshot(args.categoryId, targetSnapshotId!, "IN", "en", undefined, jobId);
                } else if (args.kind === 'CERTIFY') {
                    const tier = args.context?.tier || 'FULL';
                    await CategorySnapshotBuilder.certify(targetSnapshotId!, args.categoryId, "IN", "en", tier, jobId);
                } else if (args.kind === 'AMAZON_BOOST') {
                    console.log(`[BG_RUNNER] Invoking AMAZON_BOOST service...`);
                    await CategoryKeywordGrowthService.amazonBoostBackfill(args.categoryId, targetSnapshotId!, 'FULL', jobId);
                } else if (args.kind === 'EXPAND_ANCHORS') {
                    console.log(`[BG_RUNNER] Expanding Anchors...`);
                    const res = await AnchorExpansionService.expandToMinPassingAnchors(args.categoryId, targetSnapshotId!, { jobId });
                    await JobControlService.finishJob(jobId, 'COMPLETED', `Expanded ${res.anchorsModified} anchors`);
                }

                // Safety net: if service returned without finishing the job, mark COMPLETED
                try {
                    const finalJob = await JobControlService.getJob(jobId);
                    if (finalJob && !['COMPLETED', 'FAILED', 'STOPPED', 'CANCELLED'].includes(finalJob.status)) {
                        console.log(`[Dispatcher] Service returned without finishing job ${jobId}. Marking COMPLETED.`);
                        await JobControlService.finishJob(jobId, 'COMPLETED');
                    }
                } catch (_) { /* best effort */ }

            } catch (e: any) {
                console.error(`[Dispatcher] Background Runner Failed for ${jobId}`, e);
                if (e.message !== 'STOPPED') {
                    try {
                        const currentJob = await JobControlService.getJob(jobId);
                        if (currentJob && !['COMPLETED', 'FAILED', 'STOPPED', 'CANCELLED'].includes(currentJob.status)) {
                            await JobControlService.finishJob(jobId, 'FAILED', e.message || "Unknown Runtime Error");
                        }
                    } catch (finishErr) {
                        console.error(`[Dispatcher] Failed to mark job as FAILED`, finishErr);
                    }
                }
            }
        };

        runBackground();

        return { ok: true, jobId };

    } catch (e: any) {
        console.error(`[UI_ACTION] Error in dispatcher`, e);
        return { ok: false, error: e.message || String(e) };
    }
}
