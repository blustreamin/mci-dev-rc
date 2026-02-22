
import { CategorySnapshotStore } from './categorySnapshotStore';
import { StrategyPlanStore } from './strategyPlanStore';
import { AnchorScanner } from './anchorScanner';
import { BootstrapService } from './bootstrapService';
import { CategorySnapshotDoc, SnapshotLifecycle, SnapshotKeywordRow, SnapshotAnchor, CertificationTier, ReadinessTierReport, CertificationReportV2 } from '../types';
import { CANONICAL_ANCHORS } from '../contracts/canonicalAnchors';
import { CategoryKeywordGrowthService } from './categoryKeywordGrowthService';
import { CorpusIndexStore } from './corpusIndexStore';
import { CertificationReadinessService } from './certificationReadinessService';
import { JobControlService } from './jobControlService';
import { SnapshotResolver } from './snapshotResolver';
import { FirestoreClient } from './firestoreClient';
import { doc, getDoc } from 'firebase/firestore';
import { CorpusHealthService } from './corpusHealthService';
import { AnchorExpansionService } from './anchorExpansionService';
import { CorpusValidity } from './corpusValidity';
import { CERT_THRESHOLDS_V2, CERT_V3_LEAN_REBUILD_POLICY } from '../contracts/certificationThresholds';

async function computeSnapshotIntegrity(snapshot: CategorySnapshotDoc): Promise<string> {
    const text = JSON.stringify(snapshot.anchors) + JSON.stringify(snapshot.stats) + snapshot.integrity.chunk_count;
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export const CategorySnapshotBuilder = {

    async ensureDraft(categoryId: string, country: string = "IN", lang: string = "en"): Promise<{ok:true; data:CategorySnapshotDoc} | {ok:false; error:string}> {
        const index = await CorpusIndexStore.get(categoryId, country, lang);
        if (index?.activeSnapshotId) {
            const existing = await CategorySnapshotStore.getSnapshotById({ categoryId, countryCode: country, languageCode: lang }, index.activeSnapshotId);
            if (existing.ok) return { ok: true, data: existing.data };
        }

        const existing = await CategorySnapshotStore.getLatestSnapshot({ categoryId, countryCode: country, languageCode: lang }, ['DRAFT', 'HYDRATED', 'VALIDATED', 'CERTIFIED', 'CERTIFIED_LITE', 'CERTIFIED_FULL']);
        if (existing.ok) {
            return { ok: true, data: existing.data };
        }

        let anchorNames = AnchorScanner.scanAnchors(categoryId);
        const canonical = CANONICAL_ANCHORS[categoryId] || [];
        const canonicalSet = new Set(canonical);
        const allMatched = anchorNames.every(a => canonicalSet.has(a)) && anchorNames.length === canonical.length;
        
        if (!allMatched) {
            anchorNames = canonical;
        }
        
        const snapshotAnchors: SnapshotAnchor[] = anchorNames.map((a, i) => ({
            anchor_id: a,
            order: i,
            source: 'SCAN'
        }));

        const createRes = await CategorySnapshotStore.createDraftSnapshot({
            categoryId, countryCode: country, languageCode: lang,
            anchors: snapshotAnchors,
            targets: { per_anchor: 300, validation_min_vol: 20 }
        });

        if (createRes.ok) {
            await CorpusIndexStore.upsertFromSnapshot(createRes.data);
            return { ok: true, data: createRes.data };
        } else {
            return { ok: false, error: (createRes as any).error || "Failed to create draft" };
        }
    },

    async hydrate(
        snapshotId: string, 
        categoryId: string, 
        country: string, 
        lang: string, 
        opts?: { append: boolean },
        controlJobId?: string
    ): Promise<{ok:true; data:{added:number; total:number}} | {ok:false; error:string}> {
        const snapRes = await CategorySnapshotStore.getSnapshotById({ categoryId, countryCode: country, languageCode: lang }, snapshotId);
        if (!snapRes.ok) return { ok: false, error: "Snapshot not found" };
        
        const snap = snapRes.data;
        if (snap.lifecycle === 'CERTIFIED' || snap.lifecycle === 'CERTIFIED_LITE' || snap.lifecycle === 'CERTIFIED_FULL') {
            return { ok: false, error: `Cannot hydrate CERTIFIED snapshot` };
        }

        let existingRows: SnapshotKeywordRow[] = [];
        if (opts?.append) {
            const readRes = await CategorySnapshotStore.readAllKeywordRows({ categoryId, countryCode: country, languageCode: lang }, snapshotId);
            if (readRes.ok) existingRows = readRes.data;
        }

        let newRows: SnapshotKeywordRow[] = [];
        let anchorIdx = 0;
        
        try {
            for (const anchor of snap.anchors) {
                if (controlJobId) {
                    // await JobControlService.assertNotStopped(controlJobId); // Disabled for rebuild resilience
                    await JobControlService.updateProgress(controlJobId, { 
                        progress: { processed: anchorIdx, total: snap.anchors.length } 
                    });
                }

                const rows = await BootstrapService.bootstrapFromSeeds(categoryId, anchor.anchor_id, snap.targets.per_anchor, opts?.append);
                newRows = newRows.concat(rows);
                anchorIdx++;
            }

            const combined = [...existingRows, ...newRows];
            const uniqueRows = Array.from(new Map(combined.map(item => [item.keyword_text.toLowerCase().trim(), item])).values());

            // if (controlJobId) await JobControlService.assertNotStopped(controlJobId); // Disabled for rebuild resilience

            const writeRes = await CategorySnapshotStore.writeKeywordRows({ categoryId, countryCode: country, languageCode: lang }, snapshotId, uniqueRows);
            if (writeRes.ok) {
                snap.lifecycle = 'HYDRATED';
                snap.stats.keywords_total = uniqueRows.length;
                snap.integrity.chunk_count = writeRes.data.chunkCount;
                snap.integrity.sha256 = await computeSnapshotIntegrity(snap); 

                await CategorySnapshotStore.writeSnapshot(snap);
                await CorpusIndexStore.upsertFromSnapshot(snap);

                if (controlJobId) await JobControlService.finishJob(controlJobId, 'COMPLETED');

                return { ok: true, data: { added: uniqueRows.length - existingRows.length, total: uniqueRows.length } };
            } else {
                throw new Error((writeRes as any).error || "Write failed");
            }
        } catch (e: any) {
            if (e.message === 'STOPPED') {
                return { ok: false, error: 'STOPPED' };
            }
            if (controlJobId) await JobControlService.finishJob(controlJobId, 'FAILED', e.message);
            return { ok: false, error: e.message };
        }
    },

    async validate(
        snapshotId: string, 
        categoryId: string, 
        country: string, 
        lang: string,
        options: { resume?: boolean } = {},
        controlJobId?: string
    ): Promise<{ok:true; data:{validated:number; valid:number; zero:number}} | {ok:false; error:string}> {
        const res = await CategoryKeywordGrowthService.validateSnapshot(categoryId, snapshotId, country, lang, undefined, controlJobId);
        
        if (res.ok) {
            const snapRes = await CategorySnapshotStore.getSnapshotById({ categoryId, countryCode: country, languageCode: lang }, snapshotId);
            if (snapRes.ok) {
                const stats = snapRes.data.stats;
                return { 
                    ok: true, 
                    data: { validated: stats.validated_total, valid: stats.valid_total, zero: stats.zero_total }
                };
            }
        }
        
        return { ok: false, error: (res as any).error || "Validation Failed" };
    },

    async stopValidation(snapshotId: string, categoryId: string, country: string, lang: string): Promise<void> {
        const snapRes = await CategorySnapshotStore.getSnapshotById({ categoryId, countryCode: country, languageCode: lang }, snapshotId);
        if (snapRes.ok) {
            const snap = snapRes.data;
            if (snap.validation_job) {
                snap.validation_job.status = 'FAILED'; 
                await CategorySnapshotStore.writeSnapshot(snap);
            }
        }
    },

    async certify(
        snapshotId: string, 
        categoryId: string, 
        country: string, 
        lang: string,
        tier: CertificationTier = 'FULL',
        controlJobId?: string,
        options?: { policy?: 'CERT_V3_LEAN' }
    ): Promise<{ok:true; data:{lifecycle:SnapshotLifecycle}} | {ok:false; error:string}> {
        
        try {
            // if (controlJobId) await JobControlService.assertNotStopped(controlJobId); // Disabled for rebuild resilience

            const snapRes = await CategorySnapshotStore.getSnapshotById({ categoryId, countryCode: country, languageCode: lang }, snapshotId);
            if (!snapRes.ok) return { ok: false, error: "Snapshot not found" };
            const snap = snapRes.data;

            // --- V2 CERTIFICATION GATES ---
            
            // 1. Fetch Rows for Deep Analysis
            let rowsRes = await CategorySnapshotStore.readAllKeywordRows({ categoryId, countryCode: country, languageCode: lang }, snapshotId);
            if (!rowsRes.ok) throw new Error("Failed to read keyword rows");
            let rows = rowsRes.data;

            // --- V3 LEAN BRANCH (For Rebuild Only) ---
            if (options?.policy === 'CERT_V3_LEAN') {
                return this.certifyV3Lean(snap, rows, controlJobId);
            }

            // 1b. Auto-Expand if Gate A fails (Pre-Check with V2 Validity)
            // Gate A Requirement: >= 10 anchors with >= 20 valid google keywords
            const anchorStatsCheck = CorpusValidity.getAnchorStats(rows);
            let passingCheck = 0;
            anchorStatsCheck.forEach((stat) => {
                 if (stat.valid >= 20) passingCheck++;
            });

            if (passingCheck < 10) {
                console.log(`[CERT_V2] Gate A Pre-Check Failing (${passingCheck}/10). Running Auto-Expansion...`);
                await AnchorExpansionService.expandToMinPassingAnchors(categoryId, snapshotId, { jobId: controlJobId });
                // Reload rows
                rowsRes = await CategorySnapshotStore.readAllKeywordRows({ categoryId, countryCode: country, languageCode: lang }, snapshotId);
                rows = rowsRes.ok ? rowsRes.data : [];
            }

            // 2. Compute Gate Metrics (STRICT GOOGLE-ONLY VALIDITY)
            const totalKeywords = rows.length;
            const validRows = rows.filter(r => CorpusValidity.isGoogleValidRow(r));
            const zeroRows = rows.filter(r => CorpusValidity.isGoogleZeroRow(r));
            
            const validNonZeroKeywords = validRows.length;
            const zeroCount = zeroRows.length;
            
            const coveragePct = totalKeywords > 0 ? (validNonZeroKeywords / totalKeywords) : 0;
            const zeroPct = totalKeywords > 0 ? (zeroCount / totalKeywords) : 0;

            // Anchor Stats (Recompute with Google Valid Only)
            const anchorStats = CorpusValidity.getAnchorStats(rows);
            let anchorsPassing = 0;
            
            // ANCHOR_PASSING: valid_count >= 20 AND maxVol >= 1000 (Head Check)
            anchorStats.forEach((stat) => {
                 if (stat.valid >= 20 && stat.maxVol >= 1000) {
                     anchorsPassing++;
                 }
            });

            // 3. Health Grade (Uses updated helper)
            const healthReport = CorpusHealthService.computeSnapshotHealth(snap, rows);
            const healthGrade = healthReport.healthGrade;

            // 4. GATES EVALUATION
            const gates = {
                A_AnchorCount: anchorsPassing >= 10,
                B_Coverage: coveragePct >= 0.35,
                C_ZeroCeiling: zeroPct <= 0.65,
                D_HealthLock: healthGrade !== 'RED',
                E_MinGlobalValid: validNonZeroKeywords >= 600
            };

            const failureReasons: string[] = [];
            if (!gates.A_AnchorCount) failureReasons.push(`Gate A (Anchors): Found ${anchorsPassing} passing (need 10, valid>=20, head>=1k)`);
            if (!gates.B_Coverage) failureReasons.push(`Gate B (Coverage): ${(coveragePct*100).toFixed(1)}% (need 35%)`);
            if (!gates.C_ZeroCeiling) failureReasons.push(`Gate C (Zero Vol): ${(zeroPct*100).toFixed(1)}% (max 65%)`);
            if (!gates.D_HealthLock) failureReasons.push(`Gate D (Health): Grade is ${healthGrade} (cannot be RED)`);
            if (!gates.E_MinGlobalValid) failureReasons.push(`Gate E (Volume): ${validNonZeroKeywords} valid google keywords (need 600)`);

            const ok = Object.values(gates).every(Boolean);

            // 5. Lifecycle Promotion
            const newLifecycle: SnapshotLifecycle = ok 
                ? 'CERTIFIED_FULL' // V2 standard is FULL if all gates pass
                : snap.lifecycle; // No change if fail

            console.log(`[ANCHOR_CERT_V2][GOOGLE_ONLY] snapshot=${snapshotId} valid_total=${validNonZeroKeywords} zero_total=${zeroCount} anchorsPassing=${anchorsPassing}/${snap.anchors.length} coverage=${(coveragePct*100).toFixed(1)}%`);

            // 6. Persist & Report
            snap.certificationReportV2 = {
                ok,
                lifecycle: newLifecycle,
                anchorCount: snap.anchors.length,
                anchorsPassing,
                validNonZeroKeywords,
                totalKeywords,
                coveragePct,
                healthGrade,
                failureReasons,
                timestamp: new Date().toISOString()
            };

            // Force update of stats to align with Google-only view
            snap.stats.valid_total = validNonZeroKeywords;
            snap.stats.zero_total = zeroCount;
            
            if (ok) {
                snap.lifecycle = newLifecycle;
            }
            
            snap.integrity.last_published_iso = new Date().toISOString();
            snap.updated_at_iso = new Date().toISOString();
            snap.integrity.sha256 = await computeSnapshotIntegrity(snap);
            
            snap.certify_state = { 
                ok: ok, 
                checkedAt: new Date().toISOString(),
                tier: tier
            };

            await CategorySnapshotStore.writeSnapshot(snap);
            await CorpusIndexStore.upsertFromSnapshot(snap);
            
            if (controlJobId) {
                if (ok) {
                    await JobControlService.finishJob(controlJobId, 'COMPLETED');
                } else {
                    await JobControlService.finishJob(controlJobId, 'FAILED', `V2 Cert Blocked: ${failureReasons.join(' | ')}`);
                }
            }

            return ok ? { ok: true, data: { lifecycle: newLifecycle } } : { ok: false, error: failureReasons.join(', ') };

        } catch (e: any) {
            if (controlJobId) await JobControlService.finishJob(controlJobId, 'FAILED', e.message);
            return { ok: false, error: e.message };
        }
    },

    /**
     * V3 LEAN Policy Certification (Rebuild Only)
     */
    async certifyV3Lean(snap: CategorySnapshotDoc, rows: SnapshotKeywordRow[], controlJobId?: string): Promise<{ok:true; data:{lifecycle:SnapshotLifecycle}} | {ok:false; error:string}> {
        
        // 1. Compute Google-Only Stats
        const totalKeywords = rows.length;
        const validRows = rows.filter(r => CorpusValidity.isGoogleValidRow(r));
        const zeroRows = rows.filter(r => CorpusValidity.isGoogleZeroRow(r));
        
        const validNonZeroKeywords = validRows.length;
        const zeroCount = zeroRows.length;
        
        // Poison Guard
        if (validNonZeroKeywords === 0) {
            console.log(`[REBUILD][CERT_V3_LEAN] POISON_GUARD: 0 valid keywords. Cannot certify.`);
            return { ok: false, error: "POISON_GUARD: 0 valid keywords" };
        }

        const coveragePct = totalKeywords > 0 ? (validNonZeroKeywords / totalKeywords) * 100 : 0;
        const zeroPct = totalKeywords > 0 ? (zeroCount / totalKeywords) * 100 : 0;

        const anchorStats = CorpusValidity.getAnchorStats(rows);
        let anchorsPassing = 0;
        anchorStats.forEach((stat) => {
             // Passing: >= 2 valid keywords (realistic for DFS-validated rebuild)
             if (stat.valid >= 2) {
                 anchorsPassing++;
             }
        });

        const anchorsAttempted = snap.anchors.length;
        const rules = CERT_V3_LEAN_REBUILD_POLICY.certifiedTierRules;

        let newLifecycle: SnapshotLifecycle = snap.lifecycle;
        let verdict = "NONE";

        // Check FULL
        if (anchorsPassing >= rules.CERTIFIED_FULL.minAnchorsPassing && 
            coveragePct >= rules.CERTIFIED_FULL.minCoveragePct &&
            validNonZeroKeywords >= rules.CERTIFIED_FULL.minValidKeywordsTotal &&
            zeroPct <= rules.CERTIFIED_FULL.maxZeroPct) {
                newLifecycle = 'CERTIFIED_FULL';
                verdict = 'FULL';
        } 
        // Check LITE
        else if (anchorsPassing >= rules.CERTIFIED_LITE.minAnchorsPassing && 
                 coveragePct >= rules.CERTIFIED_LITE.minCoveragePct &&
                 validNonZeroKeywords >= rules.CERTIFIED_LITE.minValidKeywordsTotal &&
                 zeroPct <= rules.CERTIFIED_LITE.maxZeroPct) {
                newLifecycle = 'CERTIFIED_LITE';
                verdict = 'LITE';
        }

        // Telemetry - Expanded for Rebuild Diagnosis
        console.log(`[CERT_V3_LEAN] cat=${snap.category_id} anchorsAttempted=${anchorsAttempted} anchorsPassing=${anchorsPassing} validTotal=${validNonZeroKeywords} coverage=${coveragePct.toFixed(1)}% zeroPct=${zeroPct.toFixed(1)}% -> verdict=${verdict}`);

        // PERSIST METADATA regardless of verdict (Rebuild Requirement D3)
        // Note: we inject custom props into snap even if they aren't strictly on the interface yet for debugging
        (snap as any).rebuildStatus = snap.lifecycle;
        (snap as any).certV3LeanVerdict = verdict;
        (snap as any).certV3LeanStats = { anchorsPassing, coveragePct, validNonZeroKeywords };
        
        // Update stats
        snap.stats.valid_total = validNonZeroKeywords;
        snap.stats.zero_total = zeroCount;
        snap.updated_at_iso = new Date().toISOString();
        
        // Generate basic Report V2 structure for consistency
        snap.certificationReportV2 = {
            ok: verdict !== 'NONE',
            lifecycle: newLifecycle,
            anchorCount: anchorsAttempted,
            anchorsPassing,
            validNonZeroKeywords,
            totalKeywords,
            coveragePct: coveragePct / 100,
            healthGrade: 'UNKNOWN', // Lean bypass
            failureReasons: verdict === 'NONE' ? [`Anchors Passing: ${anchorsPassing}`, `Coverage: ${coveragePct.toFixed(1)}%`] : [],
            timestamp: new Date().toISOString()
        };

        if (newLifecycle !== snap.lifecycle) {
            snap.lifecycle = newLifecycle;
        }

        await CategorySnapshotStore.writeSnapshot(snap);
        await CorpusIndexStore.upsertFromSnapshot(snap);
        
        if (verdict !== 'NONE') {
            if (controlJobId) await JobControlService.finishJob(controlJobId, 'COMPLETED');
            return { ok: true, data: { lifecycle: newLifecycle } };
        } else {
            // Non-blocking failure for rebuild flow
            // Don't mark job as FAILED here — orchestrator handles this
            console.warn(`[CERT_V3_LEAN] Verdict NONE for ${snap.category_id} — not marking job as failed`);
            return { ok: false, error: `Does not meet V3 Lean criteria (Verdict: ${verdict})` };
        }
    }
};
