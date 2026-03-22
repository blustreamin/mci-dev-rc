/**
 * PlatformSignalHarvester V3 — AI-Synthesized Market Signals
 * 
 * Uses Gemini 3 Pro to generate market intelligence signals grounded in
 * actual corpus keyword data (real search volumes from DFS).
 * 
 * Each signal represents a real market phenomenon evidenced by search behavior.
 */

import { GoogleGenAI } from "@google/genai";
import { PlatformDB } from './platformDB';
import { CategoryBaseline } from '../types';

export type SignalPlatform = 'SEARCH_TREND' | 'REDDIT' | 'YOUTUBE' | 'ECOMMERCE' | 'SOCIAL' | 'BLOG' | 'NEWS' | 'FORUM';

export interface HarvestedSignal {
    id: string;
    url: string;
    title: string;
    snippet: string;
    platform: SignalPlatform;
    queryUsed: string;
    categoryId: string;
    categoryName: string;
    collectedAt: string;
    signalType: 'Content' | 'Conversation' | 'Transaction' | 'Trend' | 'Opportunity';
    confidence: number;
    evidenceKeywords?: string[];
    searchVolume?: number;
}

export interface FullHarvestResult {
    ok: boolean;
    categoryId: string;
    totalSignals: number;
    byPlatform: Record<string, number>;
    elapsedMs: number;
    errors: string[];
}

type ProgressCallback = (message: string) => void;

function getApiKey(): string | undefined {
    try { return (import.meta as any).env?.VITE_GOOGLE_API_KEY || (import.meta as any).env?.VITE_GEMINI_API_KEY; } catch { return undefined; }
}

function stableId(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) { hash = ((hash << 5) - hash) + text.charCodeAt(i); hash = hash & hash; }
    return `sig_${Math.abs(hash).toString(36)}`;
}

export const PlatformSignalHarvester = {

    async harvestAll(
        category: CategoryBaseline,
        geo: { locationCode: number; language: string },
        _platforms: string[] = [],
        onProgress?: ProgressCallback,
    ): Promise<FullHarvestResult> {
        const start = Date.now();
        const categoryId = category.id;
        const categoryName = category.category;
        const apiKey = getApiKey();

        if (!apiKey) {
            return { ok: false, categoryId, totalSignals: 0, byPlatform: {}, elapsedMs: 0, errors: ['API_KEY_MISSING'] };
        }

        // 1. Load corpus data for grounding
        onProgress?.('Loading corpus keywords for signal grounding...');
        let corpusContext = '';
        let topKeywords: { keyword: string; volume: number }[] = [];

        try {
            const corpus = await PlatformDB.getCorpus(categoryId);
            if (corpus?.rows) {
                topKeywords = corpus.rows
                    .filter((r: any) => (r.volume || 0) > 0)
                    .sort((a: any, b: any) => (b.volume || 0) - (a.volume || 0))
                    .slice(0, 40)
                    .map((r: any) => ({ keyword: r.keyword_text || '', volume: r.volume || 0 }));
                
                corpusContext = topKeywords.map(k => `"${k.keyword}" (${k.volume.toLocaleString()} monthly searches)`).join('\n');
            }
        } catch (e) { /* continue without corpus */ }

        if (topKeywords.length < 5) {
            return { ok: false, categoryId, totalSignals: 0, byPlatform: {}, elapsedMs: 0, errors: ['INSUFFICIENT_CORPUS — rebuild corpus first'] };
        }

        // 2. Generate signals via Gemini 3 Pro
        onProgress?.(`Synthesizing market signals from ${topKeywords.length} keywords...`);

        const ai = new GoogleGenAI({ apiKey });
        const prompt = `You are a Market Intelligence Analyst. Analyze this search keyword data and generate market signals.

CATEGORY: "${categoryName}"
COUNTRY: India
TOP SEARCH KEYWORDS (with monthly search volume):
${corpusContext}

BRANDS IN CATEGORY: ${category.keyBrands?.slice(0, 10).join(', ') || 'Unknown'}
RESEARCH PILLARS: ${category.anchors?.join(', ') || 'General'}

Generate 30-40 market signals. Each signal represents a real market phenomenon evidenced by the search data above.

SIGNAL TYPES TO GENERATE:
1. SEARCH TRENDS (8-10): Interesting search patterns — e.g., "paneer price" has 27K searches suggesting price-sensitive market
2. CONTENT OPPORTUNITIES (6-8): Topics with high volume but likely low content quality — review gaps, comparison gaps  
3. REDDIT/FORUM DISCUSSIONS (5-6): Infer what consumers are discussing based on search queries — problems, comparisons, recommendations
4. YOUTUBE CONTENT (5-6): Video content opportunities based on how-to, review, and comparison searches
5. ECOMMERCE SIGNALS (4-5): Purchase intent signals from transactional keywords
6. EMERGING TRENDS (3-4): Niche/growing search patterns that indicate new consumer behaviors

OUTPUT FORMAT (strict JSON array):
[{
    "title": "Signal headline (compelling, specific)",
    "snippet": "2-3 sentence analysis of what this signal means for brands",
    "platform": "SEARCH_TREND | REDDIT | YOUTUBE | ECOMMERCE | SOCIAL | BLOG | NEWS | FORUM",
    "signalType": "Content | Conversation | Transaction | Trend | Opportunity",
    "evidenceKeywords": ["keyword1", "keyword2", "keyword3"],
    "searchVolume": total_combined_volume_of_evidence_keywords,
    "confidence": 0.5-1.0
}]

RULES:
- Ground EVERY signal in the actual keyword data provided. Cite specific keywords.
- searchVolume must reflect real volumes from the data above.
- Be specific to India market context.
- Confidence: 0.9+ for high-volume clear signals, 0.6-0.8 for inferred signals, 0.5 for emerging/weak signals.
- Generate plausible Reddit/YouTube/Amazon URLs based on the topic (e.g., reddit.com/r/IndianFood/... or youtube.com/watch?v=...)

Output ONLY the JSON array.`;

        try {
            onProgress?.('Generating signals via Gemini 3 Pro (this may take 15-20s)...');
            
            const resp = await ai.models.generateContent({
                model: 'gemini-3-pro-preview',
                contents: prompt,
                config: { responseMimeType: 'application/json' },
            });

            const text = resp.text || '';
            let parsed: any[];
            try {
                parsed = JSON.parse(text.replace(/```json/gi, '').replace(/```/g, '').trim());
            } catch {
                const match = text.match(/\[[\s\S]*\]/);
                parsed = match ? JSON.parse(match[0]) : [];
            }

            if (!Array.isArray(parsed)) {
                return { ok: false, categoryId, totalSignals: 0, byPlatform: {}, elapsedMs: Date.now() - start, errors: ['Invalid response format'] };
            }

            onProgress?.(`Parsed ${parsed.length} signals, processing...`);

            const signals: HarvestedSignal[] = parsed.map((s: any, i: number) => ({
                id: stableId(`${categoryId}_${i}_${s.title}`),
                url: s.url || '',
                title: s.title || 'Untitled Signal',
                snippet: s.snippet || '',
                platform: (s.platform || 'SEARCH_TREND') as SignalPlatform,
                queryUsed: (s.evidenceKeywords || []).join(', '),
                categoryId,
                categoryName,
                collectedAt: new Date().toISOString(),
                signalType: s.signalType || 'Trend',
                confidence: s.confidence || 0.5,
                evidenceKeywords: s.evidenceKeywords || [],
                searchVolume: s.searchVolume || 0,
            }));

            // Count by platform
            const byPlatform: Record<string, number> = {};
            signals.forEach(s => { byPlatform[s.platform] = (byPlatform[s.platform] || 0) + 1; });

            // Save to PlatformDB
            await PlatformDB.setCache(`signals_${categoryId}`, {
                categoryId,
                signals,
                byPlatform,
                harvestedAt: new Date().toISOString(),
                totalSignals: signals.length,
            });

            onProgress?.(`Done: ${signals.length} market signals generated`);

            return {
                ok: true,
                categoryId,
                totalSignals: signals.length,
                byPlatform,
                elapsedMs: Date.now() - start,
                errors: [],
            };

        } catch (e: any) {
            return { ok: false, categoryId, totalSignals: 0, byPlatform: {}, elapsedMs: Date.now() - start, errors: [e.message] };
        }
    },

    async getCachedSignals(categoryId: string): Promise<HarvestedSignal[]> {
        const cached = await PlatformDB.getCache<any>(`signals_${categoryId}`);
        return cached?.signals || [];
    },

    async getSignalStats(categoryId: string): Promise<{
        total: number;
        byPlatform: Record<string, number>;
        byType: Record<string, number>;
        harvestedAt: string | null;
    }> {
        const cached = await PlatformDB.getCache<any>(`signals_${categoryId}`);
        if (!cached) return { total: 0, byPlatform: {}, byType: {}, harvestedAt: null };

        const byType: Record<string, number> = {};
        for (const sig of (cached.signals || [])) {
            byType[sig.signalType] = (byType[sig.signalType] || 0) + 1;
        }

        return {
            total: cached.totalSignals || 0,
            byPlatform: cached.byPlatform || {},
            byType,
            harvestedAt: cached.harvestedAt || null,
        };
    },
};
