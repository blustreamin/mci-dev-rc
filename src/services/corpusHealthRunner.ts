
import { doc, setDoc } from 'firebase/firestore';
import { FirestoreClient } from './firestoreClient';
import { CORE_CATEGORIES } from '../constants';
import { CorpusHealthService } from './corpusHealthService';
import { CorpusCleanupService } from './corpusCleanupService';
import { CategorySnapshotBuilder } from './categorySnapshotBuilder';
import { CategoryKeywordGrowthService } from './categoryKeywordGrowthService';
import { JobControlService } from './jobControlService';
import { SnapshotResolver } from './snapshotResolver';
import { DataForSeoClient } from './demand_vNext/dataforseoClient';

export interface HealthFixSummary {
    runId: string;
    startedAt: string;
    finishedAt?: string;
    categories: string[];
    results: Record<string, {
        status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
        stages: {
            hydrate?: boolean;
            grow?: boolean;
            validate?: boolean;
            prune?: number; // count removed
            certify?: boolean;
        };
        error?: string;
    }>;
}

export const CorpusHealthRunner = {
    statusMessage: 'Idle',

    async runCategoryHealthFix(categoryId: string, jobId?: string): Promise<boolean> {
        let currentJobId = jobId;
        
        if (!currentJobId) {
            currentJobId = await JobControlService.startJob('BUILD_ALL', categoryId, { message: 'Fixing Health...' });
        }

        const log = async (msg: string) => {
            console.log(`[HEALTH_FIX][${categoryId}] ${msg}`);
            if (currentJobId) await JobControlService.updateProgress(currentJobId, { message: msg });
        };

        const heartbeat = currentJobId ? JobControlService.startHeartbeat(currentJobId) : () => {};

        try {
            log('Step 1: Resolving Snapshot...');
            let snapshotId: string;
            
            const res = await SnapshotResolver.resolveActiveSnapshot(categoryId, 'IN', 'en');
            if (res.ok && res.snapshot) {
                snapshotId = res.snapshot.snapshot_id;
            } else {
                log('Snapshot missing, creating draft...');
                const draft = await CategorySnapshotBuilder.ensureDraft(categoryId, 'IN', 'en');
                if (!draft.ok) throw new Error("Draft creation failed");
                snapshotId = draft.data.snapshot_id;
            }

            log('Step 2: Hydrating...');
            const hydrateRes = await CategorySnapshotBuilder.hydrate(snapshotId, categoryId, 'IN', 'en', undefined, currentJobId);
            if (!hydrateRes.ok) throw new Error(`Hydrate failed: ${(hydrateRes as any).error}`);

            log('Step 3: Growing (Target 300)...');
            const growRes = await CategoryKeywordGrowthService.growCategory(categoryId, snapshotId, 300, undefined, currentJobId);
            // Fix: handle union correctly
            if (!growRes.ok) throw new Error(`Grow failed: ${(growRes as any).error}`);

            log('Step 4: Validating Volume (DataForSEO)...');
            const valRes = await CategoryKeywordGrowthService.validateSnapshot(categoryId, snapshotId, 'IN', 'en', undefined, currentJobId);
            // Fix: handle union correctly
            if (!valRes.ok) throw new Error(`Validation failed: ${(valRes as any).error}`);

            log('Step 5: Pruning Zero-SV Keywords...');
            const pruneRes = await CorpusCleanupService.cleanupZeroSvKeywords(categoryId, snapshotId);
            log(`Pruned ${pruneRes.zeroMarked} zero-volume keywords.`);

            log('Step 6: Certifying (LITE)...');
            const certRes = await CategorySnapshotBuilder.certify(snapshotId, categoryId, 'IN', 'en', 'LITE', currentJobId);
            
            // Re-evaluate health to update stats
            await CorpusHealthService.evaluateCategoryHealth(categoryId, snapshotId);

            if (certRes.ok) {
                log('SUCCESS: Category Certified Lite.');
                // Fix: use 'COMPLETED'
                if (currentJobId) await JobControlService.finishJob(currentJobId, 'COMPLETED', 'Health Fixed');
                return true;
            } else {
                log(`WARNING: Certification failed: ${(certRes as any).error}`);
                if (currentJobId) await JobControlService.finishJob(currentJobId, 'FAILED', (certRes as any).error);
                return false;
            }

        } catch (e: any) {
            console.error(`[HEALTH_FIX][${categoryId}] FATAL`, e);
            if (currentJobId) await JobControlService.finishJob(currentJobId, 'FAILED', e.message);
            return false;
        } finally {
            heartbeat();
        }
    },

    /**
     * Batch Runner with Chunking
     */
    async runBatchHealthFix(categories: string[], onProgress?: (msg: string) => void): Promise<HealthFixSummary> {
        const runId = `HF_BATCH_${Date.now()}`;
        const summary: HealthFixSummary = {
            runId,
            startedAt: new Date().toISOString(),
            categories,
            results: {}
        };

        this.statusMessage = 'Batch Started';
        
        for (let i = 0; i < categories.length; i++) {
            const catId = categories[i];
            const msg = `Processing ${catId} (${i + 1}/${categories.length})...`;
            this.statusMessage = msg;
            if (onProgress) onProgress(msg);

            summary.results[catId] = { status: 'SKIPPED', stages: {} };

            try {
                const success = await this.runCategoryHealthFix(catId);
                summary.results[catId].status = success ? 'SUCCESS' : 'FAILED';
            } catch (e: any) {
                summary.results[catId].status = 'FAILED';
                summary.results[catId].error = e.message;
            }
        }

        summary.finishedAt = new Date().toISOString();
        this.statusMessage = 'Batch Complete';
        return summary;
    }
};
