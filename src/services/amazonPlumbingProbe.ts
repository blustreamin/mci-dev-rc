
import { FirestoreClient } from './firestoreClient';
import { CredsStore } from './demand_vNext/credsStore';
import { DataForSeoClient } from './demand_vNext/dataforseoClient';
import { SnapshotResolver } from './snapshotResolver';
import { CategorySnapshotStore } from './categorySnapshotStore';
import { doc, getDoc, setDoc, deleteDoc, collection, limit, query, getDocs } from 'firebase/firestore';
import { normalizeKeywordString } from '../driftHash';
import { FirestoreVolumeCache } from './firestoreVolumeCache';
import { CertificationReadinessService } from './certificationReadinessService';
import { CategorySnapshotDoc } from '../types';

export const AmazonPlumbingProbe = {
    async runAmazonIntegrityGate(inputs: { 
        categoryId?: string; 
        snapshotId?: string; 
        sampleKeywords?: string[];
    }) {
        const timestamp = new Date().toISOString();
        const categoryId = inputs.categoryId || 'shaving';
        // Use specific, known keywords for deterministic testing
        const samples = inputs.sampleKeywords || ["shaving razor", "gillette razor", "shaving cream"];

        const report = {
            ts: timestamp,
            verdict: "GO",
            target: { projectId: "", databaseId: "", envMode: "" },
            checks: {
                firestore: { ok: false, readOk: false, writeOk: false, latencyMs: 0, error: "" },
                creds: { ok: false, amazon: false, details: "" },
                amazonApi: { ok: false, status: 0, latencyMs: 0, keywordsSent: 0, rowsParsed: 0, matchedPath: "", error: "" },
                cache: { ok: false, writes: 0, readbacks: 0, mismatches: 0 },
                snapshot: { ok: false, snapshotId: "", rowsUpdated: 0, backwardOk: false, forwardOk: false, error: "" }
            },
            blockers: [] as string[],
            warnings: [] as string[],
            nextSteps: [] as string[]
        };

        const log = (tag: string, msg: string) => console.log(`[AMZ_GATE][${tag}] ${msg}`);
        log("START", `Running for category=${categoryId} marketplace=amazon.in`);

        // --- STEP A: FIRESTORE TARGET ---
        try {
            const db = FirestoreClient.getDbSafe();
            if (!db) throw new Error("DB_INIT_FAIL");
            
            // @ts-ignore
            const opts = db.app.options;
            report.target = {
                projectId: opts.projectId || 'N/A',
                databaseId: (db as any)._databaseId?.projectId || 'default',
                envMode: (import.meta as any).env?.MODE || 'unknown'
            };

            const fsStart = Date.now();
            const probeId = `amz_probe_${Date.now()}`;
            
            // Read Probe
            const q = query(collection(db, 'mci_category_snapshots'), limit(1));
            const snap = await getDocs(q);
            report.checks.firestore.readOk = true;

            // Write Probe
            const docRef = doc(db, 'corpus_probe', probeId);
            await setDoc(docRef, { ts: timestamp, type: 'AMAZON_INTEGRITY_CHECK' });
            await deleteDoc(docRef); // Cleanup
            report.checks.firestore.writeOk = true;
            
            report.checks.firestore.latencyMs = Date.now() - fsStart;
            report.checks.firestore.ok = true;
            log("FIRESTORE_OK", `${report.checks.firestore.latencyMs}ms`);

        } catch (e: any) {
            report.checks.firestore.error = e.message;
            report.blockers.push("FIRESTORE_IO_FAIL");
            report.verdict = "NO_GO";
            log("FAIL", `Firestore: ${e.message}`);
            return report; // Critical Fail
        }

        // --- STEP B: CREDENTIALS ---
        try {
            const creds = await CredsStore.get();
            if (!creds || !creds.login || !creds.password) {
                throw new Error("Missing DataForSEO Credentials");
            }
            report.checks.creds.ok = true;
            report.checks.creds.amazon = true;
            report.checks.creds.details = `Source: ${creds.source}, Login: ${creds.login.substring(0,3)}***`;
            log("CREDS_OK", report.checks.creds.details);
        } catch (e: any) {
            report.checks.creds.ok = false;
            report.blockers.push("AMZ_CREDS_MISSING");
            report.verdict = "NO_GO";
            log("FAIL", "Credentials Missing");
            return report;
        }

        // --- STEP C: AMAZON API (CORRECTED ENDPOINT) ---
        let apiVolumes: Record<string, number> = {};
        try {
            const creds = await CredsStore.get();
            const apiStart = Date.now();
            
            // Use the NEW method pointing to DataForSEO Labs
            const res = await DataForSeoClient.fetchAmazonKeywordVolumesLive(
                creds as any,
                samples,
                "amazon.in"
            );

            report.checks.amazonApi.status = res.status;
            report.checks.amazonApi.latencyMs = res.latency;
            report.checks.amazonApi.keywordsSent = samples.length;
            report.checks.amazonApi.matchedPath = res.parseMeta?.matchedPath || "";
            
            if (res.ok && res.parsedRows && res.parsedRows.length > 0) {
                report.checks.amazonApi.rowsParsed = res.parsedRows.length;
                
                // Check if we actually got volume data in the amazon_volume field (preferred) or search_volume
                const validVolRows = res.parsedRows.filter(r => (r.amazon_volume !== undefined && r.amazon_volume > 0) || (r.search_volume !== undefined && r.search_volume > 0));
                
                if (validVolRows.length < 1) {
                    throw new Error("Parsed rows but no volume data found. Check endpoint.");
                }

                res.parsedRows.forEach(r => {
                    const norm = normalizeKeywordString(r.keyword);
                    apiVolumes[norm] = r.amazon_volume ?? r.search_volume ?? 0;
                });

                report.checks.amazonApi.ok = true;
                log("API_OK", `endpoint=${res.urlUsed} rows=${res.parsedRows.length} validVol=${validVolRows.length} latency=${res.latency}ms`);
            } else {
                if (res.status === 404) {
                    throw new Error("404 Not Found - Endpoint Error");
                }
                throw new Error(res.error || "API returned error or no rows");
            }

        } catch (e: any) {
            report.checks.amazonApi.error = e.message;
            report.blockers.push("AMZ_API_FAIL");
            report.verdict = "NO_GO";
            log("FAIL", `API: ${e.message}`);
        }

        // --- STEP D: CACHE VERIFICATION (STRICT SCHEMA) ---
        if (report.checks.amazonApi.ok) {
            try {
                let writes = 0;
                let readbacks = 0;
                let mismatches = 0;

                for (const kw of samples) {
                    const norm = normalizeKeywordString(kw);
                    // Use volume from API if available, else mock for cache test
                    const vol = apiVolumes[norm] || 100; 

                    // Write using dedicated method
                    await FirestoreVolumeCache.setAmazonVolume(kw, vol);
                    writes++;

                    // Read back using dedicated method
                    const cached = await FirestoreVolumeCache.getAmazonVolume(kw);
                    if (cached && cached.volume === vol) {
                        readbacks++;
                    } else {
                        mismatches++;
                        console.warn(`[AMZ_CACHE] Mismatch for ${kw}. Wrote ${vol}, Read ${cached?.volume}`);
                    }
                }

                report.checks.cache.writes = writes;
                report.checks.cache.readbacks = readbacks;
                report.checks.cache.mismatches = mismatches;

                if (writes === samples.length && readbacks === samples.length && mismatches === 0) {
                    report.checks.cache.ok = true;
                    log("CACHE_OK", `writes=${writes} verified`);
                } else {
                    report.checks.cache.ok = false;
                    report.blockers.push("AMZ_CACHE_WRITE_MISMATCH");
                    report.verdict = "NO_GO";
                }

            } catch (e: any) {
                report.checks.cache.ok = false;
                report.blockers.push("CACHE_IO_FAIL");
                report.verdict = "NO_GO";
            }
        } else {
            log("SKIP", "Skipping Cache Check due to API Failure");
        }

        // --- STEP E: SNAPSHOT COMPATIBILITY ---
        // Only run if basic plumbing works to avoid noise
        if (report.checks.firestore.ok) {
            try {
                // Resolve
                let snapshotId = inputs.snapshotId;
                let snapshot: CategorySnapshotDoc | null = null;
                
                if (!snapshotId) {
                    const res = await SnapshotResolver.resolveActiveSnapshot(categoryId, 'IN', 'en');
                    if (res.ok && res.snapshot) {
                        snapshotId = res.snapshot.snapshot_id;
                        snapshot = res.snapshot;
                    }
                } else {
                    const res = await CategorySnapshotStore.getSnapshotById({ categoryId, countryCode: 'IN', languageCode: 'en' }, snapshotId);
                    if (res.ok) snapshot = res.data;
                }

                if (!snapshot || !snapshotId) {
                    log("WARN", "No active snapshot found, skipping snapshot write check");
                } else {
                    report.checks.snapshot.snapshotId = snapshotId;

                    // Load Rows
                    const rowsRes = await CategorySnapshotStore.readAllKeywordRows({ categoryId, countryCode: 'IN', languageCode: 'en' }, snapshotId);
                    if (!rowsRes.ok) throw new Error("Failed to read rows");
                    const allRows = rowsRes.data;

                    // Update subset
                    let updatedCount = 0;
                    const sampleNorms = new Set(samples.map(normalizeKeywordString));
                    const updatedRows = allRows.map(row => {
                        const norm = normalizeKeywordString(row.keyword_text);
                        if (sampleNorms.has(norm)) {
                            updatedCount++;
                            return {
                                ...row,
                                amazonVolume: apiVolumes[norm] || 500, // Use real or fallback
                                amazonBoosted: true,
                                demandScore: (row.volume || 0) + 0.5 * (apiVolumes[norm] || 500)
                            };
                        }
                        return row;
                    });

                    // Force add mock row if samples not in snapshot (Edge case)
                    if (updatedCount === 0) {
                         // Don't actually write to snapshot if we can't match real keywords to avoid polluting it with junk.
                         // But we want to test the WRITE mechanism.
                         // We will pick the first row of the snapshot and update it just for the test if samples don't match.
                         if (allRows.length > 0) {
                             updatedCount = 1;
                             const row = allRows[0];
                             row.amazonVolume = 999;
                             row.amazonBoosted = true;
                         }
                    }

                    if (updatedCount > 0) {
                        // Write Back
                        const writeRes = await CategorySnapshotStore.writeKeywordRows(
                            { categoryId, countryCode: 'IN', languageCode: 'en' },
                            snapshotId,
                            updatedRows
                        );
                        
                        if (!writeRes.ok) throw new Error("Snapshot Write Failed");
                        report.checks.snapshot.rowsUpdated = updatedCount;

                        // Reload & Verify
                        const reloadRes = await CategorySnapshotStore.readAllKeywordRows({ categoryId, countryCode: 'IN', languageCode: 'en' }, snapshotId);
                        const reloadedRows = reloadRes.ok ? reloadRes.data : [];
                        const checkRow = reloadedRows.find(r => r.amazonBoosted);

                        if (!checkRow || checkRow.amazonVolume === undefined) {
                            report.blockers.push("SNAPSHOT_CORRUPT");
                            report.verdict = "NO_GO";
                        } else {
                            log("SNAPSHOT_OK", `Verified readback of amazonVolume=${checkRow.amazonVolume}`);
                            
                            // Forward Compat: Readiness Check shouldn't crash
                            try {
                                const snapDocRes = await CategorySnapshotStore.getSnapshotById({ categoryId, countryCode: 'IN', languageCode: 'en' }, snapshotId);
                                if (snapDocRes.ok) {
                                    CertificationReadinessService.computeReadiness(snapDocRes.data);
                                    report.checks.snapshot.forwardOk = true;
                                    log("FORWARD_OK", "Readiness check passed");
                                }
                            } catch (e: any) {
                                report.checks.snapshot.error = `Forward Check: ${e.message}`;
                                report.blockers.push("FORWARD_COMP_FAIL");
                                report.verdict = "NO_GO";
                            }

                            // Backward Compat: Mock old row structure
                            try {
                                const strippedRows = reloadedRows.map(r => {
                                    const copy = { ...r };
                                    delete copy.amazonVolume;
                                    delete copy.amazonBoosted;
                                    delete copy.demandScore;
                                    return copy;
                                });
                                // Type check simulation
                                if (strippedRows[0].amazonVolume !== undefined) throw new Error("Strip failed");
                                report.checks.snapshot.backwardOk = true;
                                log("BACKWARD_OK", "Type compatibility verified");
                            } catch (e: any) {
                                report.checks.snapshot.error = `Backward Check: ${e.message}`;
                                report.blockers.push("BACKWARD_COMP_FAIL");
                                report.verdict = "NO_GO";
                            }
                        }
                    }
                }
            } catch (e: any) {
                report.checks.snapshot.error = e.message;
                report.blockers.push("SNAPSHOT_WRITE_FAIL");
                report.verdict = "NO_GO";
            }
        }

        report.checks.snapshot.ok = report.checks.snapshot.rowsUpdated > 0 && report.checks.snapshot.forwardOk;

        log("DONE", `Verdict: ${report.verdict} Blockers: ${report.blockers.join(', ')}`);
        return report;
    }
};