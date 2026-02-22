
import { getSignalHarvesterCollection } from '../config/signalHarvesterConfig';
import { resolveEnvMode } from '../config/envMode';
import { FirestoreClient } from './firestoreClient';
import { collection, query, orderBy, limit, getDocs, where } from 'firebase/firestore';

export interface SignalHarvesterDiagResult {
    ok: boolean;
    timestamp: string;
    config: {
        envMode: string;
        collectionName: string;
        projectId: string;
        fields: {
            categoryField: string;
            timeField: string;
            trustFilter: string;
        };
    };
    probes: {
        latestRead: { 
            ok: boolean; 
            latencyMs: number; 
            error?: string; 
            indexUrl?: string; 
            docId?: string; 
            platform?: string; 
            collectedAt?: string; 
        };
        categoryQuery: { 
            ok: boolean; 
            latencyMs: number; 
            found: boolean; 
            error?: string; 
            indexUrl?: string; 
            modeUsed?: string; 
        };
        monthWindow: { 
            ok: boolean; 
            sampledCount: number; 
            inWindowCount: number; 
            targetMonth: string; 
            windowUsed: string; 
            error?: string; 
        };
    };
    advisories: string[];
}

// Helper to extract Index Creation URL from Firestore Error Message
function extractIndexUrl(error: any): string | undefined {
    if (!error || typeof error.message !== 'string') return undefined;
    const match = error.message.match(/https:\/\/console\.firebase\.google\.com[^\s]*/);
    return match ? match[0] : undefined;
}

export const SignalHarvesterDiagnostics = {
    
    resolveSignalCollectionConfig(collectionName: string) {
        return {
            categoryField: 'categoryId',
            timeField: 'lastSeenAt',
            trustFilter: 'trusted'
        };
    },

    async runDiagnostics(categoryId: string, targetMonth: string): Promise<SignalHarvesterDiagResult> {
        const collectionName = getSignalHarvesterCollection();
        const envMode = resolveEnvMode();
        const dbInfo = FirestoreClient.logFirebaseTarget();
        const fields = this.resolveSignalCollectionConfig(collectionName);

        const result: SignalHarvesterDiagResult = {
            ok: false,
            timestamp: new Date().toISOString(),
            config: {
                envMode,
                collectionName,
                projectId: dbInfo?.projectId || 'unknown',
                fields
            },
            probes: {
                latestRead: { ok: false, latencyMs: 0 },
                categoryQuery: { ok: false, latencyMs: 0, found: false },
                monthWindow: { ok: false, sampledCount: 0, inWindowCount: 0, targetMonth, windowUsed: 'IN_MEMORY' }
            },
            advisories: []
        };

        const db = FirestoreClient.getDbSafe();
        if (!db) {
            result.advisories.push("Database initialization failed.");
            return result;
        }

        const colRef = collection(db, collectionName);

        // PROBE 1: Latest Read (Simple Sort)
        const t1 = Date.now();
        try {
            const q1 = query(colRef, orderBy(fields.timeField, 'desc'), limit(1));
            const snap1 = await getDocs(q1);
            
            result.probes.latestRead.ok = true;
            result.probes.latestRead.latencyMs = Date.now() - t1;
            
            if (!snap1.empty) {
                const data = snap1.docs[0].data();
                result.probes.latestRead.docId = snap1.docs[0].id;
                result.probes.latestRead.platform = data.platform;
                result.probes.latestRead.collectedAt = data[fields.timeField];
            } else {
                result.advisories.push(`Collection '${collectionName}' is empty.`);
            }
        } catch (e: any) {
            result.probes.latestRead.ok = false;
            result.probes.latestRead.latencyMs = Date.now() - t1;
            result.probes.latestRead.error = e.message;
            result.probes.latestRead.indexUrl = extractIndexUrl(e);
        }

        // PROBE 2: Canonical Category Query (Cat + Trusted + Time)
        const t2 = Date.now();
        try {
            const q2 = query(
                colRef, 
                where(fields.categoryField, '==', categoryId), 
                where('trusted', '==', true),
                orderBy(fields.timeField, 'desc'), 
                limit(10)
            );
            
            const snap2 = await getDocs(q2);
            result.probes.categoryQuery.ok = true;
            result.probes.categoryQuery.found = !snap2.empty;
            result.probes.categoryQuery.modeUsed = 'CANONICAL_TRUSTED';
            result.probes.categoryQuery.latencyMs = Date.now() - t2;

            if (snap2.empty) {
                result.advisories.push(`No trusted signals found for ${categoryId}.`);
            }

            // Month Window Stats
            let inWindow = 0;
            if (!snap2.empty) {
                const startPrefix = targetMonth;
                snap2.forEach(d => {
                    const data = d.data();
                    const ts = data[fields.timeField];
                    if (ts && typeof ts === 'string' && ts.startsWith(startPrefix)) {
                        inWindow++;
                    }
                });
            }
            result.probes.monthWindow.ok = true;
            result.probes.monthWindow.sampledCount = snap2.size;
            result.probes.monthWindow.inWindowCount = inWindow;

        } catch (e: any) {
            // If Canonical fails, mark error but also try LIGHT probe
            result.probes.categoryQuery.ok = false;
            result.probes.categoryQuery.error = e.message;
            result.probes.categoryQuery.indexUrl = extractIndexUrl(e);
            
            if (result.probes.categoryQuery.indexUrl) {
                result.advisories.push(`Missing Index: ${fields.categoryField} ASC, trusted ASC, ${fields.timeField} DESC`);
            }

            // Fallback Probe (Index Light)
            try {
                const qFallback = query(colRef, where(fields.categoryField, '==', categoryId), limit(5));
                const snapFallback = await getDocs(qFallback);
                if (!snapFallback.empty) {
                    result.probes.categoryQuery.error = "CANONICAL_INDEX_MISSING (Data Exists)";
                    result.advisories.push("Data exists but index is missing. Create index to fix.");
                }
            } catch (e2) {}
        }

        result.ok = result.probes.latestRead.ok && (result.probes.categoryQuery.ok || !!result.probes.categoryQuery.indexUrl);
        return result;
    }
};
