/**
 * ProjectPlaybookService — GTM Strategy & Action Plan
 * 
 * Synthesizes: corpus keywords, demand metrics, signals, deep dive insights
 * into an actionable go-to-market playbook via Gemini 3 Pro.
 */

import { GoogleGenAI } from "@google/genai";
import { PlatformDB } from './platformDB';
import { PlatformSignalHarvester } from './platformSignalHarvester';
import { ProjectDeepDiveService } from './projectDeepDiveService';
import { ProjectDefinition } from '../config/projectContext';

function getApiKey(): string | undefined {
    try { return (import.meta as any).env?.VITE_GOOGLE_API_KEY || (import.meta as any).env?.VITE_GEMINI_API_KEY; } catch { return undefined; }
}

export interface PlaybookSection {
    title: string;
    items: { title: string; description: string; priority?: 'HIGH' | 'MEDIUM' | 'LOW'; timeline?: string }[];
}

export interface ProjectPlaybookResult {
    categoryName: string;
    geo: string;
    generatedAt: string;
    executiveBrief: string;
    gtmStrategy: PlaybookSection;
    channelPlan: PlaybookSection;
    contentStrategy: PlaybookSection;
    pricingPackaging: PlaybookSection;
    first90Days: PlaybookSection;
    kpis: PlaybookSection;
    riskMitigation: PlaybookSection;
    competitiveResponse: PlaybookSection;
    inputCoverage: { corpus: number; demand: boolean; signals: number; deepDive: boolean };
}

export type PlaybookProgress = { phase: string; message: string; pct: number };

export const ProjectPlaybookService = {

    async generatePlaybook(
        project: ProjectDefinition,
        categoryId: string,
        onProgress?: (p: PlaybookProgress) => void
    ): Promise<{ ok: boolean; result?: ProjectPlaybookResult; error?: string }> {

        const emit = (phase: string, message: string, pct: number) => onProgress?.({ phase, message, pct });
        const gen = project.generatedCategory;
        if (!gen) return { ok: false, error: 'No generated category' };

        const categoryName = gen.category;
        const geo = `${project.geo.countryName}`;

        // 1. Gather all inputs
        emit('GATHERING', 'Loading corpus data...', 10);
        const corpus = await PlatformDB.getCorpus(categoryId);
        const validRows = (corpus?.rows || []).filter((r: any) => (r.volume || 0) > 0);
        const topKw = validRows.sort((a: any, b: any) => (b.volume || 0) - (a.volume || 0)).slice(0, 30).map((r: any) => `${r.keyword_text} (${r.volume})`).join(', ');

        emit('GATHERING', 'Loading demand metrics...', 20);
        let demandContext = 'No demand data';
        try {
            const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
            const dd = await PlatformDB.getDemandOutput(categoryId, month);
            if (dd?.metrics) {
                const m = dd.metrics;
                demandContext = `Volume: ${m.demand_index_mn?.toFixed(2) || 0} Mn, Readiness: ${m.metric_scores?.readiness?.toFixed(1) || 0}/10, Spread: ${m.metric_scores?.spread?.toFixed(1) || 0}/10, Trend: ${m.trend_5y?.value_percent || 0}%`;
            }
        } catch { /* fallback from Firestore handled in demand runner */ }

        emit('GATHERING', 'Loading signals...', 30);
        const signals = await PlatformSignalHarvester.getCachedSignals(categoryId);
        const signalContext = signals.slice(0, 15).map(s => `[${s.platform}] ${s.title}`).join('\n');

        emit('GATHERING', 'Loading deep dive insights...', 40);
        const deepDive = await ProjectDeepDiveService.getCachedDeepDive(categoryId);
        const ddContext = deepDive ? `Executive: ${deepDive.executiveSummary?.title || ''}\nOpportunities: ${(deepDive.strategicOpportunities || []).map((o: any) => o.title).join(', ')}` : 'No deep dive';

        const inputCoverage = { corpus: validRows.length, demand: demandContext !== 'No demand data', signals: signals.length, deepDive: !!deepDive };

        // 2. Generate via Gemini 3 Pro
        emit('SYNTHESIZING', 'Generating GTM playbook via Gemini 3 Pro...', 50);

        const apiKey = getApiKey();
        if (!apiKey) return { ok: false, error: 'API key missing' };
        const ai = new GoogleGenAI({ apiKey });

        const prompt = `You are a Senior Brand Strategist creating a Go-To-Market Playbook.

CATEGORY: "${categoryName}"
COUNTRY: ${geo}
BRIEF: "${project.categoryInput}"
BRANDS: ${gen.keyBrands?.slice(0, 10).join(', ')}

DATA INPUTS:
1. TOP KEYWORDS: ${topKw}
2. DEMAND METRICS: ${demandContext}
3. MARKET SIGNALS (${signals.length}): ${signalContext}
4. DEEP DIVE: ${ddContext}

Generate a comprehensive GTM playbook. Output STRICT JSON:
{
    "executiveBrief": "3-4 sentence strategic summary",
    "gtmStrategy": {
        "title": "Go-To-Market Strategy",
        "items": [{"title": "str", "description": "2-3 sentences", "priority": "HIGH|MEDIUM|LOW", "timeline": "e.g. Month 1-3"}]
    },
    "channelPlan": {
        "title": "Channel & Distribution Plan",
        "items": [{"title": "str", "description": "str", "priority": "HIGH|MEDIUM|LOW", "timeline": "str"}]
    },
    "contentStrategy": {
        "title": "Content & SEO Strategy", 
        "items": [{"title": "str", "description": "Grounded in keyword data", "priority": "HIGH|MEDIUM|LOW"}]
    },
    "pricingPackaging": {
        "title": "Pricing & Packaging Strategy",
        "items": [{"title": "str", "description": "str"}]
    },
    "first90Days": {
        "title": "First 90 Days Action Plan",
        "items": [{"title": "str", "description": "str", "timeline": "Week 1-2 | Month 1 | Month 2 | Month 3"}]
    },
    "kpis": {
        "title": "KPIs & Success Metrics",
        "items": [{"title": "KPI name", "description": "Target and measurement method"}]
    },
    "riskMitigation": {
        "title": "Risks & Mitigation",
        "items": [{"title": "Risk", "description": "Mitigation strategy", "priority": "HIGH|MEDIUM|LOW"}]
    },
    "competitiveResponse": {
        "title": "Competitive Response Plan",
        "items": [{"title": "Scenario", "description": "Response strategy"}]
    }
}

RULES:
- Each section must have 5-8 items minimum.
- Ground recommendations in the keyword/demand data provided.
- Be specific to ${geo} market — local platforms, pricing in INR, regional nuances.
- first90Days should have 10+ granular action items.
- Output ONLY JSON.`;

        try {
            const resp = await ai.models.generateContent({
                model: 'gemini-3-pro-preview',
                contents: prompt,
                config: { responseMimeType: 'application/json' },
            });

            emit('PARSING', 'Parsing playbook...', 85);
            const raw = JSON.parse((resp.text || '{}').replace(/```json/gi, '').replace(/```/g, '').trim());

            const result: ProjectPlaybookResult = {
                categoryName,
                geo,
                generatedAt: new Date().toISOString(),
                executiveBrief: raw.executiveBrief || '',
                gtmStrategy: raw.gtmStrategy || { title: 'GTM Strategy', items: [] },
                channelPlan: raw.channelPlan || { title: 'Channel Plan', items: [] },
                contentStrategy: raw.contentStrategy || { title: 'Content Strategy', items: [] },
                pricingPackaging: raw.pricingPackaging || { title: 'Pricing', items: [] },
                first90Days: raw.first90Days || { title: 'First 90 Days', items: [] },
                kpis: raw.kpis || { title: 'KPIs', items: [] },
                riskMitigation: raw.riskMitigation || { title: 'Risks', items: [] },
                competitiveResponse: raw.competitiveResponse || { title: 'Competitive Response', items: [] },
                inputCoverage,
            };

            emit('SAVING', 'Saving playbook...', 95);
            await PlatformDB.setCache(`playbook_${categoryId}`, result);

            emit('DONE', 'Playbook complete', 100);
            return { ok: true, result };

        } catch (e: any) {
            return { ok: false, error: `Gemini error: ${e.message}` };
        }
    },

    async getCachedPlaybook(categoryId: string): Promise<ProjectPlaybookResult | null> {
        return PlatformDB.getCache<ProjectPlaybookResult>(`playbook_${categoryId}`);
    },
};
