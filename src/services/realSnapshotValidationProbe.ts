
import { SnapshotResolver } from './snapshotResolver';
import { CategorySnapshotStore } from './categorySnapshotStore';
import { DataForSeoClient } from './demand_vNext/dataforseoClient';
import { CredsStore } from './demand_vNext/credsStore';
import { FirestoreClient } from './firestoreClient';

export const RealSnapshotValidationProbe = {
    async run(categoryId: string = 'beard') {
        const logs: string[] = [];
        const log = (msg: string) => {
            console.log(msg);
            logs.push(msg);
        };

        log(`[REAL_PROBE] Starting for ${categoryId}...`);

        // B1. Resolve Snapshot (Strict Real)
        const res = await SnapshotResolver.resolveActiveSnapshot(categoryId, 'IN', 'en');
        if (!res.ok || !res.snapshot) {
            log(`[REAL_PROBE][FAIL] No snapshot found. Reason: ${res.reason}`);
            return { logs, verdict: 'FAIL' };
        }

        const snap = res.snapshot;
        if (!snap.snapshot_id.startsWith('snap_')) {
             log(`[REAL_PROBE][FAIL] Resolved snapshot is NOT a real snapshot: ${snap.snapshot_id}`);
             return { logs, verdict: 'FAIL_BAD_ID' };
        }
        
        log(`[REAL_PROBE][SNAP] categoryId=${categoryId} snapshotId=${snap.snapshot_id} source=${res.source} lifecycle=${snap.lifecycle}`);

        // B2. Pick Rows
        const rowsRes = await CategorySnapshotStore.readAllKeywordRows(
            { categoryId, countryCode: 'IN', languageCode: 'en' }, 
            snap.snapshot_id
        );

        if (!rowsRes.ok) {
            log(`[REAL_PROBE][FAIL] Row read failed.`);
            return { logs, verdict: 'FAIL_READ' };
        }

        const allRows = rowsRes.data;
        const unverified = allRows.filter(r => r.status === 'UNVERIFIED' || r.status === 'ZERO');
        // Pick 10
        const candidates = unverified.length >= 10 ? unverified.slice(0, 10) : allRows.slice(0, 10);
        
        if (candidates.length === 0) {
             log(`[REAL_PROBE][FAIL] No rows available.`);
             return { logs, verdict: 'FAIL_EMPTY' };
        }

        log(`[REAL_PROBE][ROWS_PICKED] n=${candidates.length} (ids: ${candidates.map(c => c.keyword_text).join(', ')})`);

        // B3. DFS Validate
        const creds = await CredsStore.get();
        if (!creds) {
            log(`[REAL_PROBE][FAIL] No DFS Creds.`);
            return { logs, verdict: 'FAIL_CREDS' };
        }

        const keywords = candidates.map(c => c.keyword_text);
        const dfsRes = await DataForSeoClient.fetchVolumeStandard(creds, keywords, 2356, 'en');

        log(`[REAL_PROBE][DFS_PARSE] matchedPath=${dfsRes.parseMeta?.matchedPath} parsedItems=${dfsRes.parsedRows?.length || 0}`);
        
        if (!dfsRes.ok || !dfsRes.parsedRows || dfsRes.parsedRows.length === 0) {
             log(`[REAL_PROBE][FAIL] DFS returned 0 rows or error: ${dfsRes.error}`);
             return { logs, verdict: 'FAIL_DFS_EMPTY' };
        }

        // B4. Persist
        const resultMap = new Map(dfsRes.parsedRows.map(r => [r.keyword.toLowerCase(), r]));
        
        // Update candidates locally
        const updatedCandidates = candidates.map(r => {
            const hit = resultMap.get(r.keyword_text.toLowerCase());
            if (hit) {
                const vol = hit.search_volume || 0;
                return {
                    ...r,
                    volume: vol,
                    cpc: hit.cpc,
                    competition: hit.competition_index || hit.competition,
                    status: (vol > 0 ? 'VALID' : 'ZERO') as 'VALID' | 'ZERO',
                    active: vol > 0 ? true : false,
                    validated_at_iso: new Date().toISOString()
                };
            }
            return r;
        });

        // Merge back into full set
        updatedCandidates.forEach(uc => {
             const mainIdx = allRows.findIndex(ar => ar.keyword_id === uc.keyword_id);
             if (mainIdx !== -1) {
                 allRows[mainIdx] = uc;
             }
        });

        log(`[REAL_PROBE][PERSIST] Writing ${allRows.length} rows (10 updated)...`);
        
        await CategorySnapshotStore.writeKeywordRows(
             { categoryId, countryCode: 'IN', languageCode: 'en' }, 
             snap.snapshot_id,
             allRows
        );

        // Reload to verify
        const reloadRes = await CategorySnapshotStore.readAllKeywordRows(
            { categoryId, countryCode: 'IN', languageCode: 'en' }, 
            snap.snapshot_id
        );
        
        if (!reloadRes.ok) {
             const err = (reloadRes as any).error;
             log(`[REAL_PROBE][FAIL] Reload read failed: ${err}`);
             return { logs, verdict: 'FAIL_RELOAD' };
        }

        const reloadedRows = reloadRes.data || [];
        
        // Verify candidates
        let persistSuccess = 0;
        let reloadedValid = 0;
        let reloadedZero = 0;

        updatedCandidates.forEach(uc => {
            const found = reloadedRows.find(rr => rr.keyword_id === uc.keyword_id);
            if (found) {
                if (found.status === uc.status && found.volume === uc.volume) {
                    persistSuccess++;
                }
                if (found.status === 'VALID') reloadedValid++;
                if (found.status === 'ZERO') reloadedZero++;
            }
        });

        log(`[REAL_PROBE][PERSIST_OK] updated=10 verified=${persistSuccess} reloadedValid=${reloadedValid} reloadedZero=${reloadedZero}`);

        if (persistSuccess < 10) {
             log(`[REAL_PROBE][FAIL] Persistence mismatch.`);
             return { logs, verdict: 'FAIL_PERSIST' };
        }

        // B5. Valid Scan
        const validScan = reloadedRows.filter(r => r.active && r.status === 'VALID' && (r.volume || 0) > 0).length;
        log(`[REAL_PROBE][VALID_SCAN] rows=${reloadedRows.length} valid=${validScan}`);

        // Update Snapshot Stats
        snap.stats.valid_total = validScan;
        snap.stats.validated_total = reloadedRows.filter(r => r.status !== 'UNVERIFIED').length;
        snap.stats.zero_total = reloadedRows.filter(r => r.status === 'ZERO').length;
        
        await CategorySnapshotStore.writeSnapshot(snap);
        
        return { logs, verdict: validScan > 0 ? 'PASS' : 'WARN_ZERO_VALID' };
    }
};
