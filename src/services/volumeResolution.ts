
import { VolumeTruthStore } from './volumeTruthStore';
import { SeedStore } from './seedStore';
import { AUDIT_DATASET_V2 } from './backtestTruthInjector';
import { normalizeKeywordString } from '../../driftHash';

// Types for resolution result
export interface ResolvedVolume {
    volume: number;
    source: 'TRUTH_HIGH' | 'TRUTH_LOW' | 'OBSERVATION' | 'FRESH_FETCH' | 'MANGOOLS_SNAPSHOT' | 'AUDIT_FALLBACK';
    confidence: 'HIGH' | 'LOW';
    isFresh: boolean;
}

export type VolumeFetcher = (keywords: string[]) => Promise<Record<string, number>>;

export const VolumeResolution = {
    
    // Helper: Determine effective window ID
    async resolveEffectiveWindow(categoryId: string, requestedWindowId: string): Promise<string> {
        // v2 Behavior: Prefer Seed, else fallback to Request
        const meta = await SeedStore.getSeedMeta(categoryId, requestedWindowId);
        if (meta && meta.truthWindowId) {
            return meta.truthWindowId;
        }
        return requestedWindowId;
    },

    /**
     * Phase 1: Identify which keywords actually need fetching.
     */
    async planMissing(keywords: string[], windowId: string, categoryId?: string): Promise<string[]> {
        const effectiveWindow = categoryId ? await this.resolveEffectiveWindow(categoryId, windowId) : windowId;
        
        const missing: string[] = [];
        for (const kw of keywords) {
            const truth = await VolumeTruthStore.getTruthVolume(kw, effectiveWindow);
            if (truth) continue; 
            missing.push(kw);
        }
        return missing;
    },

    /**
     * Phase 2: Execute chunk.
     */
    async executeChunk(
        chunkKeywords: string[], 
        windowId: string, 
        fetcher: VolumeFetcher
    ): Promise<void> {
        if (chunkKeywords.length === 0) return;
        try {
            const fetched = await fetcher(chunkKeywords);
            for (const kw of chunkKeywords) {
                const vol = fetched[kw] || 0;
                await VolumeTruthStore.recordObservation(kw, windowId, vol, 'SEARCH_GROUNDING');
            }
        } catch (e) {
            console.error("Chunk fetch failed", e);
            throw e;
        }
    },

    /**
     * Phase 3: Gather final resolved map.
     * RESTORED V2 LOGIC: Fallback to Audit Dataset if Truth Store is empty.
     */
    async getFinalResults(
        keywords: string[], 
        windowId: string,
        categoryId?: string
    ): Promise<Map<string, ResolvedVolume>> {
        
        const effectiveWindow = categoryId ? await this.resolveEffectiveWindow(categoryId, windowId) : windowId;
        const resultMap = new Map<string, ResolvedVolume>();

        // Pre-compute fallback map from Audit Dataset for speed
        const auditMap = new Map<string, number>();
        AUDIT_DATASET_V2.forEach(item => {
            auditMap.set(normalizeKeywordString(item.k), item.v);
        });

        for (const kw of keywords) {
            const normKw = normalizeKeywordString(kw);
            const truth = await VolumeTruthStore.getTruthVolume(kw, effectiveWindow);
            
            if (truth) {
                let source: ResolvedVolume['source'] = 'TRUTH_HIGH';
                if (truth.estimator === 'MANGOOLS_LOCKED') source = 'MANGOOLS_SNAPSHOT';
                else if (truth.estimator === 'SINGLE') source = 'TRUTH_LOW';

                resultMap.set(kw, {
                    volume: truth.truthVolume,
                    source,
                    confidence: truth.estimator === 'SINGLE' ? 'LOW' : 'HIGH',
                    isFresh: false
                });
            } else {
                // FALLBACK: Check Audit Dataset (Stable v2 behavior for Demo/Backtest)
                const auditVol = auditMap.get(normKw);
                
                if (auditVol !== undefined) {
                    resultMap.set(kw, {
                        volume: auditVol,
                        source: 'AUDIT_FALLBACK',
                        confidence: 'HIGH',
                        isFresh: false
                    });
                } else {
                    resultMap.set(kw, {
                        volume: 0,
                        source: 'FRESH_FETCH',
                        confidence: 'LOW',
                        isFresh: true
                    });
                }
            }
        }
        return resultMap;
    }
};
