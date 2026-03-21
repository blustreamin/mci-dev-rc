
import { GoogleGenAI } from "@google/genai";
import { SweepResult, DemandInsight } from '../types';
import { safeText } from '../utils/safety';

const safeProcess = (typeof process !== 'undefined' && process && process.env) 
    ? process 
    : { env: {} as Record<string, string | undefined> };

function getApiKey(): string | undefined {
    // 1. Process Env (Node/Build-time)
    // Removed hardcoded key — use env vars only
    
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
    async generate(categoryId: string, metrics: SweepResult, month: string, categoryName?: string): Promise<DemandInsight | null> {
        console.log(`[DEMAND_INSIGHTS] Generating for ${categoryId}...`);
        
        try {
            const ai = getAI();
            const resolvedName = categoryName || metrics.category || categoryId.replace(/-/g, ' ').replace(/_/g, ' ');
            
            const prompt = `
                You are a Senior Category Strategist at a top-tier consulting firm (McKinsey/BCG level).
                Generate a deep strategic analysis of this consumer category based on search demand metrics.
                
                CATEGORY: ${resolvedName}
                ANALYSIS PERIOD: ${month}
                
                COMPUTED METRICS:
                - Monthly Search Demand: ${metrics.demand_index_mn.toFixed(2)} Mn searches
                - Engagement Readiness Score: ${metrics.metric_scores.readiness.toFixed(1)}/10 (how close consumers are to purchase — 10 = actively buying, 1 = just browsing)
                - Market Spread Score: ${metrics.metric_scores.spread.toFixed(1)}/10 (how distributed demand is across segments — 10 = evenly spread, 1 = concentrated in few areas)
                - 5-Year Growth Trend: ${metrics.trend_5y.value_percent}% (${metrics.trend_5y.trend_label})
                - Total Keywords Tracked: ${metrics.totalKeywordsUsedInMetrics || 'N/A'}
                - Valid Keywords (with volume): ${metrics.eligibleCount || 'N/A'}
                
                PROVIDE DEEP ANALYSIS — think like you're presenting to a CMO:
                
                OUTPUT SCHEMA (Strict JSON):
                {
                    "title": "Compelling strategic headline (e.g., 'Latent Demand Trapped by Low Market Maturity')",
                    "executiveSummary": "4-5 sentences. Cover: demand size significance, readiness implications, spread analysis, trend trajectory, and one strategic recommendation.",
                    "opportunity": "2-3 sentences on the PRIMARY growth opportunity. Be specific about which consumer segment, channel, or behavior shift to target.",
                    "riskFlag": "2-3 sentences on the PRIMARY risk. Quantify if possible using the metrics (e.g., 'Spread of 1.2/10 means top 3 keywords capture 90%+ of volume').",
                    "breakdown": [
                        "Demand Volume Analysis: What does ${metrics.demand_index_mn.toFixed(2)} Mn searches tell us about category maturity? (4-5 sentences)",
                        "Readiness Deep-Dive: Score of ${metrics.metric_scores.readiness.toFixed(1)}/10 — what does this mean for the purchase funnel? What stage are most consumers in? (4-5 sentences)",
                        "Market Structure: Spread of ${metrics.metric_scores.spread.toFixed(1)}/10 — how concentrated vs fragmented is this market? What does this mean for new entrants? (4-5 sentences)",
                        "Growth Trajectory: ${metrics.trend_5y.value_percent}% 5Y trend — is this a growing, stable, or declining category? What's driving the trend? (4-5 sentences)",
                        "Strategic Implications: Given these metrics, what should a brand do in the next 6-12 months? Prioritize 3 specific actions. (4-5 sentences)",
                        "Competitive Landscape Signal: What do these search patterns suggest about competitive intensity and white space? (3-4 sentences)"
                    ]
                }
            `;

            const resp = await ai.models.generateContent({
                model: 'gemini-3-pro-preview',
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
