
import { SnapshotResolver } from './snapshotResolver';
import { CategorySnapshotStore } from './categorySnapshotStore';
import { CategoryKeywordGuard } from './categoryKeywordGuard';
import { DataForSeoClient } from './demand_vNext/dataforseoClient';
import { CredsStore } from './demand_vNext/credsStore';
import { FirestoreClient } from './firestoreClient';

export const DebugValidationProbe = {
    async run(categoryId: string = 'shaving') {
        const logs: string[] = [];
        const log = (msg: string) => {
            console.log(msg);
            logs.push(msg);
        };

        log(`[PROBE][START] category=${categoryId}`);

        // 1. Load Snapshot
        const res = await SnapshotResolver.resolveActiveSnapshot(categoryId, 'IN', 'en');
        if (!res.ok || !res.snapshot) {
            log(`[PROBE][FAIL] No snapshot found for ${categoryId}`);
            return { logs, verdict: 'FAIL' };
        }

        const snapshotId = res.snapshot.snapshot_id;
        log(`[PROBE][SNAPSHOT] id=${snapshotId} lifecycle=${res.snapshot.lifecycle}`);

        const rowsRes = await CategorySnapshotStore.readAllKeywordRows(
            { categoryId: categoryId, countryCode: 'IN', languageCode: 'en' },
            snapshotId
        );

        if (!rowsRes.ok || !rowsRes.data) {
             log(`[PROBE][FAIL] Could not read rows`);
             return { logs, verdict: 'FAIL' };
        }

        const allRows = rowsRes.data;
        const sample = allRows.slice(0, 5);
        
        if (sample.length === 0) {
            log(`[PROBE][FAIL] Snapshot has 0 rows.`);
            return { logs, verdict: 'FAIL' };
        }

        log(`[PROBE][KEYWORDS] ${sample.map(k => k.keyword_text).join(', ')}`);

        // 2. Guard Check
        let guardFailCount = 0;
        for (const row of sample) {
            const check = CategoryKeywordGuard.isSpecific(row.keyword_text, categoryId);
            log(`[PROBE][GUARD] "${row.keyword_text}" specific=${check.ok} reason=${check.reason}`);
            if (!check.ok) guardFailCount++;
        }

        if (guardFailCount === sample.length) {
            log(`[PROBE][STOP] Guard rejected all samples. Root cause: GUARD_OVERKILL.`);
        }

        // 3. Run Google DFS Validation (Using new robust wrapper)
        const creds = await CredsStore.get();
        if (!creds) {
             log(`[PROBE][FAIL] No DFS Creds`);
             return { logs, verdict: 'FAIL' };
        }
        
        log(`[PROBE][CREDS] source=${creds.source}`);

        const keywords = sample.map(r => r.keyword_text);
        
        // Use the robust fetcher which handles proxying if enabled
        const dfsRes = await DataForSeoClient.fetchGoogleVolumes_DFS({
            keywords, 
            location: 2356, 
            language: 'en', 
            creds: creds as any,
            useProxy: true // Allow robust client to decide
        });
        
        log(`[PROBE][DFS_RAW_STATUS] status=${dfsRes.status} ok=${dfsRes.ok}`);
        log(`[PROBE][DFS_ROWS_PARSED] count=${dfsRes.parsedRows?.length || 0}`);
        log(`[PROBE][DFS_TELEMETRY] proxy=${dfsRes.viaProxy} url=${dfsRes.urlUsed} latency=${dfsRes.latency}ms`);
        
        if (dfsRes.error) {
             log(`[PROBE][DFS_ERROR] ${dfsRes.error}`);
        }
        if (dfsRes.status === 0) {
             log(`[PROBE][DFS_CORS] CORS/Network error detected (status=0).`);
        }
        if (dfsRes.bodySnippet) {
             log(`[PROBE][DFS_BODY] ${dfsRes.bodySnippet}`);
        }

        // VERDICT LOGIC UPDATE: Fail if DFS failed
        const dfsOk = dfsRes.ok && (dfsRes.parsedRows?.length || 0) > 0;
        if (!dfsOk) {
             log(`[PROBE][FAIL] DFS failed to return parsed rows. Smoke test aborted.`);
             if (dfsRes.error && dfsRes.error.includes("Failed to fetch")) {
                 log(`[PROBE][HINT] Check backend connectivity. URL: ${dfsRes.urlUsed}`);
             }
             return { logs, verdict: 'FAIL' };
        } else {
             // Sample output
             const first = dfsRes.parsedRows![0];
             log(`[PROBE][DFS_SAMPLE] kw="${first.keyword}" vol=${first.search_volume}`);
        }

        log(`[PROBE][SUCCESS] Smoke Test Passed.`);
        return { 
            logs, 
            verdict: 'PASS',
            result: {
                ok: true,
                mode: dfsRes.viaProxy ? 'PROXY' : 'DIRECT',
                credsSource: creds.source,
                samples: dfsRes.parsedRows,
                errors: []
            }
        };
    }
};
