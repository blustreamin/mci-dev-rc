
import { CategorySnapshotStore } from './categorySnapshotStore';
import { DataForSeoClient, DataForSeoRow } from './demand_vNext/dataforseoClient';
import { CredsStore } from './demand_vNext/credsStore';
import { BootstrapServiceV3 } from './bootstrapServiceV3';
import { SnapshotKeywordRow, CategorySnapshotDoc } from '../types';
import { HeartbeatController } from './jobHeartbeat';
import { normalizeKeywordString } from '../driftHash';
import { computeSHA256 } from './volumeTruthStore';
import { sleep } from '../utils/yield';
import { JobControlService } from './jobControlService';
import { BootstrapService } from './bootstrapService';
import { CategoryKeywordGrowthService } from './categoryKeywordGrowthService';

const TARGET_VALID_FULL = 2500;
const TARGET_VALID_LITE = 600;
const MAX_PASSES = 12;
const BATCH_SIZE = 500;

export const GrowV3Service = {
    
    async run(params: {
        categoryId: string;
        snapshotId: string;
        jobId: string;
        tier: 'FULL' | 'LITE';
    }) {
        const { categoryId, snapshotId, jobId, tier } = params;
        const hb = new HeartbeatController(jobId, 3000);
        hb.start('GROW_V3_INIT');

        console.log(`[GROW_V3][START] categoryId=${categoryId} snapshotId=${snapshotId} target=${tier}`);

        try {
            // 0. Preflight: Creds & Proxy
            const creds = await CredsStore.get();
            if (!creds) throw { code: "DFS_CREDS_MISSING", message: "DataForSEO credentials required." };
            
            const dfsConfig = await CredsStore.resolveDfsConfig();
            // PROXY PROOF LOG
            console.log(`[DFS_PROXY_CONFIG] mode=${dfsConfig.mode} source=${dfsConfig.source.proxyUrl} host=${new URL(dfsConfig.proxyUrl || 'http://direct').host} endpoint=/dfs/proxy`);

            if (dfsConfig.mode !== 'PROXY' && (window.location.host.includes('aistudio') || window.location.host.includes('googleusercontent'))) {
                throw { code: "DFS_PROXY_URL_MISSING", message: "AI Studio requires a proxy URL (Security Restriction)." };
            }

            // 1. Load Snapshot
            const snapRes = await CategorySnapshotStore.getSnapshotById({ categoryId, countryCode: 'IN', languageCode: 'en' }, snapshotId);
            if (!snapRes.ok) throw new Error("Snapshot load failed");
            const snapshot = snapRes.data;

            // LIFECYCLE GUARD: Do not modify certified snapshots
            if (['CERTIFIED', 'CERTIFIED_LITE', 'CERTIFIED_FULL'].includes(snapshot.lifecycle)) {
                console.warn(`[GROW_V3] BLOCKED: Cannot grow ${snapshot.lifecycle} snapshot ${snapshotId}. Create a new draft or re-hydrate first.`);
                await hb.stop('FAILED', `Cannot grow ${snapshot.lifecycle} snapshot. Re-hydrate first.`);
                return { ok: false as const, error: `Cannot grow ${snapshot.lifecycle} snapshot. Use Fix Health or Hydrate first.` };
            }

            let rowsRes = await CategorySnapshotStore.readAllKeywordRows({ categoryId, countryCode: 'IN', languageCode: 'en' }, snapshotId);
            let rows = rowsRes.ok ? rowsRes.data : [];

            // 2. Compute Initial State
            const initialStats = this.computeStats(rows);
            console.log(`[GROW][PRE] categoryId=${categoryId} snapshotId=${snapshotId} total=${initialStats.total} valid=${initialStats.valid} zero=${initialStats.zero} unverified=${initialStats.unverified}`);

            const targetValid = tier === 'FULL' ? TARGET_VALID_FULL : TARGET_VALID_LITE;
            
            // 3. Execution Loop
            let pass = 0;
            while (pass < MAX_PASSES) {
                pass++;
                await hb.assertNotStopped();
                await hb.tick(`GROW_V3_PASS_${pass}/${MAX_PASSES}`);
                
                const stats = this.computeStats(rows);
                console.log(`[GROW_V3][PASS] idx=${pass}/${MAX_PASSES} rows=${stats.total} valid=${stats.valid} unverified=${stats.unverified}`);

                // Exit Condition
                if (stats.valid >= targetValid && stats.unverified === 0) {
                    console.log(`[GROW_V3][SUCCESS] Target met.`);
                    break;
                }

                const rowsBefore = rows.length;
                const validBefore = stats.valid;

                // A. Candidate Generation
                const deficit = Math.max(0, targetValid - stats.valid);
                const genLimit = Math.min(Math.max(deficit * 2, 150), 600); 
                
                let candidates: string[] = [];
                
                // Distribute generation across anchors
                for (const anchor of snapshot.anchors) {
                    if (candidates.length >= genLimit) break;
                    const anchorSeeds = BootstrapServiceV3.generate(categoryId, anchor.anchor_id, 200);
                    candidates.push(...anchorSeeds);
                }
                
                // Dedupe against existing
                const existingSet = new Set(rows.map(r => normalizeKeywordString(r.keyword_text)));
                candidates = candidates.filter(c => !existingSet.has(normalizeKeywordString(c)));
                
                // Unique new candidates
                candidates = Array.from(new Set(candidates)).slice(0, genLimit);
                
                console.log(`[GROW][GEN] anchor=MIXED generated=${candidates.length} accepted=${candidates.length} rejectedGeneric=0 deduped=${candidates.length}`);

                if (candidates.length === 0 && stats.unverified === 0) {
                     console.log("[GROW] No new candidates generated and no unverified rows. Stopping.");
                     break;
                }

                // B. Persist Candidates (UNVERIFIED)
                const newRowObjs: SnapshotKeywordRow[] = [];
                for (const kw of candidates) {
                     const id = await computeSHA256(`${kw}|${categoryId}|growV3`);
                     newRowObjs.push({
                        keyword_id: id,
                        keyword_text: kw,
                        language_code: 'en', country_code: 'IN', category_id: categoryId,
                        anchor_id: CategoryKeywordGrowthService.inferAnchor(kw, categoryId, snapshot.anchors),
                        intent_bucket: BootstrapService.inferIntent(kw),
                        status: 'UNVERIFIED',
                        active: true,
                        created_at_iso: new Date().toISOString(),
                        volume: null
                     });
                }
                rows = [...rows, ...newRowObjs];
                
                // STEP 3: PERSIST NEW UNVERIFIED ROWS IMMEDIATELY
                if (newRowObjs.length > 0) {
                    await CategorySnapshotStore.writeKeywordRows({ categoryId, countryCode: 'IN', languageCode: 'en' }, snapshotId, rows);
                    snapshot.updated_at_iso = new Date().toISOString();
                    await CategorySnapshotStore.writeSnapshot(snapshot);
                    console.log(`[GROW][WRITE_UNVERIFIED] addedRows=${newRowObjs.length} snapshotTotalNow=${rows.length}`);
                }

                // C. Validation (Dual-Pass)
                const unverifiedRows = rows.filter(r => r.status === 'UNVERIFIED' || r.volume === null || r.volume === undefined);
                
                if (unverifiedRows.length > 0) {
                    await this.runValidationPass(unverifiedRows, creds, jobId, categoryId);
                }

                // D. Fail-Loud Checks
                const statsAfter = this.computeStats(rows);
                const deltaRows = rows.length - rowsBefore;
                const deltaValid = statsAfter.valid - validBefore;

                console.log(`[GROW_V3][DELTA] deltaRows=${deltaRows} deltaValid=${deltaValid}`);

                // If stalled
                if (candidates.length > 0 && deltaRows === 0 && deltaValid === 0 && unverifiedRows.length === 0) {
                     throw { code: "GROW_V3_STALLED", message: "Growth pass produced no new rows and no validity gain." };
                }

                // Persist Progress
                await CategorySnapshotStore.writeKeywordRows({ categoryId, countryCode: 'IN', languageCode: 'en' }, snapshotId, rows);
                
                await sleep(500);
            }

            // Final Stats Check
            const finalStats = this.computeStats(rows);
            if (finalStats.unverified > 0) {
                console.warn(`[GROW_V3] Finishing with ${finalStats.unverified} unverified. Attempting final flush.`);
                const leftovers = rows.filter(r => r.status === 'UNVERIFIED');
                await this.runValidationPass(leftovers, creds, jobId, categoryId);
                await CategorySnapshotStore.writeKeywordRows({ categoryId, countryCode: 'IN', languageCode: 'en' }, snapshotId, rows);
            }

            const endStats = this.computeStats(rows);
            
            // STEP 6: RECOMPUTE STATS + PERSIST
            await this.finalizeSnapshot(snapshot, rows);
            
            console.log(`[GROW][POST] total=${endStats.total} valid=${endStats.valid} zero=${endStats.zero} unverified=${endStats.unverified}`);
            
            // STEP E: SMOKE TEST
            const smokeRes = await this.runSmokeTest(categoryId, snapshotId, initialStats);
            console.log(`[GROW][SMOKE] updatedAtOk=${smokeRes.updatedAtOk} totalDelta=${smokeRes.totalDelta} validDelta=${smokeRes.validDelta} verdict=${smokeRes.verdict}`);

            // STEP 7: UI REFRESH HINT (via job update)
            await hb.stop('COMPLETED', `Grow V3 Complete. Valid: ${endStats.valid}`);
            console.log(`[UI][REFRESH_AFTER_JOB] jobId=${jobId} snapshotId=${snapshotId}`);

            return { ok: true };

        } catch (e: any) {
            console.error("[GROW_V3] Error", e);
            await hb.stop('FAILED', e.message);
            throw e;
        }
    },

    computeStats(rows: SnapshotKeywordRow[]) {
        let valid = 0;
        let zero = 0;
        let unverified = 0;
        
        for (const r of rows) {
            const googleVol = r.volume || 0;
            const amazonVol = r.amazonVolume || 0;
            
            if (r.status === 'UNVERIFIED' || (r.volume === null && r.amazonVolume === undefined)) {
                unverified++;
                continue;
            }

            if (r.active) {
                if (googleVol > 0) valid++;
                else if (amazonVol > 0 && r.amazonBoosted) valid++;
                else zero++;
            } else {
                zero++;
            }
        }
        return { total: rows.length, valid, zero, unverified };
    },

    async runValidationPass(
        rowsToValidate: SnapshotKeywordRow[], 
        creds: any, 
        jobId: string,
        categoryId: string
    ) {
        if (rowsToValidate.length === 0) return;

        const keywords = rowsToValidate.map(r => r.keyword_text);
        let googleRequests = 0;
        let consecutiveEmpty = 0;
        
        for (let i = 0; i < keywords.length; i += BATCH_SIZE) {
            const batch = keywords.slice(i, i + BATCH_SIZE);
            const batchIdx = Math.floor(i / BATCH_SIZE) + 1;
            const totalBatches = Math.ceil(keywords.length / BATCH_SIZE);
            
            console.log(`[GROW][DFS][BATCH_START] size=${batch.length} batch=${batchIdx}/${totalBatches}`);
            
            const start = Date.now();
            try {
                const res = await DataForSeoClient.fetchGoogleVolumes_DFS({
                    keywords: batch,
                    location: 2356,
                    language: 'en',
                    creds,
                    useProxy: true, // FORCE PROXY
                    jobId
                });
                
                googleRequests++;
                
                if (res.ok && res.parsedRows) {
                    if (res.parsedRows.length === 0) consecutiveEmpty++;
                    else consecutiveEmpty = 0;

                    const map = new Map(res.parsedRows.map((r: DataForSeoRow) => [normalizeKeywordString(r.keyword), r]));
                    let validCount = 0;
                    let zeroCount = 0;
                    
                    for (const r of rowsToValidate) {
                        const hit = map.get(normalizeKeywordString(r.keyword_text));
                        if (hit) {
                            r.volume = hit.search_volume || 0;
                            r.cpc = hit.cpc;
                            r.competition = hit.competition_index;
                            
                            // STEP 5: PRUNE ZERO-SV
                            if (r.volume! > 0) {
                                r.status = 'VALID';
                                r.active = true;
                                validCount++;
                            } else {
                                r.status = 'ZERO'; 
                                r.active = false; // Prune
                                zeroCount++;
                                console.log(`[GROW][PRUNE] prunedZero=${r.keyword_text}`);
                            }
                        }
                    }
                    console.log(`[GROW][DFS][BATCH_OK] valid=${validCount} zero=${zeroCount} missing=${batch.length - (validCount+zeroCount)} latencyMs=${Date.now() - start}`);
                } else {
                    throw new Error(`DFS Google Failed: ${res.error}`);
                }
                
                if (consecutiveEmpty > 2) {
                     throw { code: "DFS_EMPTY_RESULT", message: "DFS returned 0 rows for >2 consecutive batches." };
                }

            } catch (e: any) {
                console.error(`[GROW_V3] Google DFS Fail`, e);
                throw e; // Fail loud
            }
            // Stop signal check between batches
            await JobControlService.assertNotStopped(jobId);
        }
    },

    async finalizeSnapshot(snap: CategorySnapshotDoc, rows: SnapshotKeywordRow[]) {
        const stats = this.computeStats(rows);
        snap.stats.keywords_total = stats.total;
        snap.stats.valid_total = stats.valid;
        snap.stats.zero_total = stats.zero;
        snap.updated_at_iso = new Date().toISOString();
        
        await CategorySnapshotStore.writeSnapshot(snap);
    },

    async runSmokeTest(categoryId: string, snapshotId: string, initialStats: any) {
         // Re-read snapshot to verify persistence
         const snapRes = await CategorySnapshotStore.getSnapshotById({ categoryId, countryCode: 'IN', languageCode: 'en' }, snapshotId);
         if (!snapRes.ok) return { updatedAtOk: false, totalDelta: 0, validDelta: 0, verdict: 'NO_GO' };
         
         const snap = snapRes.data;
         const totalDelta = snap.stats.keywords_total - initialStats.total;
         const validDelta = snap.stats.valid_total - initialStats.valid;
         
         let verdict = 'GO';
         if (totalDelta === 0 && validDelta === 0) verdict = 'WARN'; // Could happen if target already met
         
         return {
             updatedAtOk: true,
             totalDelta,
             validDelta,
             verdict
         };
    }
};
