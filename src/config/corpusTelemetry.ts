
import { collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { FirestoreClient } from '../services/firestoreClient';
import { CorpusJobControl } from '../types';

export const CORPUS_JOBS_COLLECTION = 'corpus_jobs';

export type HydrationTelemetry = {
    activeCount: number;
    done24hCount: number;
    latestJob: CorpusJobControl | null;
    recentJobs: CorpusJobControl[];
    error?: string;
};

export const CorpusTelemetryService = {
    async fetchHydrationStats(): Promise<HydrationTelemetry> {
        const db = FirestoreClient.getDbSafe();
        if (!db) {
            return { activeCount: 0, done24hCount: 0, latestJob: null, recentJobs: [], error: 'DB_INIT_FAIL' };
        }

        const colRef = collection(db, CORPUS_JOBS_COLLECTION);
        const result: HydrationTelemetry = {
            activeCount: 0,
            done24hCount: 0,
            latestJob: null,
            recentJobs: []
        };

        try {
            // 1. Get Recent Jobs (Serves as source for "Done" and "Latest")
            // Requires Index: kind ASC, startedAt DESC
            const qRecent = query(
                colRef,
                where('kind', '==', 'HYDRATE'),
                orderBy('startedAt', 'desc'),
                limit(25)
            );
            const recentSnap = await getDocs(qRecent);
            const jobs = recentSnap.docs.map(d => d.data() as CorpusJobControl);
            
            result.recentJobs = jobs;
            result.latestJob = jobs.length > 0 ? jobs[0] : null;
            
            const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
            result.done24hCount = jobs.filter(j => 
                (j.status === 'COMPLETE' || j.status === 'FAILED' || j.status === 'STOPPED') && 
                j.updatedAt > oneDayAgo
            ).length;

            // 2. Active Count (More precise query)
            // Requires Index: kind ASC, status ASC
            const qActive = query(
                colRef, 
                where('kind', '==', 'HYDRATE'),
                where('status', 'in', ['RUNNING', 'QUEUED', 'PAUSED'])
            );
            const activeSnap = await getDocs(qActive);
            result.activeCount = activeSnap.size;

        } catch (e: any) {
            console.warn("[CorpusTelemetry] Query failed", e);
            if (e.message && e.message.includes("requires an index")) {
                // Parse index link if available
                const link = e.message.match(/https:\/\/console\.firebase\.google\.com[^\s]*/)?.[0];
                result.error = link ? "MISSING_INDEX" : "MISSING_INDEX";
                console.error("CREATE INDEX:", link || e.message);
            } else {
                result.error = e.message;
            }
        }

        return result;
    }
};
