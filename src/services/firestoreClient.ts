
import { RemoteBenchmarkStore } from './remoteBenchmarkStore';

export const FirestoreClient = {
    getDbSafe() {
        try {
            return RemoteBenchmarkStore.getDb();
        } catch (e) {
            console.error("Firestore Init Error", e);
            return null;
        }
    },

    logFirebaseTarget() {
        try {
            const db = RemoteBenchmarkStore.getDb();
            if (!db) {
                console.warn("[FIREBASE_TARGET] DB Not Initialized");
                return null;
            }
            // @ts-ignore - Accessing internal options for debugging
            const opts = db.app.options;
            const info = {
                projectId: opts.projectId,
                storageBucket: opts.storageBucket,
                dbApp: db.app.name,
                // @ts-ignore
                databaseId: db._databaseId?.projectId || 'default'
            };
            console.log("[FIREBASE_TARGET]", info);
            return info;
        } catch (e) {
            console.error("[FIREBASE_TARGET] Failed to inspect DB", e);
            return null;
        }
    },

    nowIso() {
        return new Date().toISOString();
    },

    /**
     * Recursively removes keys with undefined values to prevent Firestore errors.
     * Preserves nulls.
     */
    sanitize(obj: any): any {
        if (obj === undefined) return null; 
        if (obj === null) return null;
        if (Array.isArray(obj)) {
            return obj.map(v => FirestoreClient.sanitize(v));
        }
        if (typeof obj === 'object') {
            const res: any = {};
            for (const key in obj) {
                const val = obj[key];
                if (val !== undefined) {
                    res[key] = FirestoreClient.sanitize(val);
                }
            }
            return res;
        }
        return obj;
    },

    async safe<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
        try {
            const result = await fn();
            if (result === undefined || result === null) {
                return { ok: false, error: "Operation returned no data" };
            }
            return { ok: true, data: result };
        } catch (e: any) {
            console.error("Firestore Operation Failed", e);
            return { ok: false, error: e.message || "Unknown Firestore Error" };
        }
    }
};
