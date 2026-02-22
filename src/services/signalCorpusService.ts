
import { doc, setDoc, collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { FirestoreClient } from './firestoreClient';
import { SignalCorpusSnapshot, SignalDTO } from '../types';
import { SignalHarvesterClient } from './signalHarvesterClient';
import { resolveEnvMode } from '../config/envMode';
import { classifyFirestoreError } from '../utils/firestoreErrorUtils';

export interface CorpusBuildOptions {
    limit?: number;
    minTrust?: number; 
    platformCapRatio?: number;
}

export const SignalCorpusService = {
    async createSnapshot(
        categoryId: string, 
        monthKey: string, 
        options: CorpusBuildOptions = {}
    ): Promise<{ ok: boolean; snapshotId?: string; error?: string; stats?: any }> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return { ok: false, error: "DB_INIT_FAIL" };

        const targetLimit = options.limit || 90;
        const capRatio = options.platformCapRatio || 0.4;
        
        const snapshotId = `sigcorpus_${categoryId}_${monthKey}`;
        const collectionName = SignalHarvesterClient.getCollectionName();

        console.log(`[SIGNAL_CORPUS] Building ${snapshotId} from ${collectionName}...`);

        let rawDocs: any[] = [];
        let planUsed = "CANONICAL";

        // --- 1. Query Ladder (Index Safety) ---
        try {
            // Plan A: Canonical Fast Path
            // Requires Composite: categoryId ASC, trusted ASC, lastSeenAt DESC
            const q = query(
                collection(db, collectionName),
                where('categoryId', '==', categoryId),
                where('trusted', '==', true),
                orderBy('lastSeenAt', 'desc'),
                limit(300)
            );
            const snap = await getDocs(q);
            rawDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (e: any) {
            if (e.code === 'failed-precondition' || e.message?.includes('index')) {
                try {
                    // Plan B: Category Light
                    // Requires Index: categoryId ASC, lastSeenAt DESC (Simpler)
                    const q2 = query(
                        collection(db, collectionName),
                        where('categoryId', '==', categoryId),
                        orderBy('lastSeenAt', 'desc'),
                        limit(500)
                    );
                    const snap2 = await getDocs(q2);
                    rawDocs = snap2.docs.map(d => ({ id: d.id, ...d.data() }));
                    planUsed = "CATEGORY_LIGHT";
                } catch (e2: any) {
                     // Plan C: Global Recent (Last Resort)
                     // Requires Index: lastSeenAt DESC (Basic)
                     const q3 = query(
                        collection(db, collectionName),
                        orderBy('lastSeenAt', 'desc'),
                        limit(2000)
                     );
                     const snap3 = await getDocs(q3);
                     rawDocs = snap3.docs.map(d => ({ id: d.id, ...d.data() }));
                     planUsed = "GLOBAL_LIGHT";
                }
            } else {
                return { ok: false, error: e.message };
            }
        }

        console.log(`[SIGNAL_CORPUS] plan=${planUsed} fetched=${rawDocs.length}`);

        // --- 2. In-Memory Pipeline ---
        
        // A) Strict Filtering (Trust + Enrichment + Schema)
        // Normalize fields first
        const normalizedDocs: SignalDTO[] = rawDocs.map(d => {
            const lastSeenAt = d.lastSeenAt || d.collectedAt || new Date().toISOString();
            return {
                id: d.id,
                url: d.url || "",
                title: d.title || "",
                snippet: d.snippet || "",
                platform: (d.platform || "web").toLowerCase(),
                source: d.source || "unknown",
                categoryId: d.categoryId || d.category || categoryId,
                trusted: d.trusted === true,
                trustScore: typeof d.trustScore === 'number' ? d.trustScore : 0,
                lastSeenAt: lastSeenAt,
                collectedAt: d.collectedAt || lastSeenAt,
                enrichmentStatus: d._meta?.enrichmentStatus || d.enrichmentStatus || "UNKNOWN",
                provenance: planUsed,
                signalType: 'generic',
                confidence: 0,
                firstSeenAt: d.firstSeenAt || d.collectedAt || null
            };
        });

        const preFilterCount = normalizedDocs.length;
        
        // Apply Filters
        const validDocs = normalizedDocs.filter(d => 
            d.categoryId === categoryId &&
            d.trusted === true &&
            d.enrichmentStatus === 'OK' &&
            // Simple ISO check
            /^\d{4}-\d{2}-\d{2}/.test(d.lastSeenAt || "")
        );

        // B) Window Policy
        const [y, m] = monthKey.split('-').map(Number);
        const startIso = new Date(Date.UTC(y, m - 1, 1)).toISOString();
        const endIso = new Date(Date.UTC(y, m, 1)).toISOString();
        
        let candidates = validDocs.filter(d => (d.lastSeenAt || "") >= startIso && (d.lastSeenAt || "") < endIso);
        let windowUsed = "EXACT_MONTH";

        // Fallback to 90d window if sparse
        if (candidates.length < 20) {
            const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();
            candidates = validDocs.filter(d => (d.lastSeenAt || "") >= ninetyDaysAgo);
            windowUsed = "GLOBAL_90D";
        }

        // C) Deduplication
        const uniqueMap = new Map();
        candidates.forEach(d => uniqueMap.set(d.id, d));
        const uniqueSignals = Array.from(uniqueMap.values());

        // D) Cap & Selection (Newest First -> Platform Cap)
        uniqueSignals.sort((a, b) => (b.lastSeenAt || "").localeCompare(a.lastSeenAt || ""));

        const finalSignals: SignalDTO[] = [];
        const platformCounts: Record<string, number> = {};
        const platformsUsed = new Set<string>();
        const maxPerPlatform = Math.floor(targetLimit * capRatio);

        for (const cand of uniqueSignals) {
            if (finalSignals.length >= targetLimit) break;
            const p = cand.platform;
            const currentCount = platformCounts[p] || 0;

            if (currentCount < maxPerPlatform) {
                finalSignals.push(cand);
                platformCounts[p] = currentCount + 1;
                platformsUsed.add(p);
            }
        }

        if (finalSignals.length === 0) {
            // DO NOT WRITE empty snapshot
            return { ok: false, error: "NO_TRUSTED_SIGNALS_AVAILABLE" };
        }

        // --- 3. Write Snapshot ---
        const CHUNK_SIZE = 15;
        const chunkCount = Math.ceil(finalSignals.length / CHUNK_SIZE);
        
        const stats = {
            requestedLimit: targetLimit,
            producedCount: finalSignals.length,
            perPlatformCounts: platformCounts,
            windowUsed,
            planUsed
        };

        const snapshotDoc: SignalCorpusSnapshot = {
            id: snapshotId,
            categoryId,
            monthKey,
            version: "v1",
            signalCount: finalSignals.length,
            platforms: Array.from(platformsUsed),
            languages: ["en"],
            createdAtIso: new Date().toISOString(),
            chunkCount: chunkCount,
            source: {
                envMode: resolveEnvMode(),
                harvesterCollection: collectionName,
                fetchedCandidates: rawDocs.length,
                trustPolicy: 1, 
                platformCapPct: capRatio * 100,
                monthStrategy: windowUsed
            },
            stats,
            warnings: [],
            summary: {
                signals: finalSignals.length,
                chunks: chunkCount,
                trustedUsed: finalSignals.length,
                enrichedUsed: finalSignals.filter(s => s.enrichmentStatus === 'OK').length,
                schemaVersion: 1,
                timeFieldMode: "ISO",
                sample: finalSignals.slice(0, 5)
            }
        };

        const snapshotRef = doc(db, 'signal_corpus_snapshots', snapshotId);
        await setDoc(snapshotRef, snapshotDoc, { merge: true });

        for (let i = 0; i < finalSignals.length; i += CHUNK_SIZE) {
            const chunkIndex = Math.floor(i / CHUNK_SIZE);
            const chunkSignals = finalSignals.slice(i, i + CHUNK_SIZE);
            const chunkDocId = `chunk_${chunkIndex.toString().padStart(3, "0")}`;
            const chunkRef = doc(db, 'signal_corpus_snapshots', snapshotId, 'chunks', chunkDocId);
            
            await setDoc(chunkRef, {
                index: chunkIndex,
                signals: chunkSignals
            }, { merge: true });
        }

        return { ok: true, snapshotId, stats };
    }
};
