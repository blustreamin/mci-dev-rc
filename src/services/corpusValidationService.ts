
import { CorpusStore, CorpusRow } from './corpusStore';
import { DataForSeoClient } from './demand_vNext/dataforseoClient';
import { CredsStore } from './demand_vNext/credsStore';

export const CorpusValidationService = {
    
    async validateKeywordsSample(
        keywords: string[], 
        locationCode: number = 2356
    ): Promise<{
        ok: boolean;
        rows: Array<{ keyword: string; volume: number; cpc: number; competition: number; status: 'VALID'|'ZERO' }>;
        zeroCount: number;
        validCount: number;
        ms: number;
        error?: string;
    }> {
        const start = Date.now();
        const creds = await CredsStore.get();
        
        if (!creds || !creds.login || !creds.password) {
            return { ok: false, rows: [], zeroCount: 0, validCount: 0, ms: 0, error: "Missing DataForSEO Credentials. Check Integrity Console." };
        }

        try {
            // Batching handled by caller or simple single batch if small sample
            const res = await DataForSeoClient.fetchLiveVolume(
                creds as {login: string, password: string}, 
                keywords, 
                locationCode
            );

            if (!res.ok) {
                return { ok: false, rows: [], zeroCount: 0, validCount: 0, ms: Date.now() - start, error: res.error };
            }

            const rows = (res.parsedRows || []).map(r => {
                const vol = r.search_volume || 0;
                return {
                    keyword: r.keyword,
                    volume: vol,
                    cpc: r.cpc || 0,
                    competition: r.competition_index || r.competition || 0,
                    status: (vol > 0 ? 'VALID' : 'ZERO') as 'VALID' | 'ZERO'
                };
            });

            const validCount = rows.filter(r => r.status === 'VALID').length;
            const zeroCount = rows.filter(r => r.status === 'ZERO').length;

            return {
                ok: true,
                rows,
                validCount,
                zeroCount,
                ms: Date.now() - start
            };

        } catch (e: any) {
            return { ok: false, rows: [], zeroCount: 0, validCount: 0, ms: Date.now() - start, error: e.message };
        }
    },

    async applyValidationToCorpus(
        categoryId: string | null, 
        anchorId: string | null, 
        results: Array<{ keyword: string; volume: number; cpc: number; competition: number; status: 'VALID'|'ZERO' }>
    ): Promise<{ updatedCount: number }> {
        if (results.length === 0) return { updatedCount: 0 };

        const fullCorpus = await CorpusStore.loadCorpus();
        let updatedCount = 0;
        
        // Map results for fast lookup (normalize key)
        const resMap = new Map();
        results.forEach(r => resMap.set(r.keyword.toLowerCase().trim(), r));

        const newCorpus = fullCorpus.map(row => {
            const norm = (row.keyword_text || "").toLowerCase().trim();
            
            // Context Filters
            if (categoryId && row.category_id !== categoryId) return row;
            if (anchorId && row.anchor_id !== anchorId) return row;

            const res = resMap.get(norm);
            if (res) {
                updatedCount++;
                return {
                    ...row,
                    validation: {
                        status: res.status,
                        checked_at_iso: new Date().toISOString(),
                        location_code: 2356, 
                        volume: res.volume,
                        cpc: res.cpc,
                        competition: res.competition,
                        source: 'DATAFORSEO' as const
                    }
                };
            }
            return row;
        });

        if (updatedCount > 0) {
            const jsonl = newCorpus.map(r => JSON.stringify(r)).join('\n');
            await CorpusStore.setRawJsonl(jsonl);
        }

        return { updatedCount };
    }
};
