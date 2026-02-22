
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { FirestoreClient } from './firestoreClient';
import { ValidationJobState } from '../types';
import { sanitizeForFirestore } from '../utils/firestoreSanitize';

const COLLECTION = 'validation_jobs';

export const ValidationJobStore = {
    
    getJobKey(categoryId: string, country: string, lang: string): string {
        return `${categoryId}_${country}_${lang}`;
    },

    async getJob(categoryId: string, country: string, lang: string): Promise<ValidationJobState | null> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return null;
        try {
            const key = this.getJobKey(categoryId, country, lang);
            const snap = await getDoc(doc(db, COLLECTION, key));
            if (snap.exists()) return snap.data() as ValidationJobState;
            return null;
        } catch (e) {
            console.error("ValidationJob get failed", e);
            return null;
        }
    },

    async startOrResumeJob(
        categoryId: string, 
        country: string, 
        lang: string, 
        snapshotId: string, 
        totalRows: number
    ): Promise<ValidationJobState> {
        const db = FirestoreClient.getDbSafe();
        if (!db) throw new Error("DB_INIT_FAIL");

        const id = this.getJobKey(categoryId, country, lang);
        const existing = await this.getJob(categoryId, country, lang);
        
        // Resume if existing job matches snapshot and is capable of resuming
        if (existing && existing.snapshotId === snapshotId) {
            if (existing.status === 'RUNNING' || existing.status === 'PAUSED' || existing.status === 'FAILED') {
                // If it was failed or paused, we implicitly resume it by setting to RUNNING
                if (existing.status !== 'RUNNING') {
                    await this.patchJob(id, { 
                        status: 'RUNNING', 
                        'timings.updatedAt': Date.now() 
                    });
                    existing.status = 'RUNNING';
                }
                return existing;
            }
            if (existing.status === 'COMPLETE') {
                return existing;
            }
        }

        // Create New Job
        const now = Date.now();
        const job: ValidationJobState = {
            id,
            categoryId,
            countryCode: country,
            languageCode: lang,
            snapshotId,
            status: 'RUNNING',
            cursor: { chunkIdx: 0, rowIdx: 0 },
            totals: { totalRows, rowsNeedingValidation: 0 }, // Will be updated as we scan
            counters: { 
                processed: 0, 
                success: 0, 
                skipped: 0, 
                rateLimited: 0, 
                failures: 0, 
                apiCalls: 0, 
                cacheHits: 0 
            },
            timings: { 
                startedAt: now, 
                updatedAt: now, 
                lastProgressAt: now 
            },
            config: { 
                batchSize: 50, 
                concurrency: 3, 
                maxRetries: 3, 
                baseBackoffMs: 1000, 
                maxBackoffMs: 10000 
            }
        };

        await setDoc(doc(db, COLLECTION, id), sanitizeForFirestore(job));
        return job;
    },

    async patchJob(jobId: string, updates: Partial<ValidationJobState> | Record<string, any>): Promise<void> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return;
        
        // Ensure timestamp update
        const finalUpdates = {
            ...updates,
            'timings.updatedAt': Date.now()
        };

        await updateDoc(doc(db, COLLECTION, jobId), sanitizeForFirestore(finalUpdates));
    },

    async markPaused(jobId: string, error?: string): Promise<void> {
        const updates: any = {
            status: 'PAUSED',
            'timings.updatedAt': Date.now()
        };
        if (error) {
            updates.lastError = { code: 'PAUSED', message: error };
        }
        await this.patchJob(jobId, updates);
    },

    async markFailed(jobId: string, error: string): Promise<void> {
        await this.patchJob(jobId, {
            status: 'FAILED',
            lastError: { code: 'ERROR', message: error },
            'timings.updatedAt': Date.now()
        });
    },

    async markComplete(jobId: string): Promise<void> {
        await this.patchJob(jobId, {
            status: 'COMPLETE',
            'timings.updatedAt': Date.now(),
            'timings.completedAt': Date.now()
        });
    }
};
