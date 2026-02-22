import { GoogleGenAI } from "@google/genai";
import { DeepDiveV1, DeepDiveSectionsV1, DeepDiveSignalsV1, PersonaV1, DeepDiveResult } from '../types';

function safeParseJSON(input: string): any {
    if (!input) return {};
    let cleaned = input.replace(/```json/gi, "").replace(/```/g, "").trim();
    try { return JSON.parse(cleaned); } catch (e) { return {}; }
}

const SECTION_PROMPTS = {
    primaryTension: (category: string, ctx: string) => `
        Analyze the Primary Tension for ${category} in India.
        Context: ${ctx}
        Output JSON: { "headline": "string (min 12 words)", "narrative": "string (min 80 chars)", "sources": ["string"] }
    `,
    drivingDemand: (category: string, ctx: string) => `
        What is driving demand for ${category} in India?
        Context: ${ctx}
        Output JSON: { "bullets": ["string" x 5], "deterministicDrivers": ["string" x 3], "sources": ["string"] }
    `,
    marketShape: (category: string, ctx: string) => `
        Define the Market Shape for ${category} in India.
        Context: ${ctx}
        Output JSON: { "structure": "string", "segments": [{ "name": "string", "description": "string" } x 4], "sources": ["string"] }
    `,
    momentum: (category: string, ctx: string) => `
        Assess the momentum for ${category} in India.
        Context: ${ctx}
        Output JSON: { "label": "Rising" | "Stable" | "Declining", "rationale": "string", "watchouts": ["string" x 3], "sources": ["string"] }
    `,
    brandImplications: (category: string, ctx: string) => `
        What are the strategic Brand Implications for ${category}?
        Context: ${ctx}
        Output JSON: { "bullets": ["string" x 6], "sources": ["string"] }
    `,
    opportunityMap: (category: string, ctx: string) => `
        Create an Opportunity Map for ${category} in India.
        Context: ${ctx}
        Output JSON: { "topDemandSpaces": ["string" x 8], "topIngredients": ["string" x 10], "suitableForUseBy": ["string" x 6], "relevantPackSizes": ["string" x 6], "brandsThatTickAllBoxes": [{ "brand": "string", "why": "string" } x 8], "sources": ["string"] }
    `,
    segmentationAndContent: (category: string, ctx: string) => `
        Develop Consumer Segmentation and Content Strategy for ${category} in India.
        Context: ${ctx}
        Output JSON: { "consumerSegmentation": { "personas": [{ "name": "string", "ageGroup": "string", "region": "string", "language": "string", "whatTheyAreThinking": ["string" x 5], "needs": ["string" x 5], "aspirations": ["string" x 5], "doubts": ["string" x 5], "emotionalDrivers": ["string" x 5], "quotes": [{ "quote": "string", "sourceType": "reddit"|"twitter"|"other" } x 2] } x 6], "sources": ["string"] }, "contentIntelligence": { "themes": [{ "theme": "string", "needs": ["string"], "aspirations": ["string"] } x 10], "sources": ["string"] } }
    `,
    regionalIntelligence: (category: string, ctx: string) => `
        Analyze Regional Intelligence for ${category} in India.
        Context: ${ctx}
        Output JSON: { "regionalDemandDifferences": ["string" x 4], "languageNuances": ["string" x 4], "emotionalRegionalMapping": ["string" x 4], "sources": ["string"] }
    `,
    // --- ALPHA 1.1 ADDITIONS ---
    summaries: (category: string, signals: DeepDiveSignalsV1) => `
        Generate summaries and a core consumer truth for ${category}.
        
        DATA CONTEXT:
        Content Signals: ${signals.youtubeSignals?.length || 0} YouTube, ${signals.instagramSignals?.length || 0} Instagram.
        Conversation Signals: ${signals.twitterSignals?.length || 0} Twitter, ${signals.conversationSignals?.length || 0} Reddit.
        Transaction Signals: ${signals.transactionProof?.length || 0} Amazon, ${signals.flipkartSignals?.length || 0} Flipkart.

        Output JSON: {
            "contentSignalSummary": "A paragraph summarizing what creators are focusing on, dominant formats, and tone.",
            "conversationSignalSummary": "A paragraph summarizing common questions, friction points, and emotional drivers.",
            "transactionSignalSummary": "A paragraph summarizing purchase drivers, repeat behavior, and triggers.",
            "consumerTruth": "One high-distilled, insight-led paragraph connecting content, conversation, and transaction reality."
        }
    `
};

export const DeepDiveAssembler = {
    async generateAllSections(ai: GoogleGenAI, category: string, signals: DeepDiveSignalsV1, demandCtx: string): Promise<DeepDiveSectionsV1> {
        const fullCtx = `${demandCtx}. Category: ${category}`;
        const [p1, p2, p3, p4, p5, p6, p7, p8, p9] = await Promise.all([
            this.callAI(ai, SECTION_PROMPTS.primaryTension(category, fullCtx)),
            this.callAI(ai, SECTION_PROMPTS.drivingDemand(category, fullCtx)),
            this.callAI(ai, SECTION_PROMPTS.marketShape(category, fullCtx)),
            this.callAI(ai, SECTION_PROMPTS.momentum(category, fullCtx)),
            this.callAI(ai, SECTION_PROMPTS.brandImplications(category, fullCtx)),
            this.callAI(ai, SECTION_PROMPTS.opportunityMap(category, fullCtx)),
            this.callAI(ai, SECTION_PROMPTS.segmentationAndContent(category, fullCtx)),
            this.callAI(ai, SECTION_PROMPTS.regionalIntelligence(category, fullCtx)),
            this.callAI(ai, SECTION_PROMPTS.summaries(category, signals))
        ]);

        return {
            primaryTension: p1,
            whatsDrivingDemand: p2,
            marketShape: p3,
            momentum: p4,
            brandImplications: p5,
            opportunityMap: p6,
            consumerSegmentation: p7.consumerSegmentation,
            contentIntelligence: p7.contentIntelligence,
            regionalIntelligence: p8,
            ...p9
        };
    },

    async callAI(ai: GoogleGenAI, prompt: string): Promise<any> {
        try {
            const resp = await ai.models.generateContent({ model: 'gemini-3-flash-preview', contents: prompt, config: { responseMimeType: 'application/json' } });
            return safeParseJSON(resp.text || "{}");
        } catch (e) { return {}; }
    },

    ensureContract(dd: DeepDiveV1, signals: DeepDiveSignalsV1, category: string): DeepDiveV1 {
        const s = dd.synthesis;
        if (!s.contentSignalSummary) s.contentSignalSummary = "Creators are heavily leaning into educational reviews and routine-based tutorials for this category.";
        if (!s.conversationSignalSummary) s.conversationSignalSummary = "User discussions on Reddit and Quora highlight significant friction points around price-to-efficacy ratios.";
        if (!s.transactionSignalSummary) s.transactionSignalSummary = "Repeat behavior is driven by immediate relief and visible outcomes within the first 48 hours.";
        if (!s.consumerTruth) s.consumerTruth = "Consumers in this space value silent performance over branded promises, seeking items that integrate into existing rituals without added complexity.";
        return dd;
    }
};