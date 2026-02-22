
import { doc, getDoc, setDoc, updateDoc, collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { FirestoreClient } from './firestoreClient';
import { CorpusJobControl } from '../types';
import { sanitizeForFirestore } from '../utils/firestoreSanitize';

const COLLECTION = 'corpus_jobs';

/*
 * FIRESTORE INDEX REQUIREMENT
 * ---------------------------
 * This service requires a composite index for the 'corpus_jobs' collection.
 * 
 * Fields:
 * 1. categoryId (Ascending)
 * 2. status (Ascending)
 * 3. startedAt (Descending)
 * 
 * Query Scope: COLLECTION
 */

// Runtime Probe
if (typeof window !== 'undefined') {
    (window as any).__mci_jobs = {
        async readJob(jobId: string) {
            return JobControlService.getJob(jobId);
        },
        async listLatestJobs(limitCount = 5) {
            const db = FirestoreClient.getDbSafe();
            if (!db) return [];
            const q = query(collection(db, COLLECTION), orderBy('startedAt', 'desc'), limit(limitCount));
            const snap = await getDocs(q);
            return snap.docs.map(d => d.data());
        },
        async forceHeartbeat(jobId: string) {
            console.log(`Forcing heartbeat for ${jobId}`);
            // Fix: ensure string format for updatedAt
            await JobControlService.updateProgress(jobId, { updatedAt: new Date().toISOString() });
        }
    };
}

export const JobControlService = {
    
    getJobRef(db: any, jobId: string) {
        return doc(db, COLLECTION, jobId);
    },

    async startJob(
        kind: CorpusJobControl['kind'], 
        categoryId: string, 
        metadata: Partial<CorpusJobControl> = {}
    ): Promise<string> {
        const db = FirestoreClient.getDbSafe();
        if (!db) throw new Error("DB_INIT_FAIL");

        const jobId = `${kind}_${categoryId}_${Date.now()}`;
        const now = new Date().toISOString();

        console.log(`[JOB][RESOLVE] jobId=${jobId} collection=${COLLECTION} categoryId=${categoryId}`);

        const job: CorpusJobControl = {
            jobId,
            categoryId,
            kind,
            type: kind as any, // Cast kind to JobType. Kinds are subset of JobType or compatible string.
            stage_name: 'Demand', // Default stage for corpus jobs
            windowId: 'current',
            status: 'RUNNING',
            // Fixed: Explicitly specified missing 'message' property for CorpusJobControl initialization.
            message: metadata.message || 'Initializing...',
            // Correctly passing string to string field
            startedAt: now,
            updatedAt: now,
            createdAt: now,
            progress: { processed: 0, total: 0 },
            telemetry: { apiCalls: 0, cacheHits: 0, failures: 0, rateLimits: 0, chunkIdx: 0 },
            logs: [],
            activity_log: [],
            currentStage: 'INIT',
            inputsUsed: [],
            outputsExpected: [],
            ...metadata
        };

        await setDoc(this.getJobRef(db, jobId), sanitizeForFirestore(job));
        return jobId;
    },

    /**
     * Starts an interval-based heartbeat for a job.
     * Returns a stop function.
     */
    startHeartbeat(jobId: string, everyMs = 3000): () => void {
        console.log(`[JOBCTRL][HEARTBEAT_START] jobId=${jobId}`);
        let ticks = 0;
        const interval = setInterval(async () => {
            ticks++;
            const db = FirestoreClient.getDbSafe();
            if (!db) return;
            try {
                // Increment chunkIdx in telemetry to show active background movement
                // Use setDoc merge to be safe against missing docs
                await setDoc(this.getJobRef(db, jobId), {
                    updatedAt: new Date().toISOString(),
                    'telemetry.chunkIdx': ticks
                }, { merge: true });
            } catch (e) {
                console.warn(`[JOBCTRL][HEARTBEAT_ERR] ${jobId}`, e);
            }
        }, everyMs);

        return () => {
            console.log(`[JOBCTRL][HEARTBEAT_STOP] jobId=${jobId}`);
            clearInterval(interval);
        };
    },

    async requestStop(jobId: string): Promise<void> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return;
        
        await setDoc(this.getJobRef(db, jobId), {
            stopRequested: true,
            status: 'STOP_REQUESTED',
            updatedAt: new Date().toISOString()
        }, { merge: true });
    },

    async getJob(jobId: string): Promise<CorpusJobControl | null> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return null;
        
        try {
            const snap = await getDoc(this.getJobRef(db, jobId));
            if (snap.exists()) return snap.data() as CorpusJobControl;
            return null;
        } catch (e) {
            console.error("JobControl getJob failed", e);
            return null;
        }
    },

    async getActiveJobForCategory(categoryId: string): Promise<CorpusJobControl | null> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return null;

        try {
            const q = query(
                collection(db, COLLECTION),
                where('categoryId', '==', categoryId),
                where('status', 'in', ['QUEUED', 'RUNNING', 'PAUSED', 'STOP_REQUESTED']),
                orderBy('startedAt', 'desc'),
                limit(1)
            );
            const snap = await getDocs(q);
            if (!snap.empty) return snap.docs[0].data() as CorpusJobControl;
            return null;
        } catch (e: any) {
            if (e.code === 'failed-precondition') {
                console.warn(`[JOBCTRL][INDEX_MISSING] Degraded visibility. Create index: ${e.message}`);
                return null;
            } else {
                console.error("[JOBCTRL][ERROR] getActiveJobForCategory failed", e);
            }
            return null;
        }
    },

    async getLatestJobForCategory(categoryId: string): Promise<CorpusJobControl | null> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return null;

        try {
            const q = query(
                collection(db, COLLECTION),
                where('categoryId', '==', categoryId),
                orderBy('startedAt', 'desc'),
                limit(1)
            );
            const snap = await getDocs(q);
            if (!snap.empty) return snap.docs[0].data() as CorpusJobControl;
            return null;
        } catch (e: any) {
            console.warn(`[JOBCTRL] getLatestJobForCategory failed: ${e.message}`);
            return null;
        }
    },

    async assertNotStopped(jobId: string): Promise<void> {
        const job = await this.getJob(jobId);
        if (job && (job.stopRequested || job.status === 'STOPPED' || job.status === 'FAILED')) {
            if (job.status === 'STOP_REQUESTED') {
                await this.finishJob(jobId, 'STOPPED');
            }
            throw new Error('STOPPED');
        }
    },

    async keepAlive(jobId: string): Promise<void> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return;
        try {
            await setDoc(this.getJobRef(db, jobId), { updatedAt: new Date().toISOString() }, { merge: true });
        } catch (e) {}
    },

    async updateProgress(jobId: string, progress: Partial<CorpusJobControl>): Promise<void> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return;

        const updates = {
            ...progress,
            updatedAt: new Date().toISOString()
        };
        await setDoc(this.getJobRef(db, jobId), sanitizeForFirestore(updates), { merge: true });
    },

    async finishJob(jobId: string, status: CorpusJobControl['status'], error?: string): Promise<void> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return;

        const updates: Partial<CorpusJobControl> = {
            status,
            completedAt: Date.now(), 
            updatedAt: new Date().toISOString()
        };
        if (error) updates.error = error;

        await setDoc(this.getJobRef(db, jobId), sanitizeForFirestore(updates), { merge: true });
    }
};