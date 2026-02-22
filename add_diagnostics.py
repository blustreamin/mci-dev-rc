#!/usr/bin/env python3
"""
ADD KEYWORD DIAGNOSTICS to Corpus Inspector

1. Creates a keywordDiagnosticsService.ts that:
   - Sends discovery seeds to DFS
   - Logs every keyword + volume returned
   - Shows guard pass/fail for each
   - Exports results

2. Adds a "Diagnose Keywords" button to CorpusInspectorView.tsx
"""
import os

# ============================================================
# STEP 1: Create the diagnostics service
# ============================================================
print("=== Creating keywordDiagnosticsService.ts ===")

diag_service = '''
import { DataForSeoClient } from './demand_vNext/dataforseoClient';
import { CredsStore } from './demand_vNext/credsStore';
import { BootstrapServiceV3 } from './bootstrapServiceV3';
import { CategoryKeywordGuard, HEAD_TERMS, BRAND_PACKS } from './categoryKeywordGuard';

export interface DiagRow {
    keyword: string;
    volume: number;
    cpc: number;
    competition: number;
    guardPass: boolean;
    guardReason: string;
    source: string;
}

export const KeywordDiagnosticsService = {

    async runDiagnostics(
        categoryId: string, 
        onLog: (msg: string) => void
    ): Promise<DiagRow[]> {
        const results: DiagRow[] = [];
        
        onLog(`[DIAG] Starting keyword diagnostics for: ${categoryId}`);
        
        // 1. Get DFS credentials
        const creds = await CredsStore.get();
        if (!creds || !creds.login) {
            onLog(`[DIAG][ERROR] No DFS credentials found`);
            return [];
        }
        onLog(`[DIAG] DFS credentials loaded`);

        // 2. Get discovery seeds
        const seeds = BootstrapServiceV3.generateDiscoverySeeds(categoryId);
        onLog(`[DIAG] Generated ${seeds.length} discovery seeds`);
        onLog(`[DIAG] First 10 seeds: ${seeds.slice(0, 10).join(', ')}`);

        // 3. Send seeds to DFS in batches of 15
        const BATCH_SIZE = 15;
        let totalDfsReturned = 0;
        let totalWithVolume = 0;
        let totalPassGuard = 0;

        for (let i = 0; i < Math.min(seeds.length, 60); i += BATCH_SIZE) {
            const batch = seeds.slice(i, i + BATCH_SIZE);
            onLog(`[DIAG][BATCH ${Math.floor(i/BATCH_SIZE)+1}] Sending ${batch.length} seeds: ${batch.slice(0, 5).join(', ')}...`);
            
            try {
                const proxyUrl = await DataForSeoClient.resolveDfsProxyEndpoint();
                const path = 'keywords_data/google_ads/keywords_for_keywords/live';
                const postData = [{
                    keys: batch,
                    location_code: 2356,
                    language_code: 'en'
                }];

                const res = await DataForSeoClient._execProxy(`/v3/${path}`, postData, creds, proxyUrl);
                
                if (res.ok && res.parsedRows) {
                    totalDfsReturned += res.parsedRows.length;
                    onLog(`[DIAG][BATCH] DFS returned ${res.parsedRows.length} keywords`);
                    
                    // Log top 20 by volume
                    const sorted = [...res.parsedRows].sort((a, b) => (b.search_volume || 0) - (a.search_volume || 0));
                    const withVol = sorted.filter(r => (r.search_volume || 0) > 0);
                    totalWithVolume += withVol.length;
                    
                    onLog(`[DIAG][BATCH] ${withVol.length} with volume > 0`);
                    
                    // Process each keyword
                    for (const row of sorted.slice(0, 50)) {
                        const guard = CategoryKeywordGuard.isSpecific(row.keyword, categoryId);
                        if (guard.ok) totalPassGuard++;
                        
                        const diagRow: DiagRow = {
                            keyword: row.keyword,
                            volume: row.search_volume || 0,
                            cpc: row.cpc || 0,
                            competition: row.competition_index || 0,
                            guardPass: guard.ok,
                            guardReason: guard.reason,
                            source: 'DFS_DISCOVERY'
                        };
                        results.push(diagRow);
                        
                        // Log high-volume keywords
                        if ((row.search_volume || 0) >= 100) {
                            const guardIcon = guard.ok ? '✅' : '❌';
                            onLog(`  ${guardIcon} "${row.keyword}" vol=${row.search_volume} ${!guard.ok ? `[BLOCKED: ${guard.reason}]` : ''}`);
                        }
                    }
                } else {
                    onLog(`[DIAG][BATCH][ERROR] ${res.error}`);
                }
            } catch (e: any) {
                onLog(`[DIAG][BATCH][ERROR] ${e.message}`);
            }
            
            // Rate limit
            await new Promise(r => setTimeout(r, 1500));
        }

        // 4. Summary
        onLog(`[DIAG] ====== SUMMARY ======`);
        onLog(`[DIAG] Total DFS returned: ${totalDfsReturned}`);
        onLog(`[DIAG] With volume > 0: ${totalWithVolume}`);
        onLog(`[DIAG] Pass guard: ${totalPassGuard}`);
        onLog(`[DIAG] HEAD_TERMS for ${categoryId}: ${(HEAD_TERMS[categoryId] || []).join(', ')}`);
        onLog(`[DIAG] BRAND_PACKS for ${categoryId}: ${(BRAND_PACKS[categoryId] || []).slice(0, 10).join(', ')}`);
        
        // Show blocked high-volume keywords (these are the ones we're missing!)
        const blockedHighVol = results
            .filter(r => !r.guardPass && r.volume >= 50)
            .sort((a, b) => b.volume - a.volume);
        
        if (blockedHighVol.length > 0) {
            onLog(`[DIAG] ====== BLOCKED HIGH-VOLUME KEYWORDS ======`);
            for (const r of blockedHighVol.slice(0, 30)) {
                onLog(`  ❌ "${r.keyword}" vol=${r.volume} BLOCKED: ${r.guardReason}`);
            }
            onLog(`[DIAG] ${blockedHighVol.length} high-volume keywords are being BLOCKED by the guard!`);
        }
        
        return results;
    }
};
'''

with open('src/services/keywordDiagnosticsService.ts', 'w') as f:
    f.write(diag_service)
print("  OK: Created keywordDiagnosticsService.ts")

# ============================================================
# STEP 2: Add Diagnose Keywords button to Corpus Inspector
# ============================================================
print("\n=== Adding Diagnose Keywords button ===")

with open('src/console/CorpusInspectorView.tsx', 'r') as f:
    content = f.read()

# Add import
old_import = "import { SimpleErrorBoundary } from '../components/SimpleErrorBoundary';"
new_import = """import { SimpleErrorBoundary } from '../components/SimpleErrorBoundary';
import { KeywordDiagnosticsService } from '../services/keywordDiagnosticsService';"""

content = content.replace(old_import, new_import)

# Add the diagnose handler after handleFixHealth
old_handler = """    return (
        <SimpleErrorBoundary>"""

new_handler = """    const handleDiagnoseKeywords = async () => {
        log(`[UI_ACTION][CLICK] DIAGNOSE_KEYWORDS`);
        setLoading(true);
        try {
            const results = await KeywordDiagnosticsService.runDiagnostics(categoryId, log);
            log(`[DIAG] Complete. ${results.length} keywords analyzed.`);
            
            // Export as CSV to console for easy copy
            const csv = results
                .sort((a, b) => b.volume - a.volume)
                .map(r => `${r.keyword},${r.volume},${r.guardPass},${r.guardReason}`)
                .join('\\n');
            console.log(`KEYWORD_DIAG_CSV for ${categoryId}:\\nkeyword,volume,guard_pass,guard_reason\\n${csv}`);
            log(`[DIAG] CSV exported to browser console (F12 → Console tab)`);
        } catch (e: any) {
            log(`[DIAG][ERROR] ${e.message}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <SimpleErrorBoundary>"""

content = content.replace(old_handler, new_handler)

# Add the button after Certify button
old_button = """                    <ShieldCheck className="w-3.5 h-3.5"/> Certify
                    </button>
                </div>"""

new_button = """                    <ShieldCheck className="w-3.5 h-3.5"/> Certify
                    </button>
                    <div className="w-px h-6 bg-slate-200 mx-1"/>
                    <button 
                        onClick={handleDiagnoseKeywords}
                        disabled={!!activeJobId || loading}
                        className="px-3 py-1.5 bg-amber-50 border border-amber-200 text-amber-700 rounded-lg text-xs font-bold hover:bg-amber-100 disabled:opacity-50 flex items-center gap-1.5"
                    >
                        <Microscope className="w-3.5 h-3.5"/> Diagnose Keywords
                    </button>
                </div>"""

content = content.replace(old_button, new_button)

with open('src/console/CorpusInspectorView.tsx', 'w') as f:
    f.write(content)
print("  OK: Added Diagnose Keywords button")

print("\n=== DONE ===")
print("Run: git add -A && git commit -m 'Add keyword diagnostics panel' && git push")
