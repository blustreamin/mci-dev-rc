/**
 * PlatformSignalHarvester V2 — Uses Gemini + Google Search Grounding
 * 
 * Instead of DFS SERP API (which requires a proxy that doesn't support SERP endpoints),
 * this uses Gemini's built-in Google Search tool to find real market signals.
 * 
 * Flow: Top corpus keywords → Gemini searches Google → Returns real URLs with titles/snippets
 */

import { GoogleGenAI } from "@google/genai";
import { PlatformDB } from './platformDB';
import { CategoryBaseline } from '../types';

// --- TYPES ---

export type SignalPlatform = 'GOOGLE' | 'REDDIT' | 'YOUTUBE' | 'AMAZON' | 'QUORA' | 'TWITTER' | 'BLOG' | 'NEWS';

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
    signalType: 'Content' | 'Conversation' | 'Transaction';
    confidence: number;
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

// --- HELPERS ---

function getApiKey(): string | undefined {
    try { return (import.meta as any).env?.VITE_GOOGLE_API_KEY || (import.meta as any).env?.VITE_GEMINI_API_KEY; } catch { return undefined; }
}

function classifyPlatform(url: string): SignalPlatform {
    if (url.includes('reddit.com')) return 'REDDIT';
    if (url.includes('youtube.com') || url.includes('youtu.be')) return 'YOUTUBE';
    if (url.includes('amazon.')) return 'AMAZON';
    if (url.includes('quora.com')) return 'QUORA';
    if (url.includes('twitter.com') || url.includes('x.com')) return 'TWITTER';
    if (url.includes('news.') || url.includes('ndtv.') || url.includes('timesofindia') || url.includes('economictimes')) return 'NEWS';
    return 'BLOG';
}

function classifyType(url: string, platform: SignalPlatform): 'Content' | 'Conversation' | 'Transaction' {
    if (['AMAZON'].includes(platform)) return 'Transaction';
    if (['REDDIT', 'QUORA', 'TWITTER'].includes(platform)) return 'Conversation';
    return 'Content';
}

function stableId(url: string): string {
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
        hash = ((hash << 5) - hash) + url.charCodeAt(i);
        hash = hash & hash;
    }
    return `sig_${Math.abs(hash).toString(36)}`;
}

// --- GEMINI SEARCH HARVEST ---

async function harvestWithGemini(
    query: string,
    categoryId: string,
    categoryName: string,
    onProgress?: ProgressCallback,
): Promise<HarvestedSignal[]> {
    const apiKey = getApiKey();
    if (!apiKey) return [];

    const ai = new GoogleGenAI({ apiKey });

    const prompt = `Search Google for: "${query}"

Return the top 10 most relevant search results as a JSON array. For each result, include:
- url: the full URL
- title: the page title
- snippet: a 1-2 sentence description of the content

OUTPUT FORMAT (strict JSON array):
[{"url": "https://...", "title": "...", "snippet": "..."}]

Only return real, existing URLs from the search results. Do NOT make up URLs.
Output ONLY the JSON array, nothing else.`;

    try {
        const resp = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: prompt,
            config: {
                tools: [{ googleSearch: {} }],
            },
        });

        const text = resp.text || '';
        // Extract JSON from response (might have markdown wrapping)
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
            console.warn(`[SignalHarvester] No JSON array found in response for "${query}"`);
            return [];
        }

        const parsed = JSON.parse(jsonMatch[0]);
        if (!Array.isArray(parsed)) return [];

        return parsed
            .filter((r: any) => r.url && r.title)
            .map((r: any) => {
                const platform = classifyPlatform(r.url);
                return {
                    id: stableId(r.url),
                    url: r.url,
                    title: r.title,
                    snippet: r.snippet || '',
                    platform,
                    queryUsed: query,
                    categoryId,
                    categoryName,
                    collectedAt: new Date().toISOString(),
                    signalType: classifyType(r.url, platform),
                    confidence: 0.7,
                };
            });

    } catch (e: any) {
        console.warn(`[SignalHarvester] Gemini search failed for "${query}": ${e.message}`);
        return [];
    }
}

// --- PUBLIC API ---

export const PlatformSignalHarvester = {

    async harvestAll(
        category: CategoryBaseline,
        geo: { locationCode: number; language: string },
        _platforms: string[] = [], // Ignored — Gemini searches all
        onProgress?: ProgressCallback,
    ): Promise<FullHarvestResult> {
        const start = Date.now();
        const categoryId = category.id;
        const categoryName = category.category;

        // Build search queries from category context
        const coreTerms: string[] = [];
        const words = categoryName.toLowerCase().replace(/[&]/g, ' ').split(/\s+/).filter((w: string) => w.length > 2);
        const stopwords = new Set(['premium', 'fresh', 'artisanal', 'the', 'and', 'for', 'with', 'specialty']);
        const meaningful = words.filter((w: string) => !stopwords.has(w));
        const primary = meaningful.slice(0, 2).join(' ') || words[0] || categoryName;

        // Load top corpus keywords for query diversity
        let topKeywords: string[] = [];
        try {
            const corpus = await PlatformDB.getCorpus(categoryId);
            if (corpus?.rows) {
                topKeywords = corpus.rows
                    .filter((r: any) => (r.volume || 0) > 0)
                    .sort((a: any, b: any) => (b.volume || 0) - (a.volume || 0))
                    .slice(0, 8)
                    .map((r: any) => r.keyword_text || '');
            }
        } catch (e) { /* continue */ }

        // Build diverse queries
        const queries = [
            `${primary} review India`,
            `best ${primary} brand`,
            `${primary} reddit discussion`,
            `${primary} YouTube review`,
            `${primary} price comparison`,
            ...topKeywords.slice(0, 3),
        ].filter(q => q.length > 3);

        onProgress?.(`Searching ${queries.length} queries via Google Search...`);

        const allSignals = new Map<string, HarvestedSignal>(); // URL-dedupe
        const errors: string[] = [];

        for (let i = 0; i < queries.length; i++) {
            const query = queries[i];
            onProgress?.(`[${i + 1}/${queries.length}] Searching: "${query.substring(0, 50)}"...`);

            try {
                const signals = await harvestWithGemini(query, categoryId, categoryName, onProgress);
                for (const sig of signals) {
                    if (!allSignals.has(sig.url)) {
                        allSignals.set(sig.url, sig);
                    }
                }
                onProgress?.(`[${i + 1}/${queries.length}] "${query.substring(0, 30)}" → ${signals.length} results (total: ${allSignals.size})`);
            } catch (e: any) {
                errors.push(`${query}: ${e.message}`);
            }

            // Rate limit between Gemini calls
            if (i < queries.length - 1) {
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        const signalsArray = Array.from(allSignals.values());

        // Count by platform
        const byPlatform: Record<string, number> = {};
        signalsArray.forEach(s => { byPlatform[s.platform] = (byPlatform[s.platform] || 0) + 1; });

        // Save to PlatformDB
        await PlatformDB.setCache(`signals_${categoryId}`, {
            categoryId,
            signals: signalsArray,
            byPlatform,
            harvestedAt: new Date().toISOString(),
            totalSignals: signalsArray.length,
        });

        onProgress?.(`Done: ${signalsArray.length} signals from ${queries.length} queries`);

        return {
            ok: true,
            categoryId,
            totalSignals: signalsArray.length,
            byPlatform,
            elapsedMs: Date.now() - start,
            errors,
        };
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
