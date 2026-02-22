
import { StorageAdapter } from './storageAdapter';

export interface CorpusRow {
    keyword_id: string;
    keyword_text: string;
    language_code: string;
    category_id: string;
    anchor_id: string;
    intent_bucket: string;
    source: 'SEED' | 'HYDRATE' | 'STRATEGY';
    created_at_iso: string;
    validation?: {
        status: 'UNVALIDATED' | 'VALID' | 'ZERO' | 'ERROR' | 'LOW' | 'UNVERIFIED';
        checked_at_iso?: string;
        location_code?: number;
        volume?: number;
        cpc?: number;
        competition?: number;
        source?: 'DATAFORSEO';
        error?: string;
    };
}

export interface MetricsRow {
    keyword_id: string;
    location_code: number;
    volume_monthly: number;
    cpc: number;
    competition_index: number;
    competition?: number;
    status: string;
    dataforseo_task_id: string;
    fetched_at_iso: string;
}

const SEMANTIC_KEY = 'mci_corpus_semantic_jsonl';
const META_KEY = 'mci_corpus_last_updated_iso';
const METRICS_KEY = 'mci_metrics_snapshot';

function simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) + hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
}

export const CorpusStore = {
    async loadCorpus(): Promise<CorpusRow[]> {
        try {
            const raw = localStorage.getItem(SEMANTIC_KEY);
            if (!raw) return [];
            return raw.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
        } catch (e) {
            console.error("Corpus load failed", e);
            return [];
        }
    },

    // Raw Accessors for Persistence Layer
    getRawJsonl(): string {
        return localStorage.getItem(SEMANTIC_KEY) || "";
    },

    async setRawJsonl(jsonl: string): Promise<void> {
        try {
            localStorage.setItem(SEMANTIC_KEY, jsonl);
            localStorage.setItem(META_KEY, new Date().toISOString());
        } catch (e) {
            console.error("Failed to set raw JSONL", e);
            throw e;
        }
    },

    // Compatibility Alias
    async loadSemantic(): Promise<{ rows: CorpusRow[] }> {
        const rows = await this.loadCorpus();
        return { rows };
    },

    async appendCorpusRows(rows: Omit<CorpusRow, 'keyword_id' | 'created_at_iso'>[]): Promise<{ added: number; total: number }> {
        try {
            const current = await this.loadCorpus();
            // Use compound key to dedup effectively
            const existingMap = new Set(current.map(r => 
                (r.keyword_text || "").toLowerCase().trim() + '|' + (r.category_id || "") + '|' + (r.anchor_id || "")
            ));
            
            let added = 0;
            const finalRows = [...current];
            const now = new Date().toISOString();

            for (const row of rows) {
                const normText = (row.keyword_text || "").toLowerCase().trim();
                const key = normText + '|' + row.category_id + '|' + row.anchor_id;
                
                if (!existingMap.has(key)) {
                    existingMap.add(key);
                    const newRow: CorpusRow = {
                        ...row,
                        keyword_text: normText,
                        keyword_id: simpleHash(key + row.intent_bucket),
                        created_at_iso: now
                    };
                    finalRows.push(newRow);
                    added++;
                }
            }

            if (added > 0) {
                localStorage.setItem(SEMANTIC_KEY, finalRows.map(r => JSON.stringify(r)).join('\n'));
                localStorage.setItem(META_KEY, now);
            }

            return { added, total: finalRows.length };
        } catch (e) {
            console.error("Corpus append failed", e);
            return { added: 0, total: 0 };
        }
    },

    // Compatibility Alias
    async appendSemanticRows(rows: Omit<CorpusRow, 'keyword_id' | 'created_at_iso'>[]): Promise<{ added: number; skipped: number }> {
        const res = await this.appendCorpusRows(rows);
        return { added: res.added, skipped: rows.length - res.added };
    },

    async getCorpusStats(categoryId?: string): Promise<{ total: number; byCategory: number; byAnchorCount: number; lastUpdatedIso: string | null; }> {
        try {
            const raw = localStorage.getItem(SEMANTIC_KEY) || "";
            const rows = raw ? raw.split('\n').filter(l => l.trim()).map(l => JSON.parse(l)) : [];
            const lastUpdatedIso = localStorage.getItem(META_KEY);
            
            let filtered = rows;
            if (categoryId) {
                filtered = rows.filter(r => r.category_id === categoryId);
            }

            const anchors = new Set(filtered.map(r => r.anchor_id));
            
            return {
                total: rows.length,
                byCategory: filtered.length,
                byAnchorCount: anchors.size,
                lastUpdatedIso
            };
        } catch (e) {
            return { total: 0, byCategory: 0, byAnchorCount: 0, lastUpdatedIso: null };
        }
    },

    async generateDeterministicId(payload: any): Promise<string> {
        const str = JSON.stringify(payload);
        return simpleHash(str);
    },

    async saveMetricsSnapshot(rows: MetricsRow[]): Promise<void> {
        try {
            const existingRaw = localStorage.getItem(METRICS_KEY);
            let allMetrics = existingRaw ? JSON.parse(existingRaw) : [];
            const map = new Map(allMetrics.map((m: any) => [m.keyword_id, m]));
            rows.forEach(r => map.set(r.keyword_id, r));
            
            const final = Array.from(map.values());
            localStorage.setItem(METRICS_KEY, JSON.stringify(final));
        } catch(e) {
            console.error("Save metrics failed", e);
        }
    },

    async computeSemanticHash(rows: CorpusRow[]): Promise<string> {
        const ids = rows.map(r => r.keyword_id).sort().join(',');
        return simpleHash(ids);
    }
};
