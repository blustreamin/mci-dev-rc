
import { StorageAdapter } from './storageAdapter';

export interface FrozenChunk {
    index: number;
    keywordKeys: string[]; // Normalized keys
    status: 'PENDING' | 'SUCCESS' | 'FAILED';
    attemptCount: number;
}

export interface DemandTruthJob {
    id: string; // windowId::categoryId
    windowId: string;
    categoryId: string;
    status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETE' | 'FAILED';
    
    // Frozen Execution Plan
    totalKeywords: number;
    frozenChunks: FrozenChunk[];
    currentChunkIndex: number;
    
    // Progress Tracking
    processedKeywordKeys: string[];
    failedKeywordKeys: string[];
    
    startedAt: string;
    lastUpdatedAt: string;
}

const JOB_PREFIX = 'demand_truth_job::';

export const DemandTruthJobStore = {
    getJobKey(windowId: string, categoryId: string): string {
        return `${JOB_PREFIX}${windowId}::${categoryId}`;
    },

    async getJob(windowId: string, categoryId: string): Promise<DemandTruthJob | null> {
        return await StorageAdapter.get<DemandTruthJob>(this.getJobKey(windowId, categoryId));
    },

    async createJob(windowId: string, categoryId: string, chunks: FrozenChunk[], totalKw: number): Promise<DemandTruthJob> {
        const job: DemandTruthJob = {
            id: this.getJobKey(windowId, categoryId),
            windowId,
            categoryId,
            status: 'PENDING',
            totalKeywords: totalKw,
            frozenChunks: chunks,
            currentChunkIndex: 0,
            processedKeywordKeys: [],
            failedKeywordKeys: [],
            startedAt: new Date().toISOString(),
            lastUpdatedAt: new Date().toISOString(),
        };
        await StorageAdapter.set(job.id, job);
        return job;
    },

    async updateJob(job: DemandTruthJob): Promise<void> {
        job.lastUpdatedAt = new Date().toISOString();
        await StorageAdapter.set(job.id, job);
    },

    async clearJob(windowId: string, categoryId: string): Promise<void> {
        await StorageAdapter.remove(this.getJobKey(windowId, categoryId));
    }
};
