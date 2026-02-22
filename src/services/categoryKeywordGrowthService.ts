
import { CategorySnapshotStore } from './categorySnapshotStore';
import { DataForSeoClient, DataForSeoRow } from './demand_vNext/dataforseoClient';
import { CredsStore } from './demand_vNext/credsStore';
import { BootstrapServiceV3 } from './bootstrapServiceV3';
import { JobControlService } from './jobControlService';
import { HeartbeatController } from './jobHeartbeat';
import { SnapshotResolver } from './snapshotResolver';
import { CategorySnapshotBuilder } from './categorySnapshotBuilder';
import { SnapshotKeywordRow, CategorySnapshotDoc } from '../types';
import { normalizeKeywordString } from '../driftHash';
import { computeSHA256 } from './volumeTruthStore';
import { sleep } from '../utils/yield';
import { CategoryKeywordGuard, HEAD_TERMS } from './categoryKeywordGuard';
import { LiteVerificationRunner } from './liteVerificationRunner';
import { BootstrapService } from './bootstrapService';

export const CategoryKeywordGrowthService = {
    
    // --- CANONICAL UNIVERSAL GROW ---
    async growToTargetUniversal(params: {
        categoryId: string;
        snapshotId: string;
        jobId: string;
        targetVerifiedMin: number;
        targetVerifiedMax: number;
        minVolume: number;
        tier: 'LITE' | 'FULL';
        maxAttempts?: number;
    }) {
        const { categoryId, snapshotId, jobId, targetVerifiedMin, minVolume } = params;
        const maxAttempts = params.maxAttempts || 15; // More passes for DFS discovery rotation
        const BATCH_SIZE = 500;
        
        console.log(`[GROW_UNIVERSAL] Starting for ${categoryId} target=${targetVerifiedMin} minVol=${minVolume}`);

        const hb = new HeartbeatController(jobId, { categoryId, snapshotId });
        hb.start('GROW_UNIVERSAL_INIT');

        try {
            // 0. Preflight: Creds & Proxy
            const creds = await CredsStore.get();
            if (!creds || !creds.login) throw { code: "DFS_CREDS_MISSING", message: "DataForSEO credentials required." };
            
            const dfsConfig = await CredsStore.resolveDfsConfig();
            console.log(`[DFS_PROXY_CONFIG] mode=${dfsConfig.mode} source=${dfsConfig.source.proxyUrl} host=${new URL(dfsConfig.proxyUrl || 'http://direct').host} endpoint=/dfs/proxy`);

            // AI Studio proxy check removed — running on Vercel

            // 1. Load Snapshot
            const snapRes = await CategorySnapshotStore.getSnapshotById({ categoryId, countryCode: 'IN', languageCode: 'en' }, snapshotId);
            if (!snapRes.ok) throw new Error("Snapshot load failed");
            const snapshot = snapRes.data;

            // LIFECYCLE GUARD: Skip for rebuild — allow re-growing certified snapshots
            // During Flush & Rebuild, snapshots start fresh as DRAFT so this shouldn't trigger,
            // but if it does (e.g. from multiple runs), downgrade lifecycle to allow re-processing
            if (['CERTIFIED', 'CERTIFIED_LITE', 'CERTIFIED_FULL'].includes(snapshot.lifecycle)) {
                console.warn(`[GROW_UNIVERSAL] Downgrading ${snapshot.lifecycle} -> HYDRATED for rebuild`);
                snapshot.lifecycle = 'HYDRATED';
                await CategorySnapshotStore.writeSnapshot(snapshot);
            }

            let rowsRes = await CategorySnapshotStore.readAllKeywordRows({ categoryId, countryCode: 'IN', languageCode: 'en' }, snapshotId);
            let rows = rowsRes.ok ? rowsRes.data : [];

            // 2. Loop
            let attempt = 0;
            while (attempt < maxAttempts) {
                attempt++;
                // hb.assertNotStopped disabled for rebuild resilience
                await hb.tick(`Grow Pass ${attempt}/${maxAttempts}`, { progress: { processed: attempt, total: maxAttempts } });
                
                const stats = this.computeStats(rows);
                if (stats.valid >= targetVerifiedMin && stats.unverified === 0) {
                    console.log(`[GROW_UNIVERSAL] Target met: ${stats.valid} valid.`);
                    break;
                }

                // A. DFS DISCOVERY-FIRST APPROACH
                // Instead of generating synthetic templates, use DFS to find REAL keywords
                // that people actually search for, with real volumes.
                let candidates: string[] = [];
                const existingSet = new Set(rows.map(r => normalizeKeywordString(r.keyword_text)));

                // A1. PRIMARY: DFS Keywords-for-Keywords Discovery WITH VOLUMES
                // DFS returns keywords with real volumes - use them directly
                let dfsDiscoveredRows: any[] = [];
                try {
                    const discoverySeeds = BootstrapServiceV3.generateDiscoverySeeds(categoryId);
                    const seedsPerBatch = 15;
                    const offset = ((attempt - 1) * seedsPerBatch) % discoverySeeds.length;
                    const seedBatch = discoverySeeds.slice(offset, offset + seedsPerBatch);
                    
                    if (seedBatch.length > 0) {
                        console.log(`[GROW_UNIVERSAL][DFS_DISCOVER] Pass ${attempt}: ${seedBatch.length} seeds -> DFS`);
                        const discoveredWithVol = await DataForSeoClient.discoverKeywordsWithVolume({
                            keywords: seedBatch,
                            location: 2356,
                            language: 'en',
                            creds,
                            jobId
                        });
                        
                        // Filter through guard and dedupe - these already have volume > 0
                        for (const dfsRow of discoveredWithVol) {
                            const kw = dfsRow.keyword;
                            const norm = kw.toLowerCase().trim();
                            // Relaxed guard for DFS-discovered keywords:
                            // DFS already returned these as related to our seeds, so skip head-term check
                            // Only block: female terms, too short, year tokens
                            const tokens = norm.split(/\s+/);
                            const FEMALE = new Set(["women","womens","woman","female","ladies","girl","girls","she","her","bridal","bride","maternity","pregnancy","lipstick","mascara","foundation","eyeliner","bra","panty","lingerie","sanitary","period","menstrual","vagina","vaginal"]);
                            const hasFemale = tokens.some(t => FEMALE.has(t));
                            const tooShort = norm.length < 3;
                            const hasYear = /\b(2023|2024|2025|2026)\b/.test(norm);
                            
                            if (!hasFemale && !tooShort && !hasYear && !existingSet.has(normalizeKeywordString(kw))) {
                                candidates.push(kw);
                                dfsDiscoveredRows.push(dfsRow);
                            }
                        }
                        console.log(`[GROW_UNIVERSAL][DFS_DISCOVER] total=${discoveredWithVol.length} passedGuard=${dfsDiscoveredRows.length}`);
                    }
                } catch (e: any) {
                    console.warn(`[GROW_UNIVERSAL][DFS_DISCOVER] Failed: ${e.message}`);
                }
                await sleep(300);

                // A2. FALLBACK: Template generation (only if DFS discovery yielded < 50 candidates)
                if (candidates.length < 50) {
                    const anchorStats = this.getAnchorStats(rows, snapshot.anchors);
                    for (const anchor of snapshot.anchors) {
                        const s = anchorStats[anchor.anchor_id] || { valid: 0, total: 0 };
                        const deficit = Math.max(0, 40 - s.valid);
                        if (deficit > 0) {
                            const seeds = BootstrapServiceV3.generate(categoryId, anchor.anchor_id, 500);
                            const filtered = seeds.filter(k => {
                                const guard = CategoryKeywordGuard.isSpecific(k, categoryId);
                                return guard.ok && !existingSet.has(normalizeKeywordString(k));
                            });
                            candidates.push(...filtered);
                        }
                    }
                }
                
                candidates = Array.from(new Set(candidates)).slice(0, 5000);

                if (candidates.length === 0 && stats.unverified === 0) {
                    console.log("[GROW_UNIVERSAL] No new candidates and no unverified. Stopping.");
                    break;
                }

                // B. Persist - use DFS volumes directly for discovered keywords
                const dfsVolumeMap = new Map(dfsDiscoveredRows.map(r => [normalizeKeywordString(r.keyword), r]));
                const newRowObjs: SnapshotKeywordRow[] = [];
                for (const kw of candidates) {
                     const id = await computeSHA256(`${kw}|${categoryId}|univ`);
                     const dfsHit = dfsVolumeMap.get(normalizeKeywordString(kw));
                     newRowObjs.push({
                        keyword_id: id,
                        keyword_text: kw,
                        language_code: 'en', country_code: 'IN', category_id: categoryId,
                        anchor_id: this.inferAnchor(kw, categoryId, snapshot.anchors),
                        intent_bucket: BootstrapService.inferIntent(kw),
                        status: dfsHit ? 'VALID' : 'UNVERIFIED',
                        active: true,
                        created_at_iso: new Date().toISOString(),
                        volume: dfsHit?.search_volume || null,
                        cpc: dfsHit?.cpc || undefined,
                        competition: dfsHit?.competition_index || undefined
                     });
                }
                const preValidated = newRowObjs.filter(r => r.status === 'VALID').length;
                console.log(`[GROW_UNIVERSAL][PERSIST] ${newRowObjs.length} new rows, ${preValidated} pre-validated with DFS volume`);
                
                if (newRowObjs.length > 0) {
                    rows = [...rows, ...newRowObjs];
                    const writeRes = await CategorySnapshotStore.writeKeywordRows({ categoryId, countryCode: 'IN', languageCode: 'en' }, snapshotId, rows);
                    if (!writeRes.ok) throw { code: "SNAPSHOT_WRITE_NOOP", message: "Failed to persist candidates" };
                }

                // C. Validate (Batched) — skip rows already validated by DFS discovery
                const unverifiedRows = rows.filter(r => r.status === 'UNVERIFIED' && r.volume === null);
                if (unverifiedRows.length > 0) {
                    await this.runValidationLoop(unverifiedRows, creds, jobId, categoryId);
                }

                // D. Prune & Recompute
                let changed = false;
                rows.forEach(r => {
                    if (r.volume !== null && r.volume !== undefined) {
                        const v = r.volume;
                        const amz = r.amazonVolume || 0;
                        if (v === 0 && amz === 0) {
                            if (r.active !== false || r.status !== 'ZERO') {
                                r.status = 'ZERO';
                                r.active = false;
                                changed = true;
                            }
                        } else if (v > 0 || amz > 0) {
                            if (r.status !== 'VALID' || r.active !== true) {
                                r.status = 'VALID';
                                r.active = true;
                                changed = true;
                            }
                        }
                    }
                });

                if (changed || newRowObjs.length > 0) {
                    await CategorySnapshotStore.writeKeywordRows({ categoryId, countryCode: 'IN', languageCode: 'en' }, snapshotId, rows);
                    await this.finalizeSnapshotStats(snapshot, rows);
                }

                // E. Check Progress
                const finalStats = this.computeStats(rows);
                if (finalStats.valid === stats.valid && candidates.length > 0) {
                    console.warn("[GROW_UNIVERSAL] Warning: Added candidates but valid count did not increase.");
                }

                await sleep(500);
            }

            await hb.stop('COMPLETED', `Grow complete: ${this.computeStats(rows).valid} valid keywords`);
            return { ok: true };

        } catch (e: any) {
            console.error("[GROW_UNIVERSAL] Failed", e);
            if (e.message !== 'STOPPED') {
                await hb.stop('FAILED', e.message || e.code || 'Unknown error').catch(() => {});
            }
            return { ok: false, error: e.message || e.code };
        }
    },

    // --- SUPPORT METHODS ---

    async runValidationLoop(rows: SnapshotKeywordRow[], creds: any, jobId: string, categoryId: string) {
        const BATCH_SIZE = 500;
        let emptyBatchCount = 0;

        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
            const batch = rows.slice(i, i + BATCH_SIZE);
            const keywords = batch.map(r => r.keyword_text);
            
            try {
                const res = await DataForSeoClient.fetchGoogleVolumes_DFS({
                    keywords: keywords,
                    location: 2356,
                    language: 'en',
                    creds,
                    useProxy: true, jobId, categoryId
                });

                if (res.ok && res.parsedRows) {
                    if (res.parsedRows.length === 0) emptyBatchCount++;
                    else emptyBatchCount = 0;

                    if (emptyBatchCount >= 2) throw { code: "DFS_EMPTY_RESULT", message: "DFS returned empty results for 2 consecutive batches." };

                    const map = new Map(res.parsedRows.map((r: any) => [normalizeKeywordString(r.keyword), r]));
                    
                    batch.forEach(r => {
                        const hit = map.get(normalizeKeywordString(r.keyword_text));
                        if (hit) {
                            r.volume = hit.search_volume || 0;
                            r.cpc = hit.cpc;
                            r.competition = hit.competition_index;
                            // Mark as VALID if volume > 0, ZERO otherwise
                            r.status = (r.volume && r.volume > 0) ? 'VALID' : 'ZERO';
                        } else {
                            // DFS returned no data for this keyword
                            r.status = 'ZERO';
                            r.volume = 0;
                        }
                    });
                }
            } catch (e) {
                console.error("[GROW_UNIVERSAL] Validation batch failed", e);
                throw e; 
            }
            await sleep(200);
            // Stop signal check between batches
            // JobControlService.assertNotStopped disabled for rebuild resilience
        }
    },

    computeStats(rows: SnapshotKeywordRow[]) {
        let valid = 0, zero = 0, unverified = 0;
        rows.forEach(r => {
            if (r.status === 'UNVERIFIED' || r.volume === null || r.volume === undefined) unverified++;
            else if (r.status === 'VALID' || (r.active && (r.volume || 0) > 0)) valid++;
            else if (r.active && (r.amazonVolume || 0) > 0) valid++;
            else zero++;
        });
        return { valid, zero, unverified, total: rows.length };
    },

    getAnchorStats(rows: SnapshotKeywordRow[], anchors: any[]) {
        const map: Record<string, { valid: number, total: number }> = {};
        anchors.forEach(a => map[a.anchor_id] = { valid: 0, total: 0 });
        rows.forEach(r => {
            if (!map[r.anchor_id]) map[r.anchor_id] = { valid: 0, total: 0 };
            map[r.anchor_id].total++;
            if (r.active && ((r.volume||0) > 0 || (r.amazonVolume||0) > 0)) {
                map[r.anchor_id].valid++;
            }
        });
        return map;
    },

    /**
     * Semantically assign a keyword to the best-matching anchor.
     * Uses HEAD_TERMS dictionary and anchor name tokens for matching.
     * Falls back to round-robin distribution if no semantic match.
     */
    inferAnchor(keyword: string, categoryId: string, anchors: any[]): string {
        if (!anchors || anchors.length === 0) return 'Unknown';
        const kw = keyword.toLowerCase();
        
        // Strategy 1: Match keyword tokens against anchor name tokens
        for (const anchor of anchors) {
            const anchorName = (anchor.anchor_id || anchor.name || '').toLowerCase();
            const anchorTokens = anchorName.split(/[\s&/]+/).filter((t: string) => t.length > 3);
            for (const token of anchorTokens) {
                if (kw.includes(token)) {
                    return anchor.anchor_id || anchor.name;
                }
            }
        }

        // Strategy 2: Intent-based distribution
        const intent = BootstrapService.inferIntent(keyword);
        if (intent === 'Decision' || intent === 'Consideration') {
            return anchors[0].anchor_id || anchors[0].name;
        }
        if (intent === 'Problem') {
            return anchors[Math.min(1, anchors.length - 1)].anchor_id || anchors[Math.min(1, anchors.length - 1)].name;
        }

        // Strategy 3: Deterministic hash distribution
        let hash = 0;
        for (let i = 0; i < kw.length; i++) {
            hash = ((hash << 5) - hash + kw.charCodeAt(i)) | 0;
        }
        const idx = Math.abs(hash) % anchors.length;
        return anchors[idx].anchor_id || anchors[idx].name;
    },

    // --- WRAPPERS ---

    async growCategory(categoryId: string, snapshotId: string, target: number, _opts?: any, jobId?: string) {
        return this.growToTargetUniversal({
            categoryId, snapshotId, jobId: jobId || 'manual_grow',
            targetVerifiedMin: target, targetVerifiedMax: target * 1.2, minVolume: 10, tier: 'FULL'
        });
    },

    async growV3ToTarget(params: { categoryId: string; snapshotId: string; jobId: string; targetVerifiedMin: number; targetVerifiedMax: number; minVolume: number; }) {
         return this.growToTargetUniversal({
             ...params,
             tier: 'FULL'
         });
    },

    async ensureAnchorQuotaAndValidate(categoryId: string, snapshotId: string, opts: { tier: string } | undefined, jobId: string) {
        const tier = (opts?.tier === 'LITE') ? 'LITE' : 'FULL';
        const target = tier === 'FULL' ? 500 : 200; // Lowered: realistic with DFS discovery
        return this.growToTargetUniversal({
            categoryId, snapshotId, jobId,
            targetVerifiedMin: target, targetVerifiedMax: target * 1.5, minVolume: 10, tier
        });
    },
    
    async amazonBoostBackfill(categoryId: string, snapshotId: string, tier: 'LITE' | 'FULL', jobId: string) {
        return this.growToTargetUniversal({
            categoryId, snapshotId, jobId,
            targetVerifiedMin: 1500, targetVerifiedMax: 3000, minVolume: 10, tier
        });
    },

    async validateSnapshot(categoryId: string, snapshotId: string, country: string, lang: string, _opts?: any, jobId?: string) {
        if (!jobId) {
            // No job tracking — direct call (backward compat)
            return await LiteVerificationRunner.runLiteVerification(snapshotId, categoryId, country, lang);
        }

        const hb = new HeartbeatController(jobId, { categoryId, snapshotId, action: 'VALIDATE' });
        hb.start('VALIDATE_INIT');

        try {
            await hb.tick('VALIDATE_RUNNING');
            const result = await LiteVerificationRunner.runLiteVerification(snapshotId, categoryId, country, lang);
            await hb.stop('COMPLETED', `Validation ${result.status}: ${result.validatedCount || 0} validated`);
            return result;
        } catch (e: any) {
            if (e.message !== 'STOPPED') {
                await hb.stop('FAILED', e.message || 'Validation failed').catch(() => {});
            }
            throw e;
        }
    },

    async finalizeSnapshotStats(snap: CategorySnapshotDoc, rows: SnapshotKeywordRow[]) {
        const stats = this.computeStats(rows);
        snap.stats.keywords_total = stats.total;
        snap.stats.valid_total = stats.valid;
        snap.stats.zero_total = stats.zero;
        snap.stats.validated_total = stats.total - stats.unverified;
        await CategorySnapshotStore.writeSnapshot(snap);
    },
    
    async rebuildCategorySnapshotV3(categoryId: string, opts: { targetValidPerAnchor: number, tier: 'LITE' | 'FULL' }, jobId: string) {
         try {
            let snapId = '';
            const existing = await SnapshotResolver.resolveActiveSnapshot(categoryId, 'IN', 'en');
            if (existing.ok && existing.snapshot) {
                // For rebuild, always create fresh draft — don't reuse certified snapshot
                const draft = await CategorySnapshotBuilder.ensureDraft(categoryId, 'IN', 'en');
                if (!draft.ok) throw new Error("Draft failed");
                snapId = draft.data.snapshot_id;
            } else {
                const draft = await CategorySnapshotBuilder.ensureDraft(categoryId, 'IN', 'en');
                if (!draft.ok) throw new Error("Draft failed");
                snapId = draft.data.snapshot_id;
            }

            // 2. Hydrate
            await CategorySnapshotBuilder.hydrate(snapId, categoryId, 'IN', 'en', undefined, jobId);

            // 3. Grow Universal — FULL tier targets 2000 valid keywords
            const growRes = await this.ensureAnchorQuotaAndValidate(categoryId, snapId, { tier: opts.tier }, jobId);
            if (!growRes.ok) throw new Error(growRes.error);

            // 4. Certify — use tier-appropriate policy
            const certTier = opts.tier === 'FULL' ? 'FULL' : 'LITE';
            const cert = await CategorySnapshotBuilder.certify(snapId, categoryId, 'IN', 'en', certTier, jobId, { policy: 'CERT_V3_LEAN' });
            if (cert.ok) return { ok: true };
            return { ok: false, error: (cert as any).error };

        } catch (e: any) {
            return { ok: false, error: e.message };
        }
    },
    
    async closeAnchorDeficitsV2(categoryId: string, snapshotId: string, tier: 'LITE'|'FULL', jobId: string) {
        return this.ensureAnchorQuotaAndValidate(categoryId, snapshotId, { tier }, jobId);
    },
    
    async attemptLitePromotion(snapshot: CategorySnapshotDoc, categoryId: string, country: string, lang: string): Promise<boolean> {
        if (snapshot.stats.valid_total >= 300) {
            snapshot.lifecycle = 'VALIDATED_LITE';
            await CategorySnapshotStore.writeSnapshot(snapshot);
            return true;
        }
        return false;
    },

    async runBackfillMinimumValidation(categoryId: string, snapshotId: string): Promise<{ ok: boolean; fixedCount: number; validCount: number; error?: string }> {
        const rowsRes = await CategorySnapshotStore.readAllKeywordRows({ categoryId, countryCode: 'IN', languageCode: 'en' }, snapshotId);
        if (!rowsRes.ok) return { ok: false, fixedCount: 0, validCount: 0, error: "Read failed" };
        
        const rows = rowsRes.data;
        const unverified = rows.filter(r => r.status === 'UNVERIFIED').slice(0, 50);
        
        if (unverified.length === 0) return { ok: true, fixedCount: 0, validCount: rows.filter(r => r.status === 'VALID').length };

        const creds = await CredsStore.get();
        if (!creds) return { ok: false, fixedCount: 0, validCount: 0, error: "No creds" };

        const res = await DataForSeoClient.fetchGoogleVolumes_DFS({
             keywords: unverified.map(r => r.keyword_text),
             location: 2356,
             language: 'en',
             creds: creds as any,
             useProxy: true
        });
        
        let fixed = 0;
        if (res.ok && res.parsedRows) {
            res.parsedRows.forEach(pr => {
                const r = rows.find(row => row.keyword_text === pr.keyword);
                if (r) {
                    r.volume = pr.search_volume || 0;
                    r.status = r.volume > 0 ? 'VALID' : 'ZERO';
                    fixed++;
                }
            });
            await CategorySnapshotStore.writeKeywordRows({ categoryId, countryCode: 'IN', languageCode: 'en' }, snapshotId, rows);
            
            const snapRes = await CategorySnapshotStore.getSnapshotById({ categoryId, countryCode: 'IN', languageCode: 'en' }, snapshotId);
            if (snapRes.ok) {
                await this.finalizeSnapshotStats(snapRes.data, rows);
            } else {
                console.error("Failed to update snapshot stats:", (snapRes as any).error);
            }
        }

        return { 
            ok: true, 
            fixedCount: fixed, 
            validCount: rows.filter(r => r.status === 'VALID').length 
        };
    }
};
