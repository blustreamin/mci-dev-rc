
import { StorageAdapter } from './storageAdapter';

export interface StepCheckpoint {
    jobId: string;
    stepName: string;
    chunkCursor: number;
    totalChunks: number;
    frozenChunks: string[][]; // Array of keyword arrays
    updatedAt: string;
}

const CHECKPOINT_PREFIX = 'job_ckpt::';

export const JobCheckpointStore = {
    getKey(jobId: string, stepName: string): string {
        return `${CHECKPOINT_PREFIX}${jobId}::${stepName}`;
    },

    async getCheckpoint(jobId: string, stepName: string): Promise<StepCheckpoint | null> {
        return await StorageAdapter.get<StepCheckpoint>(this.getKey(jobId, stepName));
    },

    async saveCheckpoint(ckpt: StepCheckpoint): Promise<void> {
        ckpt.updatedAt = new Date().toISOString();
        await StorageAdapter.set(this.getKey(ckpt.jobId, ckpt.stepName), ckpt);
    },

    async clearCheckpoint(jobId: string, stepName: string): Promise<void> {
        await StorageAdapter.remove(this.getKey(jobId, stepName));
    }
};
