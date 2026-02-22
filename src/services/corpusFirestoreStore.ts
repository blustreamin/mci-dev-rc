
import { doc, setDoc, getDoc, collection, writeBatch, getDocs, query, orderBy } from 'firebase/firestore';
import { RemoteBenchmarkStore } from './remoteBenchmarkStore';
import { CorpusStore, CorpusRow } from './corpusStore';
import { CorpusHydrationStore } from './corpusHydrationStore';

const COLLECTION_ROOT = 'mci_corpus_v1';
const DOC_MANIFEST = 'manifest';
const SUBCOL_CHUNKS = 'chunks';
const CHUNK_SIZE = 400;

async function computeSHA256(text: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export const CorpusFirestoreStore = {

    async pushCorpusToFirestore(): Promise<{ ok: boolean; total: number; chunks: number; sha256: string; ms: number; error?: string }> {
        const start = Date.now();
        try {
            const db = RemoteBenchmarkStore.getDb();
            if (!db) return { ok: false, total: 0, chunks: 0, sha256: '', ms: 0, error: 'DB_INIT_FAIL' };

            // 1. Get Data
            const jsonl = CorpusStore.getRawJsonl();
            if (!jsonl) return { ok: false, total: 0, chunks: 0, sha256: '', ms: 0, error: 'LOCAL_CORPUS_EMPTY' };

            const sha256 = await computeSHA256(jsonl);
            const rows: CorpusRow[] = jsonl.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
            const total = rows.length;

            // 2. Prepare Batches
            const chunkDocs: { id: string; data: any }[] = [];
            
            for (let i = 0; i < total; i += CHUNK_SIZE) {
                const chunkRows = rows.slice(i, i + CHUNK_SIZE);
                const chunkIndex = Math.floor(i / CHUNK_SIZE);
                const chunkId = `chunk_${chunkIndex.toString().padStart(4, '0')}`;
                
                const chunkPayload = JSON.stringify(chunkRows);
                const chunkHash = await computeSHA256(chunkPayload);

                chunkDocs.push({
                    id: chunkId,
                    data: {
                        index: chunkIndex,
                        rows: chunkRows,
                        row_count: chunkRows.length,
                        sha256: chunkHash,
                        created_at_iso: new Date().toISOString()
                    }
                });
            }

            // 3. Get Lifecycle Info
            const hydrationState = await CorpusHydrationStore.getState();
            
            // 4. Write Manifest
            const manifestData = {
                version: "v1",
                total_rows: total,
                chunks: chunkDocs.length,
                sha256: sha256,
                updated_at_iso: new Date().toISOString(),
                source: "LOCAL_HYDRATION",
                app_build: "v1-rc",
                lifecycle_state: hydrationState.lifecycleState || 'SEED',
                published_at_iso: new Date().toISOString(),
                published_by: 'MCI_ANALYST'
            };

            // 5. Commit (Batching)
            const batch = writeBatch(db);
            const rootRef = doc(db, COLLECTION_ROOT, DOC_MANIFEST);
            batch.set(rootRef, manifestData);

            chunkDocs.forEach(c => {
                const ref = doc(db, COLLECTION_ROOT, DOC_MANIFEST, SUBCOL_CHUNKS, c.id);
                batch.set(ref, c.data);
            });

            await batch.commit();

            // Update local publish state
            await CorpusHydrationStore.setPublished(manifestData.published_at_iso, manifestData.published_by);

            return {
                ok: true,
                total,
                chunks: chunkDocs.length,
                sha256,
                ms: Date.now() - start
            };

        } catch (e: any) {
            console.error("Push Corpus Failed", e);
            return { ok: false, total: 0, chunks: 0, sha256: '', ms: Date.now() - start, error: e.message };
        }
    },

    async pullCorpusFromFirestore(): Promise<{ ok: boolean; total: number; sha256: string; ms: number; error?: string }> {
        const start = Date.now();
        try {
            const db = RemoteBenchmarkStore.getDb();
            if (!db) return { ok: false, total: 0, sha256: '', ms: 0, error: 'DB_INIT_FAIL' };

            // 1. Get Manifest
            const manifestRef = doc(db, COLLECTION_ROOT, DOC_MANIFEST);
            const manifestSnap = await getDoc(manifestRef);
            
            if (!manifestSnap.exists()) {
                return { ok: false, total: 0, sha256: '', ms: Date.now() - start, error: 'REMOTE_EMPTY' };
            }

            const manifest = manifestSnap.data();
            const expectedTotal = manifest.total_rows;

            // 2. Get Chunks
            const chunksRef = collection(db, COLLECTION_ROOT, DOC_MANIFEST, SUBCOL_CHUNKS);
            const q = query(chunksRef, orderBy('index'));
            const querySnap = await getDocs(q);

            if (querySnap.empty) {
                return { ok: false, total: 0, sha256: '', ms: Date.now() - start, error: 'CHUNKS_EMPTY' };
            }

            // 3. Reassemble
            let allRows: CorpusRow[] = [];
            querySnap.forEach(doc => {
                const data = doc.data();
                if (data.rows && Array.isArray(data.rows)) {
                    allRows = allRows.concat(data.rows);
                }
            });

            // 4. Verify
            if (allRows.length !== expectedTotal) {
                console.warn(`Row count mismatch. Expected ${expectedTotal}, got ${allRows.length}`);
            }

            // 5. Serialize and Save
            const jsonl = allRows.map(r => JSON.stringify(r)).join('\n');
            await CorpusStore.setRawJsonl(jsonl);
            
            // Sync Lifecycle State
            if (manifest.lifecycle_state) {
                await CorpusHydrationStore.setLifecycleState(manifest.lifecycle_state);
            }
            if (manifest.published_at_iso) {
                await CorpusHydrationStore.setPublished(manifest.published_at_iso, manifest.published_by || 'REMOTE');
            }

            return {
                ok: true,
                total: allRows.length,
                sha256: manifest.sha256,
                ms: Date.now() - start
            };

        } catch (e: any) {
            console.error("Pull Corpus Failed", e);
            return { ok: false, total: 0, sha256: '', ms: Date.now() - start, error: e.message };
        }
    },

    async getRemoteCorpusStats(): Promise<{ ok: boolean; total: number; chunks: number; sha256: string; updatedAt: string | null; publishedAt: string | null; lifecycle: string; ms: number; error?: string }> {
        const start = Date.now();
        try {
            const db = RemoteBenchmarkStore.getDb();
            if (!db) return { ok: false, total: 0, chunks: 0, sha256: '', updatedAt: null, publishedAt: null, lifecycle: '', ms: 0, error: 'DB_INIT_FAIL' };

            const manifestRef = doc(db, COLLECTION_ROOT, DOC_MANIFEST);
            const snap = await getDoc(manifestRef);

            if (snap.exists()) {
                const data = snap.data();
                return {
                    ok: true,
                    total: data.total_rows,
                    chunks: data.chunks,
                    sha256: data.sha256 || '',
                    updatedAt: data.updated_at_iso,
                    publishedAt: data.published_at_iso || null,
                    lifecycle: data.lifecycle_state || 'SEED',
                    ms: Date.now() - start
                };
            }
            return { ok: false, total: 0, chunks: 0, sha256: '', updatedAt: null, publishedAt: null, lifecycle: '', ms: Date.now() - start, error: 'NOT_FOUND' };

        } catch (e: any) {
            return { ok: false, total: 0, chunks: 0, sha256: '', updatedAt: null, publishedAt: null, lifecycle: '', ms: Date.now() - start, error: e.message };
        }
    }
};
