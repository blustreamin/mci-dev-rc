
import { StorageAdapter } from './storageAdapter';
import { PreSweepData } from '../../types';

export interface AnchorResult {
    anchor: string;
    subCategory: string;
    consumer_problems: string[];
    evidence: string[];
    keywords: { term: string; intent: string; rationale?: string }[];
}

export interface StrategyCheckpoint {
    categoryId: string;
    status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETE' | 'FAILED';
    completedAnchors: string[]; // Anchor names that are done
    results: AnchorResult[]; // Stored results for those anchors
    startedAt: string;
    lastUpdatedAt: string;
    totalAnchors: number;
}

const CHECKPOINT_PREFIX = 'presweep_ckpt::';

export const StrategyCheckpointStore = {
    getKey(categoryId: string): string {
        return `${CHECKPOINT_PREFIX}${categoryId}`;
    },

    async getCheckpoint(categoryId: string): Promise<StrategyCheckpoint | null> {
        return await StorageAdapter.get<StrategyCheckpoint>(this.getKey(categoryId));
    },

    async initCheckpoint(categoryId: string, allAnchors: string[]): Promise<StrategyCheckpoint> {
        const existing = await this.getCheckpoint(categoryId);
        if (existing && existing.status !== 'COMPLETE' && existing.status !== 'FAILED') {
            return existing; // Resume
        }

        const checkpoint: StrategyCheckpoint = {
            categoryId,
            status: 'IN_PROGRESS',
            completedAnchors: [],
            results: [],
            startedAt: new Date().toISOString(),
            lastUpdatedAt: new Date().toISOString(),
            totalAnchors: allAnchors.length
        };
        await StorageAdapter.set(this.getKey(categoryId), checkpoint);
        return checkpoint;
    },

    async saveAnchorResult(categoryId: string, result: AnchorResult): Promise<void> {
        const ckpt = await this.getCheckpoint(categoryId);
        if (!ckpt) throw new Error(`No checkpoint found for ${categoryId}`);

        // Idempotency check
        if (!ckpt.completedAnchors.includes(result.anchor)) {
            ckpt.completedAnchors.push(result.anchor);
            ckpt.results.push(result);
            ckpt.lastUpdatedAt = new Date().toISOString();
            await StorageAdapter.set(this.getKey(categoryId), ckpt);
        }
    },

    async clearCheckpoint(categoryId: string): Promise<void> {
        await StorageAdapter.remove(this.getKey(categoryId));
    }
};
