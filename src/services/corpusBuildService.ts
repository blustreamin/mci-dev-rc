
import { CORE_CATEGORIES } from '../constants';
import { CategorySnapshotBuilder } from './categorySnapshotBuilder';
import { CategorySnapshotStore } from './categorySnapshotStore';
import { CategoryKeywordGrowthService } from './categoryKeywordGrowthService';
import { CorpusIndexStore } from './corpusIndexStore';

export interface BuildAllStatus {
    total: number;
    processed: number;
    currentCategory: string;
    stage: 'INIT' | 'HYDRATE' | 'VALIDATE' | 'CERTIFY' | 'DONE';
    stats: {
        success: string[];
        failed: string[];
        paused: string[];
    };
}

export const CorpusBuildService = {
    abortController: null as AbortController | null,

    stop() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
    },

    async buildAllCorpus(
        country: string = 'IN', 
        lang: string = 'en',
        onProgress?: (status: BuildAllStatus) => void
    ): Promise<void> {
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        const status: BuildAllStatus = {
            total: CORE_CATEGORIES.length,
            processed: 0,
            currentCategory: '',
            stage: 'INIT',
            stats: { success: [], failed: [], paused: [] }
        };

        const update = () => onProgress?.({ ...status });

        for (const cat of CORE_CATEGORIES) {
            if (signal.aborted) break;
            
            status.currentCategory = cat.category;
            status.stage = 'INIT';
            update();

            try {
                // 1. Ensure Snapshot
                const draftRes = await CategorySnapshotBuilder.ensureDraft(cat.id, country, lang);
                if (!draftRes.ok) {
                    // Type-safe error access
                    throw new Error((draftRes as any).error || "Draft creation failed");
                }
                let snapshot = draftRes.data;

                // 2. Hydrate (if empty)
                if (snapshot.stats.keywords_total < 50) {
                    status.stage = 'HYDRATE';
                    update();
                    await CategorySnapshotBuilder.hydrate(snapshot.snapshot_id, cat.id, country, lang);
                    // Refresh snapshot data
                    const fresh = await CategorySnapshotStore.getSnapshotById({ categoryId: cat.id, countryCode: country, languageCode: lang }, snapshot.snapshot_id);
                    if (fresh.ok) snapshot = fresh.data;
                }

                // 3. Validate
                status.stage = 'VALIDATE';
                update();
                // This handles Resume automatically
                const validateRes = await CategoryKeywordGrowthService.validateSnapshot(cat.id, snapshot.snapshot_id, country, lang);
                
                if (!validateRes.ok) {
                    // Check reasons array for rate limit info if available
                    const reasons = validateRes.reasons || [];
                    const isRateLimit = reasons.some(r => r.includes('Rate Limit') || r.includes('429'));
                    
                    if (isRateLimit) {
                        status.stats.paused.push(cat.category);
                    } else {
                        status.stats.failed.push(cat.category);
                    }
                    // Continue to next category even if one pauses/fails
                } else {
                    // 4. Certify
                    status.stage = 'CERTIFY';
                    update();
                    const certRes = await CategorySnapshotBuilder.certify(snapshot.snapshot_id, cat.id, country, lang);
                    if (certRes.ok) {
                        status.stats.success.push(cat.category);
                    } else {
                        status.stats.failed.push(cat.category);
                    }
                }

            } catch (e: any) {
                console.error(`Build failed for ${cat.category}`, e);
                status.stats.failed.push(cat.category);
            }

            status.processed++;
            update();
        }

        status.stage = 'DONE';
        status.currentCategory = '';
        update();
        this.abortController = null;
    }
};
