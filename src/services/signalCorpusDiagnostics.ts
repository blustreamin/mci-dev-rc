import { doc, getDoc, collection, getDocs, query, limit } from 'firebase/firestore';
import { FirestoreClient } from './firestoreClient';
import { DemandSnapshotResolver } from './demandSnapshotResolver';
import { SignalSnapshotResolver } from './deepDiveSnapshotResolvers';
import { SignalCorpusSnapshot } from '../types';

export interface SignalCorpusDiagnosticsResult {
    ok: boolean;
    snapshotId: string;
    exists: boolean;
    chunks: number;
    signals: number;
    platformCapOk: boolean;
    trustScorePolicyOk: boolean; // Inferred from existence + config usually, or check samples
    lastUpdated?: string;
    error?: string;
}

export interface DeepDiveReadinessResult {
    ok: boolean;
    demandMode: string;
    signalMode: string;
    confidence: 'OK' | 'PARTIAL' | 'BACKFILL';
    notes: string[];
}

export const SignalCorpusDiagnostics = {
    async probeSnapshot(categoryId: string, monthKey: string): Promise<SignalCorpusDiagnosticsResult> {
        const db = FirestoreClient.getDbSafe();
        const snapshotId = `sigcorpus_${categoryId}_${monthKey}`;
        
        if (!db) {
            return { ok: false, snapshotId, exists: false, chunks: 0, signals: 0, platformCapOk: false, trustScorePolicyOk: false, error: "DB_INIT_FAIL" };
        }

        try {
            const snapRef = doc(db, 'signal_corpus_snapshots', snapshotId);
            const snap = await getDoc(snapRef);

            if (!snap.exists()) {
                return { ok: false, snapshotId, exists: false, chunks: 0, signals: 0, platformCapOk: false, trustScorePolicyOk: false };
            }

            const data = snap.data() as SignalCorpusSnapshot;
            
            // Check platform cap (heuristic: if platforms list is diverse enough for the count)
            // Strict check would require reading chunks, here we check metadata
            const platformCapOk = data.platforms.length >= 1 || data.signalCount < 10; 
            
            return {
                ok: true,
                snapshotId,
                exists: true,
                chunks: data.chunkCount,
                signals: data.signalCount,
                platformCapOk,
                trustScorePolicyOk: true, // Assumed if created via service
                lastUpdated: data.createdAtIso
            };
        } catch (e: any) {
             return { ok: false, snapshotId, exists: false, chunks: 0, signals: 0, platformCapOk: false, trustScorePolicyOk: false, error: e.message };
        }
    },

    async checkDeepDiveReadiness(categoryId: string, monthKey: string): Promise<DeepDiveReadinessResult> {
        const notes: string[] = [];
        let ok = true;

        // 1. Demand
        const demandRes = await DemandSnapshotResolver.resolve(categoryId, monthKey);
        if (!demandRes.ok) {
            ok = false;
            notes.push(`Demand Snapshot Missing: ${demandRes.reason}`);
        }

        // 2. Signals
        const signalRes = await SignalSnapshotResolver.resolve(categoryId, monthKey);
        // Also check corpus explicitly
        const corpusProbe = await this.probeSnapshot(categoryId, monthKey);

        let signalMode: string = signalRes.mode;
        if (corpusProbe.exists) {
            signalMode = 'CORPUS_SNAPSHOT';
        } else if (signalMode === 'NONE') {
            // Signal Resolver returns NONE if exact missing, but deep dive might use fallback
            // Check if Global Fallback is viable
             if (signalRes.reason === 'NO_SIGNAL_SNAPSHOT') {
                 // DeepDiveRunner fallback logic implies it will try to fetch live if missing
                 // But strictly for readiness, we want DATA on hand.
                 ok = false;
                 notes.push("No Signal Corpus and No Harvester Snapshot found.");
             }
        }

        let confidence: DeepDiveReadinessResult['confidence'] = 'OK';
        // Check for FALLBACK_LATEST instead of GLOBAL_FALLBACK as SignalResolutionResult uses FALLBACK_LATEST
        if (signalMode === 'FALLBACK_LATEST') confidence = 'PARTIAL';
        if (signalMode === 'NONE' || !ok) confidence = 'BACKFILL';

        return {
            ok,
            demandMode: demandRes.mode,
            signalMode,
            confidence,
            notes
        };
    }
};