
import { 
    collection, 
    collectionGroup, 
    query, 
    orderBy, 
    limit, 
    getDocs, 
    writeBatch, 
    doc, 
    setDoc
} from 'firebase/firestore';
import { FirestoreClient } from './firestoreClient';
import { RuntimeCache } from './runtimeCache';

const BATCH_SIZE = 200; // Safe limit well under 450 to prevent "Transaction too big"
const WARNING_THRESHOLD = 500000;

export const CorpusResetService = {
    
    async flushAll(
        confirmationToken: string, 
        onProgress: (msg: string) => void,
        excludeJobId?: string
    ): Promise<boolean> {
        const db = FirestoreClient.getDbSafe();
        if (!db) {
            onProgress('[FLUSH] ERROR DB_INIT_FAIL');
            return false;
        }

        // @ts-ignore
        const config = db.app.options;
        const projectId = config.projectId;
        const flushId = `flush_${Date.now()}`;

        if (projectId !== 'dev-mens-care-india' && confirmationToken !== `FLUSH ${projectId}`) {
            const msg = `[FLUSH] ERROR Safety Guard: Project ${projectId} not allowed.`;
            onProgress(msg);
            throw new Error(`SAFETY_LOCK: Project ID mismatch or invalid token. Required: 'FLUSH ${projectId}'`);
        }

        onProgress(`[FLUSH] START flushId=${flushId} projectId=${projectId}`);

        try {
            let totalDeleted = 0;

            // 1. Deep Structures First (High Cardinality)
            // Using collectionGroup to find all nested docs regardless of path depth
            // 'chunks' is the critical one that was failing due to size
            const deepGroups = ['chunks', 'snapshots'];
            for (const name of deepGroups) {
                const count = await this.deleteByCollectionGroup(db, name, onProgress);
                totalDeleted += count;
            }

            // 2. Root Collections
            const rootCollections = [
                'mci_category_snapshots',
                'cbv3_snapshots',
                'corpus_index',
                'keyword_volume_cache',
                'corpus_jobs',
                'batch_certification_jobs',
                'batch_verification_jobs',
                'deep_dive_inputs_v1',
                'mci_outputs',
                'mci_deepdive',
                'corpus_probe'
            ];

            for (const name of rootCollections) {
                // If excluding a job ID, we need to handle corpus_jobs carefully
                const isJobsCol = name === 'corpus_jobs';
                const count = await this.deleteCollectionInBatches(db, name, onProgress, isJobsCol ? excludeJobId : undefined);
                totalDeleted += count;
            }

            // 3. Local Cleanup
            localStorage.clear();
            RuntimeCache.resetAll("FLUSH_OP");

            // 4. Audit Log
            const auditRef = doc(db, 'corpus_probe', `flush_${flushId}`);
            await setDoc(auditRef, {
                type: 'FULL_FLUSH',
                flushId,
                projectId,
                timestamp: new Date().toISOString(),
                operator: 'ADMIN_CONSOLE',
                totalDeleted,
                status: 'COMPLETE'
            });

            onProgress(`[FLUSH] DONE totalDeleted=${totalDeleted}`);
            return true;

        } catch (e: any) {
            console.error(e);
            onProgress(`[FLUSH] ERROR name=global msg=${e.message}`);
            return false;
        }
    },

    /**
     * Deletes all documents in a Collection Group using batches.
     * Robust against deep nesting.
     */
    async deleteByCollectionGroup(db: any, groupName: string, onProgress: (msg: string) => void): Promise<number> {
        let total = 0;
        onProgress(`[FLUSH] GROUP_START name=${groupName}`);

        while (true) {
            // Get next batch of IDs
            const q = query(collectionGroup(db, groupName), orderBy('__name__'), limit(BATCH_SIZE));
            const snapshot = await getDocs(q);
            if (snapshot.empty) break;

            await this.commitBatchSafe(db, snapshot.docs, `GROUP:${groupName}`, onProgress);
            
            total += snapshot.size;
            onProgress(`[FLUSH] BATCH group=${groupName} deletedThisBatch=${snapshot.size} totalDeleted=${total}`);
            
            if (total > WARNING_THRESHOLD && total % 10000 === 0) {
                onProgress(`[FLUSH] WARN Huge deletion detected: ${total} docs in ${groupName}`);
            }

            // Yield to allow UI updates
            await new Promise(r => setTimeout(r, 50));
        }
        
        onProgress(`[FLUSH] GROUP_DONE name=${groupName} totalDeleted=${total}`);
        return total;
    },

    /**
     * Deletes all documents in a top-level Collection using batches.
     * Supports optional exclusion ID for job preservation.
     */
    async deleteCollectionInBatches(
        db: any, 
        colName: string, 
        onProgress: (msg: string) => void,
        excludeId?: string
    ): Promise<number> {
        let total = 0;
        onProgress(`[FLUSH] COLLECTION_START name=${colName}${excludeId ? ` (keeping ${excludeId})` : ''}`);
        
        const ref = collection(db, colName);
        while (true) {
            const q = query(ref, orderBy('__name__'), limit(BATCH_SIZE));
            const snapshot = await getDocs(q);
            if (snapshot.empty) break;

            // Filter out the excluded ID if present in this batch
            let docsToDelete = snapshot.docs;
            if (excludeId) {
                docsToDelete = snapshot.docs.filter(d => d.id !== excludeId);
            }

            if (docsToDelete.length > 0) {
                await this.commitBatchSafe(db, docsToDelete, `COL:${colName}`, onProgress);
                total += docsToDelete.length;
                onProgress(`[FLUSH] BATCH col=${colName} deletedThisBatch=${docsToDelete.length} totalDeleted=${total}`);
            }

            // If we filtered out the only doc in the batch, we might loop infinitely if we don't handle pagination correctly.
            // However, orderBy __name__ usually pages through all. The excluded doc will keep coming up as first.
            // Fix: If we see the excluded ID, we must ensure we advance past it or don't re-query it.
            // Simple fix: If we are stuck on the excluded doc (snapshot not empty, but filtered list is empty or small), we are done with this collection essentially (assuming unique ID).
            // Actually, if we skip deleting it, it remains. The next query will find it again.
            // Since `excludeId` is unique, this happens at most once.
            // If the excluded ID is the ONLY thing left, snapshot.size will be 1 and docsToDelete.length 0.
            // We can check snapshot.size vs docsToDelete.length. If diff > 0, we found it.
            // If we found it, and snapshot size was small (end of list), we break.
            // If snapshot size was full batch, we might be in middle.
            // But standard pagination relies on deletion. If we don't delete, we see it again.
            // Workaround: We can't easily skip it without cursor pagination.
            // Given BATCH_SIZE is 200, hitting the exact ID is inevitable.
            // Alternative: Delete by ID list query? No, we want to delete ALL.
            // Correct approach: if we encounter excludeId, we skip it but we rely on the fact that we can't advance past it without complex cursors.
            // For now, simpler approach: The loop breaks when empty. If we have 1 doc left and it is excludeId, we break.
            
            if (snapshot.size < BATCH_SIZE && docsToDelete.length === 0) {
                 // We found only the excluded doc and we are at the end.
                 break;
            }
            
            if (docsToDelete.length === 0 && snapshot.size > 0) {
                 // We found the excluded doc but there might be more if we had a cursor.
                 // Since we don't use cursor but rely on 'delete to advance', this is a problem.
                 // Hack: If we hit this case, we just break. 
                 // It means the excluded doc is the 'first' in the index currently.
                 // We rely on random distribution or order.
                 // Ideally we should use startAfter, but that requires keeping track.
                 // For now, let's assume if we see it, we are nearly done or we risk infinite loop.
                 // Safety break.
                 onProgress(`[FLUSH] INFO Preserving active job ${excludeId}, ending batch loop for ${colName}.`);
                 break;
            }

            await new Promise(r => setTimeout(r, 50));
        }

        onProgress(`[FLUSH] COLLECTION_DONE name=${colName} totalDeleted=${total}`);
        return total;
    },

    /**
     * Safe batch committer.
     * If the batch fails (e.g. too big or contention), it falls back to serial deletion.
     */
    async commitBatchSafe(db: any, docs: any[], context: string, onProgress: (msg: string) => void): Promise<void> {
        if (docs.length === 0) return;

        const batch = writeBatch(db);
        docs.forEach(d => batch.delete(d.ref));

        try {
            await batch.commit();
        } catch (e: any) {
            onProgress(`[FLUSH] WARN Batch commit failed (${e.message}). Switching to serial delete for ${docs.length} items in ${context}.`);
            // Fallback: Delete one by one
            for (const d of docs) {
                try {
                    const singleBatch = writeBatch(db);
                    singleBatch.delete(d.ref);
                    await singleBatch.commit();
                } catch (innerE: any) {
                    onProgress(`[FLUSH] ERROR failed to delete ${d.id}: ${innerE.message}`);
                }
            }
        }
    }
};
