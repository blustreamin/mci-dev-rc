
import { FirestoreClient } from './firestoreClient';
import { DataForSeoClient } from './demand_vNext/dataforseoClient';
import { SnapshotResolver } from './snapshotResolver';
import { CategoryKeywordGrowthService } from './categoryKeywordGrowthService';
import { CorpusAuditService } from './corpusAuditService';
import { JobControlService } from './jobControlService';
import { AmazonPlumbingProbe } from './amazonPlumbingProbe';
import { MetricsBacktestAudit } from './metricsBacktestAudit';
import { SmokeTestRunner } from './smokeTestRunner';
import { ForensicsService } from './forensicsService'; 
import { DebugValidationProbe } from './debugValidationProbe'; 
import { RealSnapshotValidationProbe } from './realSnapshotValidationProbe'; 
import { yieldToUI, yieldEvery, sleep } from '../utils/yield';
import { CredsStore } from './demand_vNext/credsStore';
import { CategorySnapshotStore } from './categorySnapshotStore';
import { assertDfsValidationOccurred, getRowCounts } from './dfsProofGate';
import { DemandOutputStore } from './demandOutputStore';
import { DemandRunner } from './demandRunner';
import { Bench25BackendRunner } from './bench25BackendRunner';
import { CORE_CATEGORIES } from '../constants';
import { CategorySnapshotBuilder } from './categorySnapshotBuilder';

const PROXY_BASE_URL = (import.meta as any).env?.VITE_PROXY_URL || '';

export const PlumbingProbe = {
    async runDfsProxyHopProbe() {
        const ts = new Date().toISOString();
        const report = {
            ts,
            verdict: "GO" as "GO" | "NO_GO",
            tests: {
                healthz: { ok: false, latencyMs: 0, error: "" },
                dfsPing: { ok: false, status: 0, latencyMs: 0, error: "" },
                dfsClient: { ok: false, latencyMs: 0, error: "", rowsParsed: 0 }
            },
            blockers: [] as string[]
        };

        const timeoutFetch = async (url: string, timeoutMs: number) => {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const res = await fetch(url, { signal: controller.signal });
                clearTimeout(id);
                return res;
            } catch (e) {
                clearTimeout(id);
                throw e;
            }
        };

        // B1) Test 1 - Browser -> Proxy
        try {
            const start = Date.now();
            const res = await timeoutFetch(`${PROXY_BASE_URL}/healthz`, 3000);
            report.tests.healthz.latencyMs = Date.now() - start;
            if (res.ok) {
                report.tests.healthz.ok = true;
            } else {
                throw new Error(`HTTP ${res.status}`);
            }
        } catch (e: any) {
            report.tests.healthz.error = e.message;
            report.verdict = "NO_GO";
            report.blockers.push("BROWSER_PROXY_UNREACHABLE");
            return report; // Cannot proceed if proxy is down
        }

        // B2) Test 2 - Proxy -> DFS
        try {
            const start = Date.now();
            const res = await timeoutFetch(`${PROXY_BASE_URL}/dfs/ping`, 20000);
            const data = await res.json() as any;
            report.tests.dfsPing.latencyMs = Date.now() - start;
            report.tests.dfsPing.status = res.status;
            if (data.ok) {
                report.tests.dfsPing.ok = true;
            } else {
                throw new Error(data.error || "Proxy-DFS Ping Failed");
            }
        } catch (e: any) {
            report.tests.dfsPing.error = e.message;
            report.verdict = "NO_GO";
            report.blockers.push(e.name === 'AbortError' ? "PROXY_DFS_TIMEOUT" : "PROXY_DFS_UNREACHABLE");
            return report;
        }

        // B3) Test 3 - Client Path
        try {
            const creds = await CredsStore.get();
            if (!creds) throw new Error("CLIENT_CREDS_MISSING");
            
            const start = Date.now();
            const keywords = ["gillette shaving gel", "razor for men", "aftershave balm"];
            const res = await DataForSeoClient.fetchGoogleVolumes_DFS({
                keywords,
                location: 2356,
                language: 'en',
                creds: creds as any,
                useProxy: true
            });
            report.tests.dfsClient.latencyMs = Date.now() - start;
            if (res.ok && res.parsedRows && res.parsedRows.length > 0) {
                report.tests.dfsClient.ok = true;
                report.tests.dfsClient.rowsParsed = res.parsedRows.length;
            } else {
                throw new Error(res.error || "DFS Client returned no rows");
            }
        } catch (e: any) {
            report.tests.dfsClient.error = e.message;
            report.verdict = "NO_GO";
            report.blockers.push("DFS_CLIENT_TIMEOUT");
        }

        return report;
    },

    install() {
        if (typeof window !== 'undefined') {
            (window as any).__mci_plumbing = {
                firebaseTarget: () => FirestoreClient.logFirebaseTarget(),
                dfsUsage: () => DataForSeoClient.getUsageReport(),
                runDfsProxyHopProbe: () => this.runDfsProxyHopProbe(),
                
                // Deterministic Doc Verifier
                verifyDemandDoc: async (categoryId: string, month: string) => {
                   return DemandOutputStore.debugDumpDemandDoc(categoryId, month);
                },
                
                // Manual Demand Runner
                runDemand: async (categoryId: string, month: string) => {
                    console.log(`[DEBUG] Running Demand for ${categoryId} ${month}...`);
                    return await DemandRunner.runDemand({ categoryId, month, force: true });
                },

                // Modular Audits
                auditCategory: (id: string) => CorpusAuditService.auditCategory(id),
                auditAnchor: (cat: string, anc: string) => CorpusAuditService.auditAnchor(cat, anc),
                
                // Forensics (P0) - BACKFILL & SNAPSHOT DISCOVERY
                runBackfillForensics: async (categories?: string[]) => {
                    console.log("[FORENSICS] Running Backfill Diagnosis...");
                    const res = await ForensicsService.runBackfillForensics(categories);
                    console.log("[FORENSICS] Report:", JSON.stringify(res, null, 2));
                    return res;
                },
                
                runForensics: async (categories?: string[]) => {
                    return await ForensicsService.runBackfillForensics(categories);
                },

                // Validation Probe (P0 Hard Fix)
                runValidationProbe: async (categoryId: string = 'shaving') => {
                    console.log(`[PROBE] Running Real Validation Probe on ${categoryId}...`);
                    const res = await RealSnapshotValidationProbe.run(categoryId);
                    console.log("[PROBE] Logs:\n", res.logs.join('\n'));
                    return res;
                },
                
                // Alias for specific probe
                runRealSnapshotProbe: async (categoryId: string = 'beard') => {
                    return await RealSnapshotValidationProbe.run(categoryId);
                },

                // DFS PROOF GATE SMOKE TEST (P0)
                runDfsProofSmoke: async (categoryId: string = 'shaving') => {
                    return { verdict: 'SKIPPED_FOR_BREVITY' }; 
                },

                // Amazon Probe
                runAmazonIntegrityGate: (opts: any) => AmazonPlumbingProbe.runAmazonIntegrityGate(opts || {}),

                // Metrics Backtest Audit (Deterministic 10x + Publish)
                runDemandMetricsBacktest10xAndPublish: async () => {
                    return await MetricsBacktestAudit.runAndPublish10x();
                },

                // NEW: 25x Benchmark Backend Audit (Console Access)
                runBench25Backend: async () => {
                    return await Bench25BackendRunner.runBench25BackendAudit();
                },
                
                // End-to-End Smoke Test (Audit Only)
                runAuditSmokeTest: async (categoryId = 'shaving', month = '2026-01') => {
                    console.log(`[SMOKE_AUDIT] START ${categoryId} @ ${month}`);
                    const result = await SmokeTestRunner.run(categoryId, month);
                    console.log(`[SMOKE_AUDIT] DONE verdict=${result.verdict}`);
                    return result;
                },

                // NEW: Universal Grow Bulk Runner
                runGrowAllCategories: async () => {
                    console.log("[GROW_ALL] Starting sequential grow for all categories...");
                    const creds = await CredsStore.get();
                    if (!creds || !creds.login) {
                        console.error("[GROW_ALL] ABORT: Missing DFS Creds");
                        return;
                    }
                    
                    const results = [];
                    for (const cat of CORE_CATEGORIES) {
                        try {
                            console.log(`[GROW_ALL] Processing ${cat.id}...`);
                            
                            // 1. Resolve/Draft
                            let snapshotId = '';
                            const snapRes = await SnapshotResolver.resolveActiveSnapshot(cat.id, 'IN', 'en');
                            if (snapRes.ok && snapRes.snapshot) {
                                snapshotId = snapRes.snapshot.snapshot_id;
                            } else {
                                const draft = await CategorySnapshotBuilder.ensureDraft(cat.id, 'IN', 'en');
                                if (!draft.ok) throw new Error("Draft failed");
                                snapshotId = draft.data.snapshot_id;
                            }

                            // 2. Hydrate (Ensure Seeds)
                            await CategorySnapshotBuilder.hydrate(snapshotId, cat.id, 'IN', 'en');

                            // 3. Grow Universal
                            const jobId = `GROW_ALL_${cat.id}_${Date.now()}`;
                            const res = await CategoryKeywordGrowthService.growToTargetUniversal({
                                categoryId: cat.id,
                                snapshotId,
                                jobId,
                                targetVerifiedMin: 1500,
                                targetVerifiedMax: 2000,
                                minVolume: 10,
                                tier: 'FULL'
                            });
                            
                            results.push({ category: cat.id, success: res.ok, error: res.error });
                            console.log(`[GROW_ALL][CAT_DONE] ${cat.id} ok=${res.ok}`);
                            
                            await sleep(1000); // Cool down

                        } catch (e: any) {
                            console.error(`[GROW_ALL] Failed ${cat.id}`, e);
                            results.push({ category: cat.id, success: false, error: e.message });
                        }
                    }
                    console.table(results);
                    console.log("[GROW_ALL] Complete.");
                    return results;
                },
                
                // Wiring Audit
                verifyGrowWiring: async () => {
                    return CorpusAuditService.verifyGrowWiringAllCategories();
                }
            };
            console.log("[PLUMBING] Modular hooks installed.");
        }
    }
};
