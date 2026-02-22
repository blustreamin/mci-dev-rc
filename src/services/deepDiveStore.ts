
import { doc, setDoc, getDoc, collection, query, where, orderBy, limit, getDocs, writeBatch } from 'firebase/firestore';
import { FirestoreClient } from './firestoreClient';
import { DeepDiveResultV2, VALID_DEEP_DIVE_SCHEMAS } from '../types';

const RUNS_COLLECTION = 'deepDive_runs';
const POINTER_COLLECTION = 'deepDive_latest';

export const DeepDiveStore = {
    
    getPointerId(categoryId: string, monthKey: string): string {
        // Ensure canonical slug is used, not display name
        return `${categoryId}_${monthKey}`;
    },

    async saveResult(result: DeepDiveResultV2, runId: string): Promise<void> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return;

        const timestamp = new Date().toISOString();
        const categoryId = result.categoryId;
        const monthKey = result.monthKey;
        
        // 1. Write Result Document
        // ID: deepDiveV2_{categoryId}_{month}_{runId} (Deterministic)
        const docId = `deepDiveV2_${categoryId}_${monthKey}_${runId}`;
        const runRef = doc(db, RUNS_COLLECTION, docId);
        
        await setDoc(runRef, FirestoreClient.sanitize(result));

        // 2. Write/Update Pointer Document
        // ID: {categoryId}_{month}
        const pointerId = this.getPointerId(categoryId, monthKey);
        const pointerRef = doc(db, POINTER_COLLECTION, pointerId);
        
        // Upsert with provenance fields for quick diagnostics
        // Include isLegacy flag based on schemaVersion constants
        const isLegacy = !VALID_DEEP_DIVE_SCHEMAS.includes(result.schemaVersion || '');

        await setDoc(pointerRef, {
            runId,
            resultDocId: docId,
            categoryId,
            monthKey,
            updatedAt: timestamp,
            created_at_iso: timestamp,
            updated_at_iso: timestamp,
            status: 'SUCCESS',
            demandSnapshotId: result.provenance?.demandSnapshotId || null,
            signalSnapshotId: result.provenance?.signalsSnapshotId || null,
            signalMode: result.provenance?.signalMode || null,
            confidence: result.provenance?.dataConfidence || null,
            schemaVersion: result.schemaVersion || "legacy",
            isLegacy,
            // Ensure we clear deletion markers if reviving
            deletedAt: null,
            deletedBy: null
        }, { merge: true });

        console.log(`[DEEPDIVE][STORE] Saved result ${docId} and pointer ${pointerId} (Version: ${result.schemaVersion})`);
    },

    async getLatestResult(categoryId: string, monthKey: string): Promise<DeepDiveResultV2 | null> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return null;

        try {
            // 1. Read Pointer
            const pointerId = this.getPointerId(categoryId, monthKey);
            const pointerSnap = await getDoc(doc(db, POINTER_COLLECTION, pointerId));
            
            if (!pointerSnap.exists()) {
                console.log(`[DEEPDIVE][STORE] No pointer found for ${pointerId}`);
                return null;
            }
            
            const pointer = pointerSnap.data();
            
            // Soft delete check
            if (pointer.deletedAt) {
                console.log(`[DEEPDIVE][STORE] Pointer ${pointerId} is marked deleted.`);
                return null;
            }

            const resultDocId = pointer.resultDocId;
            
            if (!resultDocId) return null;

            // 2. Read Result
            const resultSnap = await getDoc(doc(db, RUNS_COLLECTION, resultDocId));
            if (resultSnap.exists()) {
                return resultSnap.data() as DeepDiveResultV2;
            }
            
            return null;
        } catch (e) {
            console.error("[DEEPDIVE][STORE] Read failed", e);
            return null;
        }
    },

    /**
     * Fallback method to find latest run directly if pointer is missing/corrupt.
     */
    async findLatestRunDirectly(categoryId: string, monthKey: string): Promise<DeepDiveResultV2 | null> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return null;

        try {
            const q = query(
                collection(db, RUNS_COLLECTION),
                where('categoryId', '==', categoryId),
                where('monthKey', '==', monthKey),
                orderBy('generatedAt', 'desc'),
                limit(1)
            );
            
            const snap = await getDocs(q);
            if (!snap.empty) {
                console.log(`[DEEPDIVE][STORE] Direct query found run for ${categoryId}/${monthKey}`);
                return snap.docs[0].data() as DeepDiveResultV2;
            }
            return null;
        } catch (e) {
            console.warn("[DEEPDIVE][STORE] Direct query failed (likely missing index)", e);
            return null;
        }
    },

    /**
     * Soft delete all items in the library by marking pointers as deleted.
     */
    async softDeleteAll(): Promise<void> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return;

        try {
            const colRef = collection(db, POINTER_COLLECTION);
            const snapshot = await getDocs(colRef);
            
            const batch = writeBatch(db);
            const now = new Date().toISOString();
            let count = 0;

            snapshot.docs.forEach(docSnap => {
                const data = docSnap.data();
                if (!data.deletedAt) {
                    batch.update(docSnap.ref, {
                        deletedAt: now,
                        deletedBy: 'system'
                    });
                    count++;
                }
            });

            if (count > 0) {
                await batch.commit();
                console.log(`[DEEPDIVE][STORE] Soft deleted ${count} library pointers.`);
            }
        } catch (e) {
            console.error("Soft delete failed", e);
            throw e;
        }
    }
};
