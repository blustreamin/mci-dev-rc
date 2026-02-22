
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc, DocumentSnapshot, collection, query, orderBy, limit, getDocs, QuerySnapshot } from 'firebase/firestore';
import { CertifiedBenchmarkV3 } from '../types';
import { RuntimeCache } from './runtimeCache';

// HYBRID CONFIG: ENV VARS > HARDCODED FALLBACK
// This ensures the app works in dev, build-time env injection, AND runtime hardcoded fallback scenarios.
const env = (import.meta as any).env || {};

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || "AIzaSyDNlpQRWVWsKhkQwnu1MYYy4FgogogSlwI",
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || "dev-mens-care-india.firebaseapp.com",
  projectId: env.VITE_FIREBASE_PROJECT_ID || "dev-mens-care-india",
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || "dev-mens-care-india.firebasestorage.app",
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || "631746929602",
  appId: env.VITE_FIREBASE_APP_ID || "1:631746929602:web:de7098fb5ff02b2411ac5b",
};

const COLLECTION_NAME = 'cbv3_snapshots';
const TIMEOUT_MS = 15000;

// In-memory cache for the session
let _cachedLatestSnapshot: CertifiedBenchmarkV3 | null = null;

// Subscribe to cache resets
RuntimeCache.subscribe(() => {
    _cachedLatestSnapshot = null;
    console.log("[RemoteBenchmarkStore] Cache cleared via RuntimeCache");
});

export interface RemoteConnectionResult {
    ok: boolean;
    stage: 'OK' | 'CONFIG_MISSING' | 'INIT_FAIL' | 'WRITE_FAIL' | 'READ_FAIL';
    details?: string;
    roundTripMs?: number;
    projectId?: string;
}

const timeoutPromise = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`REMOTE_TIMEOUT: ${label} exceeded ${ms}ms`)), ms))
    ]);
};

export const RemoteBenchmarkStore = {
    
    getConfigStatus() {
        const missingKeys: string[] = [];
        const presentKeys: Record<string, boolean> = {};
        
        Object.entries(firebaseConfig).forEach(([k, v]) => {
            if (!v) missingKeys.push(k);
            presentKeys[k] = !!v;
        });

        const isReady = missingKeys.length === 0;
        return {
            isReady,
            missingKeys,
            presentKeys,
            projectId: firebaseConfig.projectId,
            authDomain: firebaseConfig.authDomain
        };
    },

    getDb() {
        if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
            console.error("[CBV3][REMOTE] CRITICAL: Missing Firebase Config");
            return null;
        }
        
        try {
            const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
            return getFirestore(app);
        } catch (e) {
            console.error("[CBV3][REMOTE] Firebase Init Error", e);
            return null;
        }
    },

    async testConnection(): Promise<RemoteConnectionResult> {
        console.log("[CBV3][REMOTE][TEST] START");
        const status = this.getConfigStatus();
        
        if (!status.isReady) {
            return { ok: false, stage: 'CONFIG_MISSING', details: 'Config incomplete' };
        }

        const db = this.getDb();
        if (!db) {
            return { ok: false, stage: 'INIT_FAIL', details: 'Firebase App/Firestore init failed' };
        }

        const start = Date.now();
        try {
            const testRef = doc(db, COLLECTION_NAME, '__connection_test');
            const payload = { ok: true, ts: new Date().toISOString(), source: 'ui_test_hybrid' };
            
            // Write with timeout
            await timeoutPromise(setDoc(testRef, payload), TIMEOUT_MS, 'Test Write');
            
            // Read with timeout
            const snap = await timeoutPromise<DocumentSnapshot>(getDoc(testRef), TIMEOUT_MS, 'Test Read');
            if (!snap.exists()) throw new Error("Document written but not found on readback");
            
            const roundTripMs = Date.now() - start;
            
            return { 
                ok: true, 
                stage: 'OK', 
                roundTripMs, 
                projectId: status.projectId 
            };

        } catch (e: any) {
            const stage = e.message?.includes("written") ? 'READ_FAIL' : 'WRITE_FAIL'; 
            return { 
                ok: false, 
                stage: stage, 
                details: e.message 
            };
        }
    },

    async publishLatestSnapshot(snapshot: CertifiedBenchmarkV3): Promise<void> {
        console.log(`[CBV3][REMOTE] PUBLISH_START ${snapshot.id}`);
        const db = this.getDb();
        if (!db) throw new Error("REMOTE_DISABLED_MISSING_CONFIG");

        try {
            // Write to both paths in parallel for speed
            // Force overwrite (merge: false)
            const batchWrites = [
                setDoc(doc(db, COLLECTION_NAME, 'latest'), snapshot, { merge: false }),
                setDoc(doc(db, COLLECTION_NAME, snapshot.id), snapshot, { merge: false })
            ];

            await timeoutPromise(Promise.all(batchWrites), TIMEOUT_MS * 2, 'Publish Batch');
            
            // Update cache immediately
            _cachedLatestSnapshot = snapshot;
            
            console.log(`[CBV3][REMOTE] PUBLISH_OK ${snapshot.id}`);
        } catch (e: any) {
            console.error(`[CBV3][REMOTE] PUBLISH_ERROR`, e);
            throw new Error(`Firestore publish failed: ${e.code || "UNKNOWN"} ${e.message}`);
        }
    },

    async fetchLatestSnapshot(forceRefresh: boolean = false): Promise<CertifiedBenchmarkV3 | null> {
        if (!forceRefresh && _cachedLatestSnapshot) {
            console.log(`[CBV3][REMOTE] FETCH_CACHE_HIT`);
            return _cachedLatestSnapshot;
        }

        console.log(`[CBV3][REMOTE] FETCH_START latest`);
        const db = this.getDb();
        if (!db) {
             console.error("[CBV3][REMOTE] FETCH_ABORT: No DB Config");
             // Don't throw here to avoid crashing UI loops, just return null
             return null;
        }

        try {
            const latestRef = doc(db, COLLECTION_NAME, 'latest');
            // Cache bust query for freshness
            const docSnap = await timeoutPromise<DocumentSnapshot>(getDoc(latestRef), TIMEOUT_MS, 'Fetch Latest');
            
            if (docSnap.exists()) {
                const data = docSnap.data() as CertifiedBenchmarkV3;
                console.log(`[CBV3][REMOTE] FETCH_OK ${data.id} certifiedAt=${data.certifiedAtISO}`);
                
                // Cache it
                _cachedLatestSnapshot = data;
                return data;
            } else {
                console.log(`[CBV3][REMOTE] FETCH_EMPTY`);
                _cachedLatestSnapshot = null;
                return null;
            }
        } catch (e: any) {
            console.error(`[CBV3][REMOTE] FETCH_ERR`, e);
            throw e;
        }
    },

    async fetchLatestByQuery(): Promise<CertifiedBenchmarkV3 | null> {
        console.log(`[CBV3][REMOTE] QUERY_LATEST START`);
        const db = this.getDb();
        if (!db) {
             console.error("[CBV3][REMOTE] FETCH_ABORT: No DB Config");
             return null;
        }

        try {
            const colRef = collection(db, COLLECTION_NAME);
            // Query for the latest created snapshot
            const q = query(colRef, orderBy("createdAtISO", "desc"), limit(1));
            
            const querySnapshot = await timeoutPromise<QuerySnapshot>(getDocs(q), TIMEOUT_MS, 'Query Latest');
            
            if (!querySnapshot.empty) {
                const docSnap = querySnapshot.docs[0];
                const data = docSnap.data() as CertifiedBenchmarkV3;
                console.log(`[CBV3][REMOTE] QUERY_OK ${docSnap.id}`);
                return data;
            }
            
            console.log(`[CBV3][REMOTE] QUERY_EMPTY`);
            return null;
        } catch (e: any) {
            console.error(`[CBV3][REMOTE] QUERY_ERR`, e);
            throw e;
        }
    }
};
