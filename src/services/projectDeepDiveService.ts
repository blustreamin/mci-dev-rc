/**
 * ProjectDeepDiveService — Generates deep dive reports for dynamic project categories.
 * 
 * Gathers: corpus keywords (PlatformDB), demand metrics (PlatformDB), signals (PlatformDB cache)
 * Synthesizes via Gemini 3 Pro with project-specific context (not hardcoded "Men of Bharat")
 */

import { GoogleGenAI } from "@google/genai";
import { PlatformDB } from './platformDB';
import { PlatformSignalHarvester, HarvestedSignal } from './platformSignalHarvester';
import { ProjectDefinition } from '../config/projectContext';

function getApiKey(): string | undefined {
    try { return (import.meta as any).env?.VITE_GOOGLE_API_KEY || (import.meta as any).env?.VITE_GEMINI_API_KEY; } catch { return undefined; }
}
function getAI() { const k = getApiKey(); if (!k) throw new Error("API Key missing"); return new GoogleGenAI({ apiKey: k }); }
function cleanJson(t: string) { return t.replace(/```json/gi, "").replace(/```/g, "").trim(); }

export interface DeepDiveSection {
    title: string;
    bullets: string[];
}

export interface ProjectDeepDiveResult {
    verdict: string;
    categoryName: string;
    geo: string;
    generatedAt: string;
    executiveSummary: { title: string; bullets: string[] };
    marketStructure: DeepDiveSection & { demandIndex: number; readiness: number; spread: number; trend: number };
    consumerNeeds: DeepDiveSection;
    behavioursRituals: DeepDiveSection;
    triggersBarriers: DeepDiveSection;
    strategicOpportunities: { title: string; description: string; strategy: string }[];
    brandMeaning: DeepDiveSection;
    ingredientsAtPlay: DeepDiveSection;
    packagingPricing: DeepDiveSection;
    regionalNuances: DeepDiveSection;
    influencerEcosystem: DeepDiveSection;
    measurementPlan: DeepDiveSection;
    inputCoverage: { corpusKeywords: number; demandMetrics: boolean; signalsCount: number };
}

export type DeepDiveProgress = { phase: string; message: string; pct: number };

export const ProjectDeepDiveService = {

    async generateDeepDive(
        project: ProjectDefinition,
        categoryId: string,
        onProgress?: (p: DeepDiveProgress) => void
    ): Promise<{ ok: boolean; result?: ProjectDeepDiveResult; error?: string }> {

        const emit = (phase: string, message: string, pct: number) => onProgress?.({ phase, message, pct });
        const gen = project.generatedCategory;
        if (!gen) return { ok: false, error: 'No generated category' };

        const categoryName = gen.category;
        const geo = `${project.geo.countryName} (${project.geo.language})`;

        // 1. GATHER INPUTS
        emit('GATHERING', 'Loading corpus keywords...', 10);
        const corpus = await PlatformDB.getCorpus(categoryId);
        const corpusRows = corpus?.rows || [];
        const validRows = corpusRows.filter((r: any) => (r.volume || 0) > 0);
        const topKeywords = validRows
            .sort((a: any, b: any) => (b.volume || 0) - (a.volume || 0))
            .slice(0, 50)
            .map((r: any) => `${r.keyword_text} (${r.volume})`);
        
        // Anchor breakdown
        const anchorMap: Record<string, number> = {};
        validRows.forEach((r: any) => { anchorMap[r.anchor_id] = (anchorMap[r.anchor_id] || 0) + (r.volume || 0); });
        const anchorSummary = Object.entries(anchorMap).sort((a, b) => b[1] - a[1]).map(([a, v]) => `${a}: ${v.toLocaleString()}`).join(', ');

        emit('GATHERING', 'Loading demand metrics...', 25);
        let demandData: any = null;
        let demandSummary = 'No demand data available';
        let metrics = { demand_index_mn: 0, readiness: 0, spread: 0, trend: 0 };

        // Try multiple sources for demand data
        try {
            // 1. Try PlatformDB demand output (month-keyed)
            const now = new Date();
            const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            demandData = await PlatformDB.getDemandOutput(categoryId, month);
            
            // 2. Try cache key
            if (!demandData) {
                demandData = await PlatformDB.getCache(`demand_${categoryId}`);
            }

            // 3. Try DemandOutputStore (Firestore) as fallback
            if (!demandData) {
                try {
                    const { DemandOutputStore } = await import('./demandOutputStore');
                    const fsDoc = await DemandOutputStore.readDemandDoc({ categoryId, month, country: project.geo.country, language: project.geo.language });
                    if (fsDoc) demandData = fsDoc;
                } catch (e) {
                    console.warn('[DeepDive] Firestore demand fallback failed:', e);
                }
            }
        } catch (e) {
            console.warn('[DeepDive] Demand loading failed:', e);
        }

        if (demandData) {
            const m = demandData.metrics || demandData.payload?.metrics || demandData;
            metrics = {
                demand_index_mn: m.demand_index_mn || m.demandIndexMn || 0,
                readiness: m.metric_scores?.readiness || m.readiness || 0,
                spread: m.metric_scores?.spread || m.spread || 0,
                trend: m.trend_5y?.value_percent || m.trend || 0,
            };
            demandSummary = `Demand: ${metrics.demand_index_mn.toFixed(2)} Mn searches, Readiness: ${metrics.readiness.toFixed(1)}/10, Spread: ${metrics.spread.toFixed(1)}/10, Trend: ${metrics.trend}%`;
            emit('GATHERING', `Demand loaded: ${demandSummary}`, 30);
        } else {
            emit('GATHERING', 'No demand data found — generating with corpus data only', 30);
        }

        emit('GATHERING', 'Loading market signals...', 40);
        const signals = await PlatformSignalHarvester.getCachedSignals(categoryId);
        const signalSummary = signals.length > 0
            ? signals.slice(0, 20).map(s => `[${s.platform}] ${s.title} — ${s.snippet?.substring(0, 100)}`).join('\n')
            : 'No signals harvested yet';

        const inputCoverage = { corpusKeywords: validRows.length, demandMetrics: !!demandData, signalsCount: signals.length };

        // 2. SYNTHESIZE via Gemini 3 Pro
        emit('SYNTHESIZING', 'Generating deep dive report via Gemini 3 Pro...', 50);

        const prompt = `You are a Senior Category Intelligence Analyst.
Generate a comprehensive Category Deep Dive report for: "${categoryName}" in ${geo}.

INPUT DATA:
1. DEMAND METRICS: ${demandSummary}
2. TOP KEYWORDS (by search volume): ${topKeywords.slice(0, 30).join(', ')}
3. ANCHOR DISTRIBUTION: ${anchorSummary}
4. MARKET SIGNALS (${signals.length} signals): 
${signalSummary}
5. PROJECT CONTEXT: Industry=${project.industry}, Category="${gen.consumerDescription}", Brands=${gen.keyBrands.slice(0, 10).join(', ')}

OUTPUT FORMAT (STRICT JSON):
{
    "verdict": "OK",
    "executiveSummary": { "title": "string", "bullets": ["min 12 comprehensive bullets"] },
    "marketStructure": { "title": "Market Structure", "demandIndex": ${metrics.demand_index_mn}, "readiness": ${metrics.readiness}, "spread": ${metrics.spread}, "trend": ${metrics.trend}, "bullets": ["min 10 bullets — cite EXACT metrics"] },
    "consumerNeeds": { "title": "Consumer Needs & Motivations", "bullets": ["min 12 bullets"] },
    "behavioursRituals": { "title": "Behaviours & Rituals", "bullets": ["min 10 bullets"] },
    "triggersBarriers": { "title": "Triggers, Barriers & Influences", "bullets": ["min 12 bullets"] },
    "strategicOpportunities": [{"title": "string", "description": "2-3 sentences", "strategy": "1-2 sentences"}],
    "brandMeaning": { "title": "Brand Landscape", "bullets": ["min 8 bullets on brands in ${project.geo.countryName}"] },
    "ingredientsAtPlay": { "title": "Ingredients & Attributes", "bullets": ["min 8 bullets on key product attributes"] },
    "packagingPricing": { "title": "Packaging & Pricing", "bullets": ["min 8 bullets on pack formats, pricing ladders, triggers"] },
    "regionalNuances": { "title": "Regional Nuances", "bullets": ["min 8 bullets on regional differences in ${project.geo.countryName}"] },
    "influencerEcosystem": { "title": "Influencer & Content Ecosystem", "bullets": ["min 6 bullets"] },
    "measurementPlan": { "title": "Measurement Plan", "bullets": ["min 6 KPIs and tracking recommendations"] }
}

RULES:
- Ground ALL analysis in the provided data. Do NOT hallucinate metrics.
- Be specific to ${project.geo.countryName} market — use local context, platforms, brands.
- strategicOpportunities must have 7+ distinct opportunities with actionable strategies.
- Consumer voices should be in ${project.geo.languageName || 'English'}.
- Output ONLY JSON.`;

        try {
            const ai = getAI();
            const resp = await ai.models.generateContent({
                model: 'gemini-3-pro-preview',
                contents: prompt,
                config: { responseMimeType: 'application/json' },
            });

            emit('PARSING', 'Parsing deep dive output...', 85);
            const raw = JSON.parse(cleanJson(resp.text || "{}"));

            if (raw.verdict === 'FAIL') {
                return { ok: false, error: `Model refused: ${raw.failCode || 'Unknown'}` };
            }

            const result: ProjectDeepDiveResult = {
                verdict: 'OK',
                categoryName,
                geo,
                generatedAt: new Date().toISOString(),
                executiveSummary: raw.executiveSummary || { title: categoryName, bullets: [] },
                marketStructure: raw.marketStructure || { title: 'Market Structure', bullets: [], ...metrics },
                consumerNeeds: raw.consumerNeeds || { title: 'Consumer Needs', bullets: [] },
                behavioursRituals: raw.behavioursRituals || { title: 'Behaviours', bullets: [] },
                triggersBarriers: raw.triggersBarriers || { title: 'Triggers & Barriers', bullets: [] },
                strategicOpportunities: raw.strategicOpportunities || [],
                brandMeaning: raw.brandMeaning || { title: 'Brand Landscape', bullets: [] },
                ingredientsAtPlay: raw.ingredientsAtPlay || { title: 'Ingredients', bullets: [] },
                packagingPricing: raw.packagingPricing || { title: 'Packaging & Pricing', bullets: [] },
                regionalNuances: raw.regionalNuances || { title: 'Regional Nuances', bullets: [] },
                influencerEcosystem: raw.influencerEcosystem || { title: 'Influencer Ecosystem', bullets: [] },
                measurementPlan: raw.measurementPlan || { title: 'Measurement Plan', bullets: [] },
                inputCoverage,
            };

            // Save to PlatformDB
            emit('SAVING', 'Saving report...', 95);
            await PlatformDB.setCache(`deep_dive_${categoryId}`, result);

            emit('DONE', 'Deep dive complete', 100);
            return { ok: true, result };

        } catch (e: any) {
            return { ok: false, error: `Gemini error: ${e.message}` };
        }
    },

    async getCachedDeepDive(categoryId: string): Promise<ProjectDeepDiveResult | null> {
        return PlatformDB.getCache<ProjectDeepDiveResult>(`deep_dive_${categoryId}`);
    },
};
