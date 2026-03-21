/**
 * PlatformSignalHarvester — SERP Signal Collection for Dynamic Categories
 * 
 * Ported from blustream-signal-harvester-main with these changes:
 * 1. Categories come from ProjectStore (dynamic) instead of hardcoded mensCareCategories
 * 2. DFS calls go through the platform's proxy-aware DataForSeoClient
 * 3. Results saved to PlatformDB instead of Firestore
 * 4. Simplified: no Gemini enrichment in first pass (just raw SERP harvest)
 * 
 * Provider coverage: Google SERP, Reddit, YouTube, Amazon.in, Quora, Twitter
 */

import { CredsStore } from './demand_vNext/credsStore';
import { PlatformDB } from './platformDB';
import { CategoryBaseline } from '../types';

// --- TYPES ---

export type SignalPlatform = 'GOOGLE_SERP' | 'REDDIT' | 'QUORA' | 'AMAZON' | 'YOUTUBE' | 'TWITTER';

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

export interface HarvestResult {
    ok: boolean;
    categoryId: string;
    platform: SignalPlatform;
    signals: HarvestedSignal[];
    queriesUsed: number;
    elapsedMs: number;
    error?: string;
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

// --- QUERY BUILDING ---

function buildSerpQuery(platform: SignalPlatform, categoryLabel: string, anchors: string[]): string[] {
    const anchorChunks: string[][] = [];
    for (let i = 0; i < anchors.length; i += 4) {
        anchorChunks.push(anchors.slice(i, i + 4));
    }

    const queries: string[] = [];

    switch (platform) {
        case 'GOOGLE_SERP':
            queries.push(`${categoryLabel} reviews`);
            for (const chunk of anchorChunks.slice(0, 2)) {
                queries.push(`${categoryLabel} (${chunk.join(' OR ')})`);
            }
            break;
        case 'REDDIT':
            queries.push(`site:reddit.com "${categoryLabel}" review`);
            if (anchorChunks[0]) {
                queries.push(`site:reddit.com "${categoryLabel}" (${anchorChunks[0].join(' OR ')})`);
            }
            break;
        case 'YOUTUBE':
            queries.push(`site:youtube.com inurl:watch "${categoryLabel}" review`);
            break;
        case 'AMAZON':
            queries.push(`site:amazon.in "${categoryLabel}"`);
            break;
        case 'QUORA':
            queries.push(`site:quora.com "${categoryLabel}"`);
            break;
        case 'TWITTER':
            queries.push(`site:twitter.com inurl:/status/ "${categoryLabel}" (review OR "worth it")`);
            break;
    }

    return queries.slice(0, 4); // Max 4 queries per platform
}

function classifySignalType(url: string, platform: SignalPlatform): 'Content' | 'Conversation' | 'Transaction' {
    if (platform === 'AMAZON') return 'Transaction';
    if (['REDDIT', 'QUORA', 'TWITTER'].includes(platform)) return 'Conversation';
    if (platform === 'YOUTUBE') return 'Content';
    // Google SERP — heuristic
    if (url.includes('amazon.') || url.includes('flipkart.') || url.includes('/buy')) return 'Transaction';
    if (url.includes('reddit.') || url.includes('quora.')) return 'Conversation';
    return 'Content';
}

function stableId(platform: string, url: string): string {
    // Simple hash for deduplication
    let hash = 0;
    const str = `${platform}:${url}`;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash = hash & hash;
    }
    return `sig_${platform.toLowerCase()}_${Math.abs(hash).toString(36)}`;
}

function normalizeAnchors(rawAnchors: string[], limit: number = 8): string[] {
    const terms = new Set<string>();
    for (const raw of rawAnchors) {
        const parts = raw.split(/[\/&(),]+/);
        for (const part of parts) {
            const clean = part.trim().toLowerCase();
            if (clean.length >= 3) terms.add(clean);
        }
    }
    return Array.from(terms).slice(0, limit);
}

// --- CORE DFS SERP CALL ---

async function callDfsSerpLive(
    query: string,
    creds: { login: string; password: string },
    locationCode: number,
    language: string,
    depth: number = 20
): Promise<any[]> {
    // Use platform's proxy-aware path
    const config = await CredsStore.resolveDfsConfig();
    const proxyUrl = config.proxyUrl;

    const payload = [{
        keyword: query,
        location_code: locationCode,
        language_code: language,
        depth: depth,
    }];

    const path = 'serp/google/organic/live/advanced';

    if (proxyUrl) {
        // Proxy mode
        const baseUrl = proxyUrl.replace(/\/$/, '');
        const url = `${baseUrl}/dfs/proxy`;
        const proxyPayload = { path, payload, creds, method: 'POST' };

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-API-Key': 'dev-key' },
            body: JSON.stringify(proxyPayload),
        });

        if (!res.ok) throw new Error(`DFS Proxy ${res.status}`);
        const wrapper = await res.json();
        const data = wrapper.data || wrapper;
        return data.tasks?.[0]?.result?.[0]?.items || [];
    } else {
        // Direct mode
        const auth = btoa(`${creds.login}:${creds.password}`);
        const res = await fetch(`https://api.dataforseo.com/v3/${path}`, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        if (!res.ok) throw new Error(`DFS Direct ${res.status}`);
        const data = await res.json();
        return data.tasks?.[0]?.result?.[0]?.items || [];
    }
}

// --- SINGLE PLATFORM HARVEST ---

async function harvestPlatform(
    platform: SignalPlatform,
    category: CategoryBaseline,
    creds: { login: string; password: string },
    locationCode: number,
    language: string,
    onProgress?: ProgressCallback,
): Promise<HarvestResult> {
    const start = Date.now();
    const anchors = normalizeAnchors(category.anchors || []);
    const queries = buildSerpQuery(platform, category.category, anchors);
    const signals = new Map<string, HarvestedSignal>(); // URL-keyed for dedupe
    const TARGET = 30;

    onProgress?.(`[${platform}] Running ${queries.length} queries...`);

    for (const query of queries) {
        if (signals.size >= TARGET) break;

        try {
            const items = await callDfsSerpLive(query, creds, locationCode, language);

            for (const item of items) {
                if (signals.size >= TARGET) break;
                if (!item.url) continue;

                // Platform-specific URL filter
                if (platform === 'REDDIT' && !item.url.includes('reddit.com')) continue;
                if (platform === 'YOUTUBE' && !item.url.includes('youtube.com') && !item.url.includes('youtu.be')) continue;
                if (platform === 'AMAZON' && !item.url.includes('amazon.')) continue;
                if (platform === 'QUORA' && !item.url.includes('quora.com')) continue;
                if (platform === 'TWITTER' && !item.url.includes('twitter.com') && !item.url.includes('x.com')) continue;

                const id = stableId(platform, item.url);
                if (signals.has(item.url)) continue;

                signals.set(item.url, {
                    id,
                    url: item.url,
                    title: item.title || 'Untitled',
                    snippet: item.description || '',
                    platform,
                    queryUsed: query,
                    categoryId: category.id,
                    categoryName: category.category,
                    collectedAt: new Date().toISOString(),
                    signalType: classifySignalType(item.url, platform),
                    confidence: 0.5, // Default — enrichment would refine this
                });
            }
        } catch (e: any) {
            onProgress?.(`[${platform}] Query failed: ${e.message}`);
        }

        // Rate limit between queries
        await new Promise(r => setTimeout(r, 500));
    }

    const result = Array.from(signals.values());
    onProgress?.(`[${platform}] Done: ${result.length} signals`);

    return {
        ok: true,
        categoryId: category.id,
        platform,
        signals: result,
        queriesUsed: queries.length,
        elapsedMs: Date.now() - start,
    };
}

// --- PUBLIC API ---

export const PlatformSignalHarvester = {

    /**
     * Harvest signals for a single platform + category.
     */
    async harvestSingle(
        platform: SignalPlatform,
        category: CategoryBaseline,
        geo: { locationCode: number; language: string },
        onProgress?: ProgressCallback,
    ): Promise<HarvestResult> {
        const creds = await CredsStore.get();
        if (!creds) {
            return { ok: false, categoryId: category.id, platform, signals: [], queriesUsed: 0, elapsedMs: 0, error: 'DFS_CREDS_MISSING' };
        }

        return harvestPlatform(platform, category, creds, geo.locationCode, geo.language, onProgress);
    },

    /**
     * Harvest signals across all platforms for a category.
     * This is the main entry point for the platform.
     */
    async harvestAll(
        category: CategoryBaseline,
        geo: { locationCode: number; language: string },
        platforms: SignalPlatform[] = ['GOOGLE_SERP', 'REDDIT', 'YOUTUBE'],
        onProgress?: ProgressCallback,
    ): Promise<FullHarvestResult> {
        const start = Date.now();
        const creds = await CredsStore.get();
        if (!creds) {
            return { ok: false, categoryId: category.id, totalSignals: 0, byPlatform: {}, elapsedMs: 0, errors: ['DFS_CREDS_MISSING'] };
        }

        const allSignals: HarvestedSignal[] = [];
        const byPlatform: Record<string, number> = {};
        const errors: string[] = [];

        for (const platform of platforms) {
            onProgress?.(`Harvesting ${platform}...`);

            try {
                const result = await harvestPlatform(platform, category, creds, geo.locationCode, geo.language, onProgress);
                allSignals.push(...result.signals);
                byPlatform[platform] = result.signals.length;
            } catch (e: any) {
                errors.push(`${platform}: ${e.message}`);
                byPlatform[platform] = 0;
            }
        }

        // Save to PlatformDB
        const storeKey = `signals_${category.id}`;
        await PlatformDB.setCache(storeKey, {
            categoryId: category.id,
            signals: allSignals,
            byPlatform,
            harvestedAt: new Date().toISOString(),
            totalSignals: allSignals.length,
        });

        onProgress?.(`Done: ${allSignals.length} signals across ${platforms.length} platforms`);

        return {
            ok: true,
            categoryId: category.id,
            totalSignals: allSignals.length,
            byPlatform,
            elapsedMs: Date.now() - start,
            errors,
        };
    },

    /**
     * Get previously harvested signals from cache.
     */
    async getCachedSignals(categoryId: string): Promise<HarvestedSignal[]> {
        const cached = await PlatformDB.getCache<any>(`signals_${categoryId}`);
        return cached?.signals || [];
    },

    /**
     * Get signal stats for display.
     */
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
