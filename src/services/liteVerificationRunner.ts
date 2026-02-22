
import { CategorySnapshotStore } from './categorySnapshotStore';
import { DataForSeoClient, DataForSeoRow } from './demand_vNext/dataforseoClient';
import { CredsStore } from './demand_vNext/credsStore';
import { FirestoreVolumeCache } from './firestoreVolumeCache';
import { normalizeKeywordString } from '../driftHash';
import { CategorySnapshotDoc, SnapshotKeywordRow } from '../types';
import { CorpusIndexStore } from './corpusIndexStore';
import { CERT_THRESHOLDS } from '../contracts/certificationThresholds';

const LITE_TARGET_PER_ANCHOR = CERT_THRESHOLDS.VALIDATED_LITE.min_valid_per_anchor;

export const LiteVerificationRunner = {
    
    async runLiteVerification(
        snapshotId: string,
        categoryId: string,
        country: string = 'IN',
        lang: string = 'en'
    ): Promise<{ ok: boolean; status: 'VALIDATED_LITE' | 'SKIPPED' | 'FAILED'; reasons?: string[]; validatedCount?: number }> {
        
        // 0. Preflight
        const creds = await CredsStore.get();
        if (!creds) {
            return { ok: false, status: 'FAILED', reasons: ["Missing DataForSEO Credentials. Check Console > DataForSEO Login."] };
        }

        // 1. Fetch Snapshot
        const snapRes = await CategorySnapshotStore.getSnapshotById({ categoryId, countryCode: country, languageCode: lang }, snapshotId);
        if (!snapRes.ok) return { ok: false, status: 'FAILED', reasons: ["Snapshot not found"] };
        const snap = snapRes.data;

        // 2. Lifecycle Gate
        if (snap.lifecycle === 'VALIDATED' || snap.lifecycle === 'CERTIFIED' || snap.lifecycle === 'CERTIFIED_LITE' || snap.lifecycle === 'CERTIFIED_FULL') {
            return { ok: true, status: 'SKIPPED', reasons: [`Already ${snap.lifecycle}`] };
        }

        // 3. Load All Rows
        const rowsRes = await CategorySnapshotStore.readAllKeywordRows({ categoryId, countryCode: country, languageCode: lang }, snapshotId);
        if (!rowsRes.ok) return { ok: false, status: 'FAILED', reasons: ["Failed to load rows"] };
        const allRows = rowsRes.data;

        // 4. Anchor Analysis & Fetch Plan
        const rowsByAnchor: Record<string, SnapshotKeywordRow[]> = {};
        snap.anchors.forEach(a => rowsByAnchor[a.anchor_id] = []);
        
        allRows.forEach(r => {
            if (rowsByAnchor[r.anchor_id]) rowsByAnchor[r.anchor_id].push(r);
        });

        let totalValidatedThisRun = 0;
        let hasChanges = false;
        let sufficientData = true;
        const failureReasons: string[] = [];

        for (const anchor of snap.anchors) {
            const aid = anchor.anchor_id;
            const rows = rowsByAnchor[aid] || [];
            
            const validCount = rows.filter(r => r.status === 'VALID').length;
            
            if (validCount >= LITE_TARGET_PER_ANCHOR) continue;

            const deficit = LITE_TARGET_PER_ANCHOR - validCount;
            const fetchTarget = Math.min(rows.length, deficit * 3); 
            
            const candidates = rows
                .filter(r => r.status === 'UNVERIFIED' || r.status === 'ERROR')
                .slice(0, fetchTarget);

            if (candidates.length === 0) {
                if (validCount < LITE_TARGET_PER_ANCHOR) {
                    sufficientData = false;
                    failureReasons.push(`Anchor '${aid}': Insufficient candidates (${validCount}/${LITE_TARGET_PER_ANCHOR})`);
                }
                continue;
            }

            const keywords = candidates.map(c => c.keyword_text);
            const { results, success } = await this.fetchAndMap(keywords, creds, country, lang);
            
            if (!success) {
                return { ok: false, status: 'FAILED', reasons: ["API Failure during verification"] };
            }

            candidates.forEach(r => {
                const norm = normalizeKeywordString(r.keyword_text);
                const res = results.get(norm);
                if (res) {
                    // Fix: Property assignments on SnapshotKeywordRow
                    r.volume = res.volume;
                    r.cpc = res.cpc;
                    r.competition = res.competition;
                    r.status = res.volume > 0 ? 'VALID' : 'ZERO';
                    r.validated_at_iso = new Date().toISOString();
                    if (r.status === 'VALID') totalValidatedThisRun++;
                    hasChanges = true;
                } else {
                    r.status = 'ERROR'; 
                    hasChanges = true;
                }
            });

            const newValidCount = rows.filter(r => r.status === 'VALID').length;
            if (newValidCount < LITE_TARGET_PER_ANCHOR) {
                sufficientData = false;
                failureReasons.push(`Anchor '${aid}': Target not met after fetch (${newValidCount}/${LITE_TARGET_PER_ANCHOR})`);
            }
        }

        if (hasChanges) {
            await CategorySnapshotStore.writeKeywordRows(
                { categoryId, countryCode: country, languageCode: lang }, 
                snapshotId, 
                allRows 
            );
            await this.finalizeSnapshotStats(snap, allRows);
        }

        if (sufficientData) {
            snap.lifecycle = 'VALIDATED_LITE';
            // Fix: updated_at_iso property access
            snap.updated_at_iso = new Date().toISOString();
            await CategorySnapshotStore.writeSnapshot(snap);
            await CorpusIndexStore.upsertFromSnapshot(snap);
            return { ok: true, status: 'VALIDATED_LITE', validatedCount: totalValidatedThisRun };
        } else {
            return { ok: true, status: 'SKIPPED', reasons: failureReasons, validatedCount: totalValidatedThisRun };
        }
    },

    async fetchAndMap(
        keywords: string[], 
        creds: any,
        country: string,
        lang: string
    ): Promise<{ results: Map<string, any>; success: boolean }> {
        const results = new Map<string, any>();
        const cache = await FirestoreVolumeCache.getMany(keywords, country, lang);
        const missing: string[] = [];

        keywords.forEach(k => {
            const norm = normalizeKeywordString(k);
            if (cache.has(norm)) {
                const hit = cache.get(norm)!;
                results.set(norm, hit);
            } else {
                missing.push(k);
            }
        });

        if (missing.length > 0) {
            try {
                const res = await DataForSeoClient.fetchVolumeStandard(creds, missing, 2356, lang);
                if (res.ok && res.parsedRows) {
                    const toCache = [];
                    for (const r of res.parsedRows) {
                        const norm = normalizeKeywordString(r.keyword);
                        const vol = r.search_volume || 0;
                        const entry = {
                            volume: vol,
                            cpc: r.cpc || 0,
                            competition: r.competition_index || r.competition || 0
                        };
                        results.set(norm, entry);
                        toCache.push({ ...entry, keyword: r.keyword, country, lang, location: 2356 });
                    }
                    if (toCache.length > 0) await FirestoreVolumeCache.setMany(toCache);
                } else {
                    console.error("DFS Fetch Failed", res.error);
                    return { results, success: false };
                }
            } catch (e) {
                console.error("DFS Fetch Exception", e);
                return { results, success: false };
            }
        }

        return { results, success: true };
    },

    async finalizeSnapshotStats(snap: CategorySnapshotDoc, rows: SnapshotKeywordRow[]) {
        let valid = 0, zero = 0, validated = 0;
        const anchorValid: Record<string, number> = {};
        const anchorTotal: Record<string, number> = {};

        rows.forEach(r => {
            if (!anchorTotal[r.anchor_id]) anchorTotal[r.anchor_id] = 0;
            if (!anchorValid[r.anchor_id]) anchorValid[r.anchor_id] = 0;
            
            anchorTotal[r.anchor_id]++;
            
            if (r.status === 'VALID') {
                valid++;
                anchorValid[r.anchor_id]++;
            }
            if (r.status === 'ZERO') zero++;
            if (r.status !== 'UNVERIFIED') validated++;
        });

        snap.stats.keywords_total = rows.length;
        snap.stats.valid_total = valid;
        snap.stats.zero_total = zero;
        snap.stats.validated_total = validated;
        snap.stats.per_anchor_valid_counts = anchorValid;
        snap.stats.per_anchor_total_counts = anchorTotal;
        
        await CategorySnapshotStore.writeSnapshot(snap);
        await CorpusIndexStore.upsertFromSnapshot(snap);
    }
};
