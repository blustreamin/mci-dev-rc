
import { FirestoreClient } from './firestoreClient';
import { collection, query, where, orderBy, limit, getDocs, doc, getDoc } from 'firebase/firestore';
import { getSignalHarvesterCollection } from '../config/signalHarvesterConfig';
import { CORE_CATEGORIES } from '../constants';
import { resolveEnvMode } from '../config/envMode';

export const RcaProbeService = {
    async runFullAudit(categoryId: string, monthKey: string): Promise<string> {
        const report: string[] = [];
        const log = (msg: string) => report.push(msg);
        const section = (title: string) => report.push(`\n=== ${title} ===`);

        const db = FirestoreClient.getDbSafe();
        if (!db) return "DB_INIT_FAIL";

        // --- A) Env & Collection ---
        section("A. Env & Collection");
        const colName = getSignalHarvesterCollection();
        const envMode = resolveEnvMode();
        // @ts-ignore
        const config = db.app.options;
        log(`Env Mode: ${envMode}`);
        log(`Resolved Collection: ${colName}`);
        log(`Firestore Project: ${config.projectId}`);
        
        // --- B) Signals Stream Query Chain ---
        section("B. Query Chain Probes");
        
        const runQuery = async (label: string, constraints: any[]) => {
            try {
                // @ts-ignore
                const q = query(collection(db, colName), ...constraints, limit(5));
                const start = Date.now();
                const snap = await getDocs(q);
                const duration = Date.now() - start;
                
                log(`[${label}] Status: OK (${duration}ms), Count: ${snap.size}`);
                if (!snap.empty) {
                    const d = snap.docs[0].data();
                    const sId = snap.docs[0].id;
                    log(`  Sample Doc (${sId}):`);
                    log(`    trusted: ${d.trusted} (${typeof d.trusted})`);
                    log(`    trustScore: ${d.trustScore} (${typeof d.trustScore})`);
                    log(`    categoryId: "${d.categoryId}"`);
                    log(`    lastSeenAt: ${d.lastSeenAt}`);
                    log(`    _meta.enrichment: ${d._meta?.enrichmentStatus}`);
                }
                return snap.docs.map(d => d.data());
            } catch (e: any) {
                log(`[${label}] FAILED: ${e.message}`);
                if (e.message?.includes("index")) log(`  -> MISSING INDEX detected.`);
                return [];
            }
        };

        // 1. Canonical Stream Query (Category)
        await runQuery("B1. Canonical (Cat+Trusted)", [
            where('categoryId', '==', categoryId),
            where('trusted', '==', true),
            orderBy('lastSeenAt', 'desc')
        ]);

        // 2. Trust Score Sort (Category)
        await runQuery("B2. TrustScore (Cat+Score)", [
            where('categoryId', '==', categoryId),
            where('trustScore', '>=', 0.5),
            orderBy('trustScore', 'desc'),
            orderBy('lastSeenAt', 'desc')
        ]);

        // 3. Fallback Raw (Category Only)
        const catDocs = await runQuery("B3. Raw Category (No Trust)", [
            where('categoryId', '==', categoryId),
            orderBy('lastSeenAt', 'desc')
        ]);

        // 4. Global Raw (Connectivity Check)
        await runQuery("B4. Global Raw (Limit 5)", [
            orderBy('lastSeenAt', 'desc')
        ]);

        // --- C) Category Mapping Audit ---
        section("C. Category Mapping Audit");
        log(`UI Selected Category: "${categoryId}"`);
        
        const coreCat = CORE_CATEGORIES.find(c => c.id === categoryId);
        if (coreCat) {
            log(`Config Found: Yes (${coreCat.category})`);
        } else {
            log(`Config Found: NO (Invalid ID?)`);
        }

        if (catDocs.length > 0) {
            const observedIds = new Set(catDocs.map(d => d.categoryId));
            log(`Observed 'categoryId' in DB: ${Array.from(observedIds).map(s => `"${s}"`).join(', ')}`);
        } else {
            log("No docs found for this category to verify mapping.");
        }

        // --- D) Signal Corpus Snapshot Simulation ---
        section("D. Signal Corpus Logic Simulation");
        // Simulate "Month Window"
        if (catDocs.length > 0) {
            // Check how many pass filters
            const [y, m] = monthKey.split('-').map(Number);
            const start = new Date(Date.UTC(y, m - 1, 1)).toISOString();
            const end = new Date(Date.UTC(y, m, 1)).toISOString();
            
            const inWindow = catDocs.filter(d => d.lastSeenAt >= start && d.lastSeenAt < end);
            log(`Docs in Window (${monthKey}): ${inWindow.length} / ${catDocs.length} sampled`);
            
            const enriched = inWindow.filter(d => d._meta?.enrichmentStatus === 'OK');
            log(`  -> Enriched: ${enriched.length}`);
            
            const trusted = enriched.filter(d => d.trusted === true);
            log(`  -> Trusted: ${trusted.length}`);
            
            if (trusted.length === 0 && inWindow.length > 0) {
                log("  ROOT CAUSE CANDIDATE: Signals exist but 'trusted' flag is missing or false.");
            }
        } else {
            log("Skipping Corpus Simulation (No Raw Docs)");
        }

        // --- E) Deep Dive Read Path ---
        section("E. Deep Dive Read Path");
        const pointerId = `${categoryId}_${monthKey}`;
        log(`Checking Pointer: deepDive_latest/${pointerId}`);
        
        const pointerSnap = await getDoc(doc(db, 'deepDive_latest', pointerId));
        if (pointerSnap.exists()) {
            const pd = pointerSnap.data();
            log(`Pointer Found! RunID: ${pd.runId}`);
            log(`  Status: ${pd.status}`);
            log(`  Result Doc: ${pd.resultDocId}`);
            
            if (pd.resultDocId) {
                const resSnap = await getDoc(doc(db, 'deepDive_runs', pd.resultDocId));
                log(`  Result Doc Access: ${resSnap.exists() ? 'OK' : 'MISSING'}`);
            }
        } else {
            log("Pointer NOT FOUND. (Deep Dive likely never ran successfully)");
        }

        // --- F) Demand Snapshot Check ---
        section("F. Demand Snapshot Check");
        const demandPath = `mci_outputs/IN/en/${categoryId}/snapshots`;
        log(`Checking Collection: ${demandPath}`);
        try {
            const dQ = query(collection(db, demandPath), orderBy('created_at_iso', 'desc'), limit(1));
            const dSnap = await getDocs(dQ);
            if (!dSnap.empty) {
                const dDoc = dSnap.docs[0].data();
                log(`Latest Demand Snapshot: ${dDoc.snapshot_id}`);
                log(`  Created: ${dDoc.created_at_iso}`);
                log(`  Lifecycle: ${dDoc.lifecycle}`);
            } else {
                log("NO DEMAND SNAPSHOTS FOUND.");
            }
        } catch (e: any) {
            log(`Demand Check Error: ${e.message}`);
        }

        return report.join('\n');
    }
};
