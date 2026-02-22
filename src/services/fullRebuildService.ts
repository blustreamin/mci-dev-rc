
import { CategoryRebuildService } from './categoryRebuildService';

export const FullRebuildService = {
    async runCategoryFullRebuild(params: { categoryId: string; month: string; forceDFS: boolean }): Promise<{ ok: boolean; log: string[]; error?: string }> {
        const { categoryId, month } = params;
        const logs: string[] = [];
        
        console.log(`[FULL_REBUILD][START] category=${categoryId}`);
        logs.push(`[FULL_REBUILD][START] category=${categoryId}`);

        try {
            // Target demand 0 implies we want to build from scratch/truth without forcing a specific target initially, 
            // relying on the V3 pipeline to find the natural level.
            const res = await CategoryRebuildService.rebuildCategory({
                categoryId,
                monthKey: month,
                targetDemandMn: 0 
            });

            if (res.ok) {
                logs.push(...res.log);
                logs.push(`[FULL_REBUILD][DONE] snapshot=${res.snapshotId || 'unknown'}`);
                return { ok: true, log: logs };
            } else {
                throw new Error(res.error || "Rebuild failed");
            }
        } catch (e: any) {
            logs.push(`[FULL_REBUILD][ERROR] ${e.message}`);
            console.error(e);
            return { ok: false, log: logs, error: e.message };
        }
    }
};
