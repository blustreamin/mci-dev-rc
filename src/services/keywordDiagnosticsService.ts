
import { DataForSeoClient } from './demand_vNext/dataforseoClient';
import { CredsStore } from './demand_vNext/credsStore';
import { getCuratedSeeds } from './curatedKeywordSeeds';
import { CategoryKeywordGuard, HEAD_TERMS, BRAND_PACKS } from './categoryKeywordGuard';

export interface DiagRow {
    keyword: string;
    volume: number;
    cpc: number;
    competition: number;
    guardPass: boolean;
    guardReason: string;
}

export const KeywordDiagnosticsService = {

    async runDiagnostics(
        categoryId: string, 
        onLog: (msg: string) => void
    ): Promise<DiagRow[]> {
        const results: DiagRow[] = [];
        
        onLog(`[DIAG] Starting keyword diagnostics for: ${categoryId}`);
        
        const creds = await CredsStore.get();
        if (!creds || !creds.login) {
            onLog(`[DIAG][ERROR] No DFS credentials found`);
            return [];
        }
        onLog(`[DIAG] DFS credentials loaded`);

        // Use curated seeds — send directly to search_volume endpoint
        const seeds = getCuratedSeeds(categoryId);
        onLog(`[DIAG] Curated seeds for ${categoryId}: ${seeds.length} keywords`);
        
        if (seeds.length === 0) {
            onLog(`[DIAG][ERROR] No curated seeds for category ${categoryId}`);
            return [];
        }

        // Send in batches of 50 to search_volume (WORKS through proxy)
        const BATCH_SIZE = 50;
        let totalSent = 0;
        let totalWithVolume = 0;

        for (let i = 0; i < seeds.length; i += BATCH_SIZE) {
            const batch = seeds.slice(i, i + BATCH_SIZE);
            totalSent += batch.length;
            onLog(`[DIAG][BATCH ${Math.floor(i/BATCH_SIZE)+1}] Validating ${batch.length} keywords via search_volume...`);
            
            try {
                const res = await DataForSeoClient.fetchGoogleVolumes_DFS({
                    keywords: batch,
                    location: 2356,
                    language: 'en',
                    creds,
                    useProxy: true
                });
                
                if (res.ok && res.parsedRows) {
                    const withVol = res.parsedRows.filter(r => (r.search_volume || 0) > 0);
                    totalWithVolume += withVol.length;
                    onLog(`[DIAG][BATCH] Returned ${res.parsedRows.length} rows, ${withVol.length} with volume > 0`);
                    
                    for (const row of res.parsedRows) {
                        const guard = CategoryKeywordGuard.isSpecific(row.keyword, categoryId);
                        const vol = row.search_volume || 0;
                        results.push({
                            keyword: row.keyword,
                            volume: vol,
                            cpc: row.cpc || 0,
                            competition: row.competition_index || 0,
                            guardPass: guard.ok,
                            guardReason: guard.reason
                        });
                        
                        if (vol > 0) {
                            const icon = guard.ok ? '\u2705' : '\u274C';
                            onLog(`  ${icon} "${row.keyword}" vol=${vol} cpc=${row.cpc || 0} ${!guard.ok ? '[BLOCKED: ' + guard.reason + ']' : ''}`);
                        }
                    }
                } else {
                    onLog(`[DIAG][BATCH][ERROR] ${res.error}`);
                }
            } catch (e: any) {
                onLog(`[DIAG][BATCH][ERROR] ${e.message}`);
            }
            
            await new Promise(r => setTimeout(r, 1000));
        }

        onLog(`[DIAG] ====== SUMMARY ======`);
        onLog(`[DIAG] Total sent: ${totalSent}`);
        onLog(`[DIAG] With volume > 0: ${totalWithVolume}`);
        onLog(`[DIAG] Hit rate: ${totalSent > 0 ? Math.round(totalWithVolume/totalSent*100) : 0}%`);
        onLog(`[DIAG] HEAD_TERMS: ${(HEAD_TERMS[categoryId] || []).join(', ')}`);
        
        const blockedHighVol = results.filter(r => !r.guardPass && r.volume > 0).sort((a, b) => b.volume - a.volume);
        if (blockedHighVol.length > 0) {
            onLog(`[DIAG] ====== BLOCKED BY GUARD (have volume!) ======`);
            for (const r of blockedHighVol.slice(0, 20)) {
                onLog(`  \u274C "${r.keyword}" vol=${r.volume} BLOCKED: ${r.guardReason}`);
            }
        }
        
        return results;
    }
};
