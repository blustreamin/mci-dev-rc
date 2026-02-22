
import { CORE_CATEGORIES } from '../constants';
import { CategorySnapshotBuilder } from './categorySnapshotBuilder';
import { CategoryKeywordGrowthService } from './categoryKeywordGrowthService';
import { SnapshotResolver } from './snapshotResolver';
import { AsyncPool } from './asyncPool';
import { JobControlService } from './jobControlService';
import { WiringTrace } from './wiringTrace';

export interface RebuildStatus {
    total: number;
    processed: number;
    currentCategory: string;
    stage: string;
    logs: string[];
}

export const CorpusRebuildService = {
    abortController: null as AbortController | null,

    stop() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
    },

    /**
     * Executes the V3 Pipeline for a single category.
     * Designed for use by the Global Orchestrator.
     */
    async rebuildSingleCategoryV3(categoryId: string, jobId: string) {
        // 1. Ensure Snapshot Draft (always create fresh for rebuild)
        const draftRes = await CategorySnapshotBuilder.ensureDraft(categoryId, 'IN', 'en');
        if (!draftRes.ok) return draftRes;
        
        const snapshotId = draftRes.data.snapshot_id;

        // 2. Full V3 Rebuild: Hydrate -> Grow (2000 target) -> Validate -> Certify
        // Switched to FULL tier to ensure meaningful demand metrics
        return await CategoryKeywordGrowthService.rebuildCategorySnapshotV3(
            categoryId,
            { targetValidPerAnchor: 80, tier: 'FULL' } // Lowered: 80 * 6 anchors = 480 target valid,
            jobId
        );
    },

    async rebuildAll(
        onProgress: (status: RebuildStatus) => void,
        concurrency: number = 1
    ): Promise<void> {
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        const status: RebuildStatus = {
            total: CORE_CATEGORIES.length,
            processed: 0,
            currentCategory: 'START',
            stage: 'INIT',
            logs: []
        };

        const log = (msg: string) => {
            console.log(`[REBUILD] ${msg}`);
            status.logs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
            if (status.logs.length > 50) status.logs.shift();
            onProgress({ ...status });
        };

        log(`Starting Full Rebuild for ${CORE_CATEGORIES.length} categories...`);

        const tasks = CORE_CATEGORIES.map(cat => async () => {
            if (signal.aborted) return;
            
            status.currentCategory = cat.category;
            status.stage = 'PROCESSING';
            log(`>>> Processing ${cat.category} (${cat.id})`);

            try {
                // 1. Start Job Tracking
                const jobId = await JobControlService.startJob('BUILD_ALL', cat.id, { message: 'Rebuild: Fresh Start' });
                
                // 2. Execute V3 Pipeline
                // Use the updated rebuildSingleCategoryV3 logic here if calling directly or reuse service logic
                // Calling service method directly to ensure updated logic
                const res = await this.rebuildSingleCategoryV3(cat.id, jobId);

                if ((res as any).ok) {
                    log(`${cat.category}: SUCCESS - V3 Pipeline Complete.`);
                } else {
                    log(`${cat.category}: FAILED - ${(res as any).error}`);
                    await JobControlService.finishJob(jobId, 'FAILED', (res as any).error);
                }

            } catch (e: any) {
                log(`${cat.category}: FAILED - ${e.message}`);
            } finally {
                status.processed++;
                onProgress({ ...status });
            }
        });

        await AsyncPool.run(tasks, concurrency, signal);

        status.stage = 'COMPLETE';
        status.currentCategory = 'ALL DONE';
        log(`Rebuild Complete.`);
        this.abortController = null;
    }
};
