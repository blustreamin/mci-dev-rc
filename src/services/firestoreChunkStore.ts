
import { doc, setDoc, getDocs, getDoc, collection, query, orderBy, writeBatch, WriteBatch } from 'firebase/firestore';
import { FirestoreClient } from './firestoreClient';
import { SnapshotKeywordRow } from '../types';
import { sanitizeForFirestore } from '../utils/firestoreSanitize';

async function computeSHA256(text: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export const FirestoreChunkStore = {
    async writeChunks(
        baseRef: any, // DocumentReference
        rows: SnapshotKeywordRow[],
        chunkSize: number = 400
    ): Promise<{ ok: true; chunkCount: number; chunkHashes: string[] } | { ok: false; error: string }> {
        const result = await FirestoreClient.safe(async () => {
            const db = FirestoreClient.getDbSafe();
            if (!db) throw new Error("DB_INIT_FAIL");

            const chunkHashes: string[] = [];
            const chunkColl = collection(baseRef, 'chunks');
            
            const chunkCount = Math.ceil(rows.length / chunkSize);
            const batches: WriteBatch[] = [];
            let currentBatch = writeBatch(db);
            let opCount = 0;
            const BATCH_LIMIT = 450; // Safety buffer under 500

            for (let i = 0; i < rows.length; i += chunkSize) {
                const chunkRows = rows.slice(i, i + chunkSize);
                const chunkIndex = Math.floor(i / chunkSize);
                const chunkId = `chunk_${chunkIndex.toString().padStart(4, '0')}`;
                
                const sanitizedRows = sanitizeForFirestore(chunkRows);
                
                const payloadStr = JSON.stringify(sanitizedRows);
                const sha256 = await computeSHA256(payloadStr);
                
                chunkHashes.push(sha256);

                const docRef = doc(chunkColl, chunkId);
                const data = {
                    index: chunkIndex,
                    row_count: chunkRows.length,
                    rows: sanitizedRows,
                    sha256: sha256,
                    created_at_iso: FirestoreClient.nowIso()
                };
                
                currentBatch.set(docRef, data);
                opCount++;

                if (opCount >= BATCH_LIMIT) {
                    batches.push(currentBatch);
                    currentBatch = writeBatch(db);
                    opCount = 0;
                }
            }

            if (opCount > 0) {
                batches.push(currentBatch);
            }

            // Execute batches sequentially to avoid flooding the client
            for (const batch of batches) {
                await batch.commit();
            }

            return { chunkCount, chunkHashes };
        });

        if (result.ok && result.data) {
            return { ok: true, ...result.data };
        } else {
            const error = !result.ok ? (result as any).error : "Unknown error";
            console.error("Chunk Write Error:", error);
            return { ok: false, error };
        }
    },

    // Legacy full read
    async readChunks(baseRef: any): Promise<{ ok: true; rows: SnapshotKeywordRow[]; chunkCount: number } | { ok: false; error: string }> {
        const result = await FirestoreClient.safe(async () => {
            const chunkColl = collection(baseRef, 'chunks');
            const q = query(chunkColl, orderBy('index'));
            const snap = await getDocs(q);
            
            if (snap.empty) return { rows: [], chunkCount: 0 };

            let allRows: SnapshotKeywordRow[] = [];
            snap.forEach(d => {
                const data = d.data();
                if (data.rows && Array.isArray(data.rows)) {
                    allRows = allRows.concat(data.rows);
                }
            });

            return { rows: allRows, chunkCount: snap.size };
        });

        if (result.ok && result.data) {
            return { ok: true, ...result.data };
        } else {
            const error = !result.ok ? (result as any).error : "Unknown error";
            return { ok: false, error };
        }
    },

    // New granular methods
    async getChunkIds(baseRef: any): Promise<string[]> {
        const chunkColl = collection(baseRef, 'chunks');
        const q = query(chunkColl, orderBy('index'));
        const snap = await getDocs(q);
        return snap.docs.map(d => d.id);
    },

    async readChunk(baseRef: any, chunkId: string): Promise<{ rows: SnapshotKeywordRow[], sha256: string } | null> {
        const chunkRef = doc(baseRef, 'chunks', chunkId);
        const snap = await getDoc(chunkRef);
        if (!snap.exists()) return null;
        const data = snap.data();
        return {
            rows: data.rows || [],
            sha256: data.sha256
        };
    },

    async writeSingleChunk(baseRef: any, chunkId: string, rows: SnapshotKeywordRow[], index: number): Promise<void> {
        const sanitizedRows = sanitizeForFirestore(rows);
        const payloadStr = JSON.stringify(sanitizedRows);
        const sha256 = await computeSHA256(payloadStr);
        
        const docRef = doc(baseRef, 'chunks', chunkId);
        const data = {
            index: index,
            row_count: rows.length,
            rows: sanitizedRows,
            sha256: sha256,
            created_at_iso: FirestoreClient.nowIso()
        };
        await setDoc(docRef, data);
    }
};
