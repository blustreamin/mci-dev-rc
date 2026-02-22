
import { GoogleGenAI } from "@google/genai";
import { SweepResult, DemandInsight } from '../types';
import { CORE_CATEGORIES } from '../constants';
import { safeText } from '../utils/safety';

const safeProcess = (typeof process !== 'undefined' && process && process.env) 
    ? process 
    : { env: {} as Record<string, string | undefined> };

function getApiKey(): string | undefined {
    // 1. Process Env (Node/Build-time)
    if (safeProcess.env.API_KEY) return safeProcess.env.API_KEY;
    
    // 2. Vite Import Meta (Browser)
    try {
        // @ts-ignore
        if (import.meta && import.meta.env) {
            // @ts-ignore
            if (import.meta.env.VITE_GOOGLE_API_KEY) return import.meta.env.VITE_GOOGLE_API_KEY;
            // @ts-ignore
            if (import.meta.env.API_KEY) return import.meta.env.API_KEY;
        }
    } catch (e) {}
    
    return undefined;
}

function getAI() {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("API Key missing. Configure VITE_GOOGLE_API_KEY or process.env.API_KEY.");
  return new GoogleGenAI({ apiKey });
}

function cleanJson(text: string): string {
    return text.replace(/```json/gi, "").replace(/```/g, "").trim();
}

export const DemandInsightsService = {
    async generate(categoryId: string, metrics: SweepResult, month: string): Promise<DemandInsight | null> {
        console.log(`[DEMAND_INSIGHTS] Generating for ${categoryId}...`);
        
        try {
            const ai = getAI();
            const categoryName = CORE_CATEGORIES.find(c => c.id === categoryId)?.category || categoryId;
            
            const prompt = `
                Act as a Senior Category Analyst for the Indian Market.
                Generate a strategic "Demand Insight" narrative based on the following computed metrics.
                Use ONLY provided numbers. If missing, say missing.
                
                CATEGORY: ${categoryName}
                CONTEXT: ${month}
                
                METRICS:
                - Demand Index: ${metrics.demand_index_mn.toFixed(2)} Mn Searches
                - Readiness Score: ${metrics.metric_scores.readiness.toFixed(1)}/10 (Intent Quality)
                - Spread Score: ${metrics.metric_scores.spread.toFixed(1)}/10 (Market Fragmentation)
                - 5Y Trend: ${metrics.trend_5y.value_percent}% (${metrics.trend_5y.trend_label})
                
                OUTPUT SCHEMA (Strict JSON):
                {
                    "title": "string (Short, punchy headline summarizing the state)",
                    "executiveSummary": "string (2-3 sentences max, executive overview)",
                    "opportunity": "string (Where is the growth headroom?)",
                    "riskFlag": "string (What is the primary risk or barrier?)",
                    "breakdown": ["string" (3-4 bullet points analyzing the interplay of demand, readiness, and spread)]
                }
            `;

            const resp = await ai.models.generateContent({
                model: 'gemini-flash-lite-latest', // Fast & Cheap
                contents: prompt,
                config: { responseMimeType: 'application/json' }
            });

            const raw = JSON.parse(cleanJson(resp.text || "{}"));
            
            const insight: DemandInsight = {
                title: safeText(raw.title, "Market Analysis"),
                executiveSummary: safeText(raw.executiveSummary, "Analysis pending."),
                opportunity: safeText(raw.opportunity, "Growth opportunities exist in unaddressed segments."),
                riskFlag: safeText(raw.riskFlag, "Monitor competitive density."),
                breakdown: Array.isArray(raw.breakdown) ? raw.breakdown.map(safeText) : [],
                source: "MARKET_WEIGHTED_V1",
                generatedAt: new Date().toISOString()
            };

            return insight;

        } catch (e: any) {
            console.warn(`[DEMAND_INSIGHTS] Generation failed for ${categoryId}`, e);
            return null;
        }
    }
};
