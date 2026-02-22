
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { FirestoreClient } from './firestoreClient';
import { DeepDiveStore } from './deepDiveStore';

export interface DeepDiveReportSummary {
    id: string; // Pointer ID
    categoryId: string;
    monthKey: string;
    generatedAt: string;
    runId: string;
    confidence: string;
    signalMode: string;
    demandSnapshotId: string | null;
    status: string;
    schemaVersion?: string;
}

export const DeepDiveLibraryService = {
    async listDeepDiveReports(limitCount = 50): Promise<DeepDiveReportSummary[]> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return [];

        try {
            // Read from pointers collection which is much smaller and cleaner
            const colRef = collection(db, 'deepDive_latest');
            const q = query(colRef, orderBy('updatedAt', 'desc'), limit(limitCount));
            
            const snapshot = await getDocs(q);
            
            return snapshot.docs
                .map(doc => {
                    const data = doc.data();
                    // Soft Delete Filter
                    if (data.deletedAt) return null;

                    return {
                        id: doc.id,
                        categoryId: data.categoryId,
                        monthKey: data.monthKey,
                        generatedAt: data.updatedAt || data.created_at_iso,
                        runId: data.runId,
                        confidence: data.confidence || 'UNKNOWN',
                        signalMode: data.signalMode || 'UNKNOWN',
                        demandSnapshotId: data.demandSnapshotId || null,
                        status: data.status || 'SUCCESS',
                        schemaVersion: data.schemaVersion || "legacy"
                    };
                })
                .filter((item): item is DeepDiveReportSummary => item !== null);

        } catch (e) {
            console.error("[DeepDiveLibrary] Failed to list reports", e);
            return [];
        }
    },

    async clearLibrary(): Promise<void> {
        await DeepDiveStore.softDeleteAll();
    }
};
