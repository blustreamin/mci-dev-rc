
import { SnapshotResolver } from './snapshotResolver';
import { CategoryKeywordGrowthService } from './categoryKeywordGrowthService';
import { DemandMetricsRunner } from './demandMetricsRunner';
import { OutputSnapshotStore } from './outputSnapshotStore';
import { JobControlService } from './jobControlService';

export const SnapshotRepairService = {
    async run(categoryId: string, monthKey: string): Promise<{ ok: boolean; log: string[]; error?: string }> {
        const logs: string[] = [];
        const log = (msg: string) => {
            console.log(msg);
            logs.push(msg);
        };

        log(`[SNAP_REPAIR][START] category=${categoryId} month=${monthKey}`);
        
        try {
            const jobId = await JobControlService.startJob('VALIDATE', categoryId, { message: 'Snapshot Repair' });
            
            // 1. Resolve Active Snapshot
            const res = await SnapshotResolver.resolveActiveSnapshot(categoryId, 'IN', 'en');
            if (!res.ok || !res.snapshot) throw new Error("No active snapshot found.");
            const snapId = res.snapshot.snapshot_id;
            
            // 2. Google Validation
            log(`[DFS_GOOGLE] Starting validation...`);
            const valRes = await CategoryKeywordGrowthService.validateSnapshot(categoryId, snapId, 'IN', 'en', undefined, jobId);
            if (!valRes.ok) throw new Error(`Google Validation Failed: ${valRes.reasons?.join(', ') || 'Unknown error'}`);
            log(`[DFS_GOOGLE] Completed.`);

            // 3. Amazon Boost
            log(`[DFS_AMZ] Starting Amazon Boost...`);
            const amzRes = await CategoryKeywordGrowthService.amazonBoostBackfill(categoryId, snapId, 'FULL', jobId);
            if (!amzRes.ok) throw new Error(`Amazon Boost Failed: ${amzRes.error}`);
            log(`[DFS_AMZ] Completed.`);

            // 4. Metrics
            log(`[METRICS] Recomputing Demand...`);
            // Fixed: Passing correct arguments to runDemandMetrics to satisfy expected signature.
            const metRes = await DemandMetricsRunner.runDemandMetrics(categoryId, monthKey, { forceRecalculate: true, jobId });
            
            if (metRes.ok && metRes.metrics) {
                const m = metRes.metrics;
                log(`[DEMAND_INDEX]=${m.demand_index_mn.toFixed(2)} Mn`);
                log(`[OUTPUT] Saving snapshot...`);
                await OutputSnapshotStore.createOutputSnapshot(snapId, categoryId, 'IN', 'en', monthKey, {}, m.result);
                log(`[SNAP_REPAIR][DONE] snapshotId=${snapId} rows=${m.inputs.validRowsUsed}`);
            } else {
                throw new Error(`Metrics Calc Failed: ${metRes.error}`);
            }

            await JobControlService.finishJob(jobId, 'COMPLETED', 'Repair Done');
            return { ok: true, log: logs };

        } catch (e: any) {
            log(`[SNAP_REPAIR][ERROR] ${e.message}`);
            return { ok: false, log: logs, error: e.message };
        }
    }
};
