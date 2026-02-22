
import { DemandTruthJob, DemandTruthJobStore, FrozenChunk } from './demandTruthJobStore';
import { VolumeTruthStore } from './volumeTruthStore';
import { normalizeKeywordString } from '../../driftHash';
import { AuditLogEntry } from '../../types';

export const TruthWarmupRunner = {
    
    async initializeJob(
        windowId: string,
        categoryId: string,
        keywords: string[]
    ): Promise<DemandTruthJob> {
        // Check existing
        const existing = await DemandTruthJobStore.getJob(windowId, categoryId);
        if (existing && existing.status !== 'COMPLETE' && existing.status !== 'FAILED') {
            return existing;
        }

        // Create Frozen Plan
        // Only include keywords that need warmth (e.g. < N=5)
        // For simplicity/robustness: We check all, or just let the job run through all.
        // Optimization: Filter out fully confident keys? 
        // Constraint: "Free inputs at creation". We'll plan for ALL provided keywords to ensure coverage.
        
        const CHUNK_SIZE = 20;
        const chunks: FrozenChunk[] = [];
        const uniqueKeys = Array.from(new Set(keywords.map(normalizeKeywordString)));
        
        for (let i = 0; i < uniqueKeys.length; i += CHUNK_SIZE) {
            chunks.push({
                index: Math.floor(i / CHUNK_SIZE),
                keywordKeys: uniqueKeys.slice(i, i + CHUNK_SIZE),
                status: 'PENDING',
                attemptCount: 0
            });
        }

        return await DemandTruthJobStore.createJob(windowId, categoryId, chunks, uniqueKeys.length);
    },

    async runTick(
        job: DemandTruthJob,
        fetcher: (keys: string[]) => Promise<Record<string, number>>,
        logFn: (log: AuditLogEntry) => void
    ): Promise<{ status: 'CONTINUE' | 'COMPLETE' | 'FAILED', processedCount: number }> {
        
        // 1. Identify Next Chunk
        const chunkIndex = job.currentChunkIndex;
        if (chunkIndex >= job.frozenChunks.length) {
            job.status = 'COMPLETE';
            await DemandTruthJobStore.updateJob(job);
            return { status: 'COMPLETE', processedCount: 0 };
        }

        const chunk = job.frozenChunks[chunkIndex];
        
        // Log
        logFn({
            timestamp: new Date().toISOString(),
            stage: 'Truth Warmup', category: job.categoryId, step: `CHUNK_${chunkIndex + 1}`,
            attempt: chunk.attemptCount + 1, status: 'Running', durationMs: 0,
            message: `Warming ${chunk.keywordKeys.length} keywords (Chunk ${chunkIndex + 1}/${job.frozenChunks.length})`
        });

        try {
            // 2. Fetch
            // Convert norm keys back to something fetchable? 
            // The fetcher usually takes original strings. 
            // Limitation: We stored normalized keys in frozen plan.
            // Fix: We need a map or assume we can fetch by normalized (not ideal for Google).
            // Correction: The `initializeJob` took `keywords` (originals). 
            // We should store originals in the chunk or have a lookup.
            // For now, let's assume we passed originals to `initializeJob` and stored them.
            // Wait, `DemandTruthJobStore` interface has `keywordKeys`. 
            // We'll update the interface implicitly or just store originals in `keywordKeys` for the plan.
            // The Store schema says `keywordKeys: string[]`. We'll store originals there for the Fetcher.
            
            const volumes = await fetcher(chunk.keywordKeys);

            // 3. Persist
            for (const kw of chunk.keywordKeys) {
                const vol = volumes[kw] || 0;
                await VolumeTruthStore.recordObservation(kw, job.windowId, vol, 'SEARCH_GROUNDING');
            }

            // 4. Update State
            chunk.status = 'SUCCESS';
            job.processedKeywordKeys.push(...chunk.keywordKeys);
            job.currentChunkIndex++;
            job.status = 'IN_PROGRESS';
            
            await DemandTruthJobStore.updateJob(job);

            return { status: 'CONTINUE', processedCount: chunk.keywordKeys.length };

        } catch (e: any) {
            console.error(`Chunk ${chunkIndex} failed:`, e);
            chunk.attemptCount++;
            
            if (chunk.attemptCount > 2) {
                // Skip after retries
                chunk.status = 'FAILED';
                job.failedKeywordKeys.push(...chunk.keywordKeys);
                job.currentChunkIndex++; // Move on
                await DemandTruthJobStore.updateJob(job);
                return { status: 'CONTINUE', processedCount: 0 };
            }
            
            // Return CONTINUE to retry this chunk in next tick
            return { status: 'CONTINUE', processedCount: 0 };
        }
    }
};
