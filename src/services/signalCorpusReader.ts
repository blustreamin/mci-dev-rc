
import { doc, getDoc } from 'firebase/firestore';
import { FirestoreClient } from './firestoreClient';
import { SignalCorpusSnapshot, SignalCorpusChunk, SignalDTO } from '../types';

export const SignalCorpusReader = {
    async loadSnapshot(categoryId: string, monthKey: string): Promise<{ ok: boolean; snapshot?: SignalCorpusSnapshot; error?: string }> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return { ok: false, error: "DB_INIT_FAIL" };

        try {
            const snapId = `sigcorpus_${categoryId}_${monthKey}`;
            const ref = doc(db, 'signal_corpus_snapshots', snapId);
            const snap = await getDoc(ref);

            if (!snap.exists()) return { ok: false, error: "NO_SIGNAL_CORPUS" };

            return { ok: true, snapshot: snap.data() as SignalCorpusSnapshot };
        } catch (e: any) {
            return { ok: false, error: e.message };
        }
    },

    async readChunk(snapshotId: string, chunkIndex: number): Promise<SignalCorpusChunk | null> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return null;

        try {
            const chunkDocId = `chunk_${chunkIndex.toString().padStart(3, "0")}`;
            const ref = doc(db, 'signal_corpus_snapshots', snapshotId, 'chunks', chunkDocId);
            const snap = await getDoc(ref);
            
            if (snap.exists()) {
                const data = snap.data();
                const rawSignals = data.signals || [];
                const safeSignals: SignalDTO[] = [];
                let droppedCount = 0;

                for (const s of rawSignals) {
                    // Strict Validation
                    if (!s.id || !s.categoryId || s.trusted !== true || !s.lastSeenAt) {
                        droppedCount++;
                        continue;
                    }

                    safeSignals.push({
                        id: String(s.id),
                        url: String(s.url || ""),
                        title: String(s.title || ""),
                        snippet: String(s.snippet || ""),
                        platform: String(s.platform || "web").toLowerCase(),
                        source: String(s.source || "unknown"),
                        categoryId: String(s.categoryId),
                        trusted: true, // enforced by check
                        trustScore: typeof s.trustScore === 'number' ? s.trustScore : 0,
                        lastSeenAt: String(s.lastSeenAt),
                        collectedAt: String(s.collectedAt || s.lastSeenAt),
                        enrichmentStatus: String(s.enrichmentStatus || "UNKNOWN"),
                        provenance: String(s.provenance || "UNKNOWN"),
                        signalType: 'generic',
                        confidence: 0,
                        firstSeenAt: s.firstSeenAt || null
                    });
                }
                
                if (droppedCount > 0) {
                    console.warn(`[SIGNAL_CORPUS] chunk=${chunkIndex} dropped=${droppedCount} invalid signals`);
                }

                return {
                    index: data.index,
                    signals: safeSignals
                };
            }
            return null;
        } catch (e) {
            console.error("Corpus read chunk failed", e);
            return null;
        }
    }
};
