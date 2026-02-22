
import { CorpusStore, CorpusRow, MetricsRow } from './corpusStore';
import { DataForSeoClient } from './demand_vNext/dataforseoClient';
import { CredsStore } from './credsStore';

export const CorpusEnricher = {
    
    async enrichCategoryAnchor(
        categoryId: string, 
        anchorId: string, 
        onProgress: (msg: string, pct: number) => void
    ): Promise<{ processed: number; success: number }> {
        
        // 1. Load Corpus
        const { rows } = await CorpusStore.loadSemantic();
        const targets = rows.filter(r => r.category_id === categoryId && r.anchor_id === anchorId);
        
        if (targets.length === 0) return { processed: 0, success: 0 };

        // 2. Get Creds (Preflight)
        const creds = await CredsStore.get();
        if (!creds || !creds.login || !creds.password) {
            throw new Error("MISSING_CREDS: Check Integrity Console.");
        }

        // 3. Batch Process
        const BATCH_SIZE = 100; // API Limit safety
        const metricsRows: MetricsRow[] = [];
        const uniqueKeywords = Array.from(new Set(targets.map(t => t.keyword_text))) as string[];
        
        let processedCount = 0;

        for (let i = 0; i < uniqueKeywords.length; i += BATCH_SIZE) {
            const batch = uniqueKeywords.slice(i, i + BATCH_SIZE);
            onProgress(`Fetching batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(uniqueKeywords.length/BATCH_SIZE)}`, (i / uniqueKeywords.length) * 100);

            try {
                // Call API
                // Fixed: use fetchLiveVolume not fetchLiveVolumeSample
                const resultsRes = await DataForSeoClient.fetchLiveVolume(
                    creds as {login:string; password:string}, 
                    batch, 
                    2356 // India
                );

                const results = resultsRes.parsedRows || [];

                // Map back to corpus rows
                for (const res of results) {
                    const matchingRows = targets.filter(t => t.keyword_text === res.keyword);
                    
                    for (const row of matchingRows) {
                        metricsRows.push({
                            keyword_id: row.keyword_id,
                            location_code: 2356,
                            volume_monthly: res.search_volume || 0,
                            cpc: res.cpc || 0,
                            competition_index: res.competition_index || 0,
                            status: (res.search_volume || 0) > 0 ? 'OK' : 'ZERO',
                            dataforseo_task_id: 'live',
                            fetched_at_iso: new Date().toISOString()
                        });
                    }
                }
                
                processedCount += batch.length;

            } catch (e) {
                console.error("Enrichment batch failed", e);
                // Continue to next batch
            }
        }

        // 4. Save Snapshot
        if (metricsRows.length > 0) {
            await CorpusStore.saveMetricsSnapshot(metricsRows);
        }

        return { processed: processedCount, success: metricsRows.length };
    }
};
