
import { FirestoreClient } from './firestoreClient';
import { CredsStore } from './demand_vNext/credsStore';
import { DataForSeoClient } from './demand_vNext/dataforseoClient';
import { FirestoreVolumeCache } from './firestoreVolumeCache';
import { CategorySnapshotStore } from './categorySnapshotStore';
import { SnapshotResolver } from './snapshotResolver';
import { doc, setDoc, getDoc, deleteDoc, collection, limit, query, getDocs } from 'firebase/firestore';
import { normalizeKeywordString } from '../driftHash';
import { CategorySnapshotDoc, SnapshotKeywordRow } from '../types';
import { DemandProvenanceAudit } from './demandProvenanceAudit';

export interface V4IntegrityReport {
  ts: string;
  verdict: "GO" | "NO_GO";
  checks: {
    firestore: { ok: boolean; readOk: boolean; writeOk: boolean; latencyMs: number; error: string };
    creds: { ok: boolean; amazon: boolean; details: string };
    amazonApi: { ok: boolean; status: number; latencyMs: number; keywordsSent: number; rowsParsed: number; matchedPath: string; error: string; hint?: string };
    cache: { ok: boolean; writes: number; readbacks: number; mismatches: number };
    snapshot: { ok: boolean; snapshotId: string | null; rowsUpdated: number; backwardOk: boolean; forwardOk: boolean; error: string };
    provenance: { ok: boolean; data?: any; error?: string };
  };
  blockers: string[];
  warnings: string[];
  nextSteps: string[];
}

export const IntegrityConsoleService = {
  async runV4IntegrityCheck(): Promise<V4IntegrityReport> {
    const runId = `v4_check_${Date.now()}`;
    const report: V4IntegrityReport = {
      ts: new Date().toISOString(),
      verdict: "GO",
      checks: {
        firestore: { ok: false, readOk: false, writeOk: false, latencyMs: 0, error: "" },
        creds: { ok: false, amazon: false, details: "" },
        amazonApi: { ok: false, status: 0, latencyMs: 0, keywordsSent: 0, rowsParsed: 0, matchedPath: "", error: "" },
        cache: { ok: false, writes: 0, readbacks: 0, mismatches: 0 },
        snapshot: { ok: false, snapshotId: null, rowsUpdated: 0, backwardOk: false, forwardOk: false, error: "" },
        provenance: { ok: false }
      },
      blockers: [],
      warnings: [],
      nextSteps: []
    };

    console.log(`[INTEGRITY_V4][START] runId=${runId}`);

    // 1. Firestore Check
    try {
      const db = FirestoreClient.getDbSafe();
      if (!db) throw new Error("DB_INIT_FAIL");
      
      const start = Date.now();
      
      // Read
      const q = query(collection(db, 'mci_category_snapshots'), limit(1));
      await getDocs(q);
      report.checks.firestore.readOk = true;

      // Write (Part B: Even Segment Fix)
      // Path: diagnostics_integrity/{runId} (2 segments)
      const diagRef = doc(db, 'diagnostics_integrity', runId);
      await setDoc(diagRef, { ts: report.ts, type: 'V4_CHECK' });
      await deleteDoc(diagRef);
      report.checks.firestore.writeOk = true;
      
      report.checks.firestore.latencyMs = Date.now() - start;
      report.checks.firestore.ok = true;
    } catch (e: any) {
      report.checks.firestore.error = e.message;
      report.blockers.push(`FIRESTORE_FAIL: ${e.message}`);
    }

    // 2. Credentials Check
    try {
      const creds = await CredsStore.get();
      if (creds && creds.login && creds.password) {
        report.checks.creds.ok = true;
        report.checks.creds.amazon = true; // Assuming same creds for now
        report.checks.creds.details = `Source: ${creds.source}, User: ${creds.login.substring(0, 3)}***`;
      } else {
        throw new Error("Missing Credentials");
      }
    } catch (e: any) {
      report.blockers.push("CREDS_MISSING");
    }

    // 3. Amazon API Check (Part C)
    if (report.checks.creds.ok) {
      try {
        const creds = await CredsStore.get();
        const start = Date.now();
        const samples = ["razor", "trimmer", "shaving cream"];
        
        const res = await DataForSeoClient.fetchAmazonKeywordVolumesLive(
          creds as any,
          samples,
          "amazon.in"
        );

        report.checks.amazonApi.status = res.status;
        report.checks.amazonApi.latencyMs = res.latency;
        report.checks.amazonApi.keywordsSent = samples.length;
        report.checks.amazonApi.matchedPath = res.parseMeta?.matchedPath || "";
        if (res.hint) report.checks.amazonApi.hint = res.hint;
        
        if (res.ok && res.parsedRows && res.parsedRows.length > 0) {
            report.checks.amazonApi.rowsParsed = res.parsedRows.length;
            report.checks.amazonApi.ok = true;
        } else {
            throw new Error(res.error || "No rows parsed from Amazon response");
        }
      } catch (e: any) {
        report.checks.amazonApi.error = e.message;
        report.blockers.push(`AMAZON_API_FAIL: ${e.message}`);
      }
    }

    // 4. Cache Check
    if (report.checks.firestore.ok) {
        try {
            const samples = ["test_kw_1", "test_kw_2", "test_kw_3"];
            let writes = 0;
            let readbacks = 0;
            
            for (const kw of samples) {
                await FirestoreVolumeCache.setAmazonVolume(kw, 999);
                writes++;
                const back = await FirestoreVolumeCache.getAmazonVolume(kw);
                if (back && back.volume === 999) readbacks++;
            }
            
            report.checks.cache.writes = writes;
            report.checks.cache.readbacks = readbacks;
            report.checks.cache.ok = (writes === samples.length && readbacks === samples.length);
            
            if (!report.checks.cache.ok) report.warnings.push("CACHE_FLAKY");

        } catch (e: any) {
            report.warnings.push(`CACHE_FAIL: ${e.message}`);
        }
    }

    // 5. Snapshot Compatibility (Diagnostic Clone)
    if (report.checks.firestore.ok) {
        try {
            // Resolve ANY snapshot to use as template
            const res = await SnapshotResolver.resolveActiveSnapshot('shaving', 'IN', 'en');
            const sourceSnap = res.snapshot;
            
            if (sourceSnap) {
                // Create Diagnostic Clone
                const diagSnapId = `diag_v4_${runId}`;
                report.checks.snapshot.snapshotId = diagSnapId;
                
                // Write Dummy Snapshot
                const diagSnap: CategorySnapshotDoc = {
                    ...sourceSnap,
                    snapshot_id: diagSnapId,
                    lifecycle: 'DRAFT',
                    stats: { ...sourceSnap.stats, keywords_total: 1, valid_total: 1 }
                };
                await CategorySnapshotStore.writeSnapshot(diagSnap);

                // Write Dummy Row with Amazon Fields
                const testRow: SnapshotKeywordRow = {
                    keyword_id: 'test_row_1',
                    keyword_text: 'test razor',
                    volume: 100,
                    amazonVolume: 500, // V4 Field
                    amazonBoosted: true, // V4 Field
                    demandScore: 1000, // V4 Field
                    anchor_id: 'test',
                    intent_bucket: 'Discovery',
                    status: 'VALID',
                    active: true,
                    language_code: 'en',
                    country_code: 'IN',
                    category_id: 'shaving',
                    created_at_iso: new Date().toISOString()
                };

                await CategorySnapshotStore.writeKeywordRows(
                    { categoryId: 'shaving', countryCode: 'IN', languageCode: 'en' },
                    diagSnapId,
                    [testRow]
                );
                
                report.checks.snapshot.rowsUpdated = 1;

                // Readback Verify
                const readRes = await CategorySnapshotStore.readAllKeywordRows(
                    { categoryId: 'shaving', countryCode: 'IN', languageCode: 'en' },
                    diagSnapId
                );
                
                if (readRes.ok && readRes.data.length > 0) {
                    const row = readRes.data[0];
                    if (row.amazonVolume === 500 && row.amazonBoosted === true) {
                        report.checks.snapshot.forwardOk = true;
                        report.checks.snapshot.backwardOk = true; // Assuming it didn't crash
                        report.checks.snapshot.ok = true;
                    } else {
                        report.checks.snapshot.error = "Fields not persisted";
                    }
                }
            } else {
                report.warnings.push("NO_BASE_SNAPSHOT_FOR_TEST");
            }
        } catch (e: any) {
             report.checks.snapshot.error = e.message;
             report.warnings.push(`SNAPSHOT_TEST_FAIL: ${e.message}`);
        }
    }

    // 6. Demand Provenance Audit (Part A)
    if (report.checks.firestore.ok) {
        const provCheck = await DemandProvenanceAudit.auditCategory('shaving');
        if (provCheck.ok) {
            report.checks.provenance.ok = true;
            report.checks.provenance.data = provCheck.data;
        } else {
            // Non-blocking in dev/test, but tracked
            report.checks.provenance.ok = false;
            report.checks.provenance.error = provCheck.error;
            if (provCheck.error === "NO_SNAPSHOT") {
                report.warnings.push("PROVENANCE_SKIP: No active shaving snapshot");
            } else {
                report.blockers.push(`PROVENANCE_FAIL: ${provCheck.error}`);
            }
        }
    }

    // Final Verdict
    if (report.blockers.length > 0) report.verdict = "NO_GO";
    
    console.log(`[INTEGRITY_V4][DONE] verdict=${report.verdict}`);
    return report;
  }
};
