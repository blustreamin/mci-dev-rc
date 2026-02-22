
import { FirestoreClient } from './firestoreClient';
import { collection, getDocs, limit, query, doc, setDoc, getDoc } from 'firebase/firestore';

export interface FirebaseTargetInfo {
    projectId: string;
    appName: string;
    authDomain: string;
    storageBucket: string;
    apiKeyMasked: string;
    databaseId: string;
    envMode: string;
}

export interface ProbeResult {
    ok: boolean;
    latencyMs: number;
    error?: string;
    details?: any;
    timestamp: string;
    status?: string; // for UI state tracking
}

export const DbConnectivityProbe = {
    getFirebaseTargetInfo(): FirebaseTargetInfo {
        const db = FirestoreClient.getDbSafe();
        if (!db) {
            return {
                projectId: 'N/A',
                appName: 'N/A',
                authDomain: 'N/A',
                storageBucket: 'N/A',
                apiKeyMasked: 'N/A',
                databaseId: 'N/A',
                envMode: (import.meta as any).env?.MODE || 'unknown'
            };
        }
        
        // @ts-ignore - Accessing internal options for debugging
        const opts = db.app.options;
        return {
            projectId: opts.projectId || 'missing',
            appName: db.app.name,
            authDomain: opts.authDomain || 'missing',
            storageBucket: opts.storageBucket || 'missing',
            apiKeyMasked: opts.apiKey ? `${opts.apiKey.substring(0, 4)}...` : 'missing',
            // @ts-ignore
            databaseId: db._databaseId?.projectId || 'default',
            envMode: (import.meta as any).env?.MODE || 'unknown'
        };
    },

    async pingFirestoreRead(): Promise<ProbeResult> {
        const start = Date.now();
        console.log('[DB_PROBE][READ_START]');
        try {
            const db = FirestoreClient.getDbSafe();
            if (!db) throw new Error("DB_INIT_FAIL");

            // Read from 'mci_category_snapshots' limit 1 as a safe, existing collection
            const colRef = collection(db, 'mci_category_snapshots');
            const q = query(colRef, limit(1));
            const snap = await getDocs(q);
            
            const latencyMs = Date.now() - start;
            console.log(`[DB_PROBE][READ_OK] ${latencyMs}ms docs=${snap.size}`);
            
            return {
                ok: true,
                latencyMs,
                details: { docsFound: snap.size },
                timestamp: new Date().toISOString()
            };
        } catch (e: any) {
            const latencyMs = Date.now() - start;
            console.error(`[DB_PROBE][READ_FAIL] ${latencyMs}ms`, e);
            return {
                ok: false,
                latencyMs,
                error: e.message || 'Unknown Read Error',
                timestamp: new Date().toISOString()
            };
        }
    },

    async pingFirestoreWrite(): Promise<ProbeResult> {
        const start = Date.now();
        const probeId = `probe_${Date.now()}`;
        console.log('[DB_PROBE][WRITE_START]', probeId);
        try {
            const db = FirestoreClient.getDbSafe();
            if (!db) throw new Error("DB_INIT_FAIL");

            const docRef = doc(db, 'corpus_probe', probeId);
            const payload = {
                createdAt: new Date().toISOString(),
                traceId: probeId,
                projectId: this.getFirebaseTargetInfo().projectId,
                envMode: (import.meta as any).env?.MODE || 'unknown'
            };

            // Write
            await setDoc(docRef, payload);
            
            // Read back verification
            const snap = await getDoc(docRef);
            if (!snap.exists()) throw new Error("Write confirmed but document not found on immediate readback.");

            const latencyMs = Date.now() - start;
            console.log(`[DB_PROBE][WRITE_OK] ${latencyMs}ms id=${probeId}`);
            
            return {
                ok: true,
                latencyMs,
                details: { probeId },
                timestamp: new Date().toISOString()
            };
        } catch (e: any) {
            const latencyMs = Date.now() - start;
            console.error(`[DB_PROBE][WRITE_FAIL] ${latencyMs}ms`, e);
            return {
                ok: false,
                latencyMs,
                error: e.message || 'Unknown Write Error',
                timestamp: new Date().toISOString()
            };
        }
    }
};
