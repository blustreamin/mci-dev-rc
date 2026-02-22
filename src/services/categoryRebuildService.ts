
import { FirestoreClient } from './firestoreClient';
import { CategoryKeywordGrowthService } from './categoryKeywordGrowthService';
import { JobControlService } from './jobControlService';

export interface RebuildOptions {
    categoryId: string;
    monthKey: string;
    targetDemandMn: number;
    driftBandPct?: number; 
}

export interface RebuildResult {
    ok: boolean;
    stage: string;
    log: string[];
    finalDemandMn?: number;
    snapshotId?: string;
    error?: string;
}

export const CategoryRebuildService = {
    
    /**
     * UNIFIED REBUILD V3
     * Used by Console 'Flush & Rebuild' and Danger Zone.
     * Delegates to CategoryKeywordGrowthService.rebuildCategorySnapshotV3.
     */
    async rebuildCategory(opts: RebuildOptions): Promise<RebuildResult> {
        const { categoryId } = opts;
        const log: string[] = [];
        const logger = (msg: string) => {
            const entry = `[REBUILD_V3_FACADE][${categoryId}] ${msg}`;
            console.log(entry);
            log.push(entry);
        };

        logger(`Starting Rebuild V3 Facade...`);

        const db = FirestoreClient.getDbSafe();
        if (!db) return { ok: false, stage: 'INIT', log, error: "DB_INIT_FAIL" };

        const jobId = await JobControlService.startJob('RESET_REBUILD', categoryId, { message: 'Rebuild V3' });

        try {
            // DELEGATE TO V3 PIPELINE
            logger("Delegating to CategoryKeywordGrowthService.rebuildCategorySnapshotV3...");
            const res = await CategoryKeywordGrowthService.rebuildCategorySnapshotV3(
                categoryId,
                { targetValidPerAnchor: 40, tier: 'LITE' },
                jobId
            );

            if (res.ok) {
                 logger("V3 Rebuild Successful.");
                 return { ok: true, stage: 'COMPLETE', log };
            } else {
                 throw new Error(res.error || "Rebuild failed without specific error");
            }

        } catch (e: any) {
            logger(`FATAL ERROR: ${e.message}`);
            // Job handling is done inside V3 method typically, but safety finish here if bubble up
            await JobControlService.finishJob(jobId, 'FAILED', e.message);
            return { ok: false, stage: 'ERROR', log, error: e.message };
        }
    },
    
    // Legacy delete support stub
    async deleteCollection(db: any, path: string, logger: (m:string)=>void) {
        logger("Delete Collection skipped (Legacy).");
    }
};
