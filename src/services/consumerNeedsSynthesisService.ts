import { GoogleGenAI } from "@google/genai";
import { SnapshotRowLite } from './snapshotChunkReader';
import { safeText } from '../utils/safety';
import { ConsumerStatement, AnalystPoint } from '../types';

const safeProcess = (typeof process !== 'undefined' && process && process.env) 
    ? process 
    : { env: {} as Record<string, string | undefined> };

function getAI() {
  const apiKey = safeProcess.env.API_KEY;
  if (!apiKey) throw new Error("API Key missing");
  return new GoogleGenAI({ apiKey });
}

export type ConsumerNeedsInsight = {
  id: string;
  title: string;
  description: string;
  impact: "HIGH" | "MEDIUM" | "LOW";
  evidenceKeywords: string[];
  // Richer V2 fields
  context?: string;
  score?: number; // 1-5
  scoreRationale?: string[];
  consumerStatements?: ConsumerStatement[];
};

export type ConsumerNeedsResult = {
  sections: {
    consumerProblems: ConsumerNeedsInsight[];
    coreAspirations: ConsumerNeedsInsight[];
    usageRoutines: ConsumerNeedsInsight[];
    searchTriggers: ConsumerNeedsInsight[];
    purchaseBarriers: ConsumerNeedsInsight[];
    emergingTrends: ConsumerNeedsInsight[];
    categoryNeedGaps: ConsumerNeedsInsight[];
    consumerIntentStatements: { title: string; description: string; }[];
  };
};

function cleanJson(text: string): string {
    return text.replace(/```json/gi, "").replace(/```/g, "").trim();
}

export const ConsumerNeedsSynthesisService = {
  
  async synthesizeChunk(
    chunk: SnapshotRowLite[], 
    categoryId: string,
    existing: ConsumerNeedsResult['sections']
  ): Promise<ConsumerNeedsResult['sections']> {
    const ai = getAI();
    
    // 1. Prepare Context
    const keywordsSample = chunk.map(r => `${r.keyword} (${r.volume})`).join(", ");
    
    const prompt = `
      Analyze this search data chunk for "${categoryId}" in India (Male Consumer, Tier 2/3 Focus).
      Keywords Sample: ${keywordsSample}

      OBJECTIVE:
      Identify distinct consumer needs and insights. Avoid repetition.
      For each insight, generate a "Consumer Voice" section with quotes grounded in Indian context (Hinglish/Vernacular style implied).
      
      SECTIONS TO POPULATE:
      1. Consumer Problems (Pain points, struggles)
      2. Core Aspirations (Desired outcomes, goals)
      3. Usage Routines (How/when they use it)
      4. Search Triggers (Events/needs triggering search)
      5. Purchase Barriers (Price, trust, side effects)
      6. Emerging Trends (New ingredients, formats)
      7. Need Gaps (Unmet needs)
      8. Intent Statements (I want to...)

      SCORING GUIDE (1-5):
      5 = High Frequency + High Severity (Critical)
      4 = High Frequency (Common)
      3 = Medium Impact (Relevant)
      2 = Niche / Emerging
      1 = Low / Noise

      OUTPUT FORMAT (STRICT JSON):
      {
        "consumerProblems": [
            {
                "title": "Short punchy title",
                "context": "2 lines explaining WHY this matters for Indian men specifically.",
                "score_1to5": number,
                "score_rationale": ["bullet 1 explaining freq/severity", "bullet 2"],
                "consumer_statements": [{"statement": "Natural quote like: 'I hate it when...'", "who": "Young Urban Male", "situation": "Morning Routine"}],
                "evidenceKeywords": ["kw1", "kw2"]
            }
        ],
        // Repeat structure for: coreAspirations, usageRoutines, searchTriggers, purchaseBarriers, emergingTrends, categoryNeedGaps
        "consumerIntentStatements": [{"title": "I want to...", "description": "Context"}]
      }
      
      CONSTRAINTS:
      - Max 3 items per section for this chunk.
      - "consumer_statements" must have 3-5 items per insight.
      - Ensure distinct angles (dedupe logic).
    `;

    try {
      const resp = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });

      const raw = JSON.parse(cleanJson(resp.text || "{}"));
      
      // 2. Merge and Dedupe
      const merged = { ...existing };
      
      type InsightSectionKey = Exclude<keyof ConsumerNeedsResult['sections'], 'consumerIntentStatements'>;

      const mergeSection = (key: InsightSectionKey) => {
        const newItems = raw[key] || [];
        const currentItems = merged[key] as ConsumerNeedsInsight[];
        
        for (const item of newItems) {
            // Dedupe by title similarity
            const exists = currentItems.some(c => c.title.toLowerCase() === item.title.toLowerCase());
            
            // Map legacy impact from score if missing
            const score = item.score_1to5 || 3;
            const impact = score >= 4 ? 'HIGH' : score >= 3 ? 'MEDIUM' : 'LOW';

            if (!exists && currentItems.length < 10) { // Cap at 10
                currentItems.push({
                    id: `gen_${Date.now()}_${Math.random()}`,
                    title: safeText(item.title),
                    description: safeText(item.context || item.description), // Map context to description internally or new field
                    context: safeText(item.context || item.description),
                    impact: impact,
                    score: score,
                    scoreRationale: Array.isArray(item.score_rationale) ? item.score_rationale.map(safeText) : [],
                    consumerStatements: Array.isArray(item.consumer_statements) ? item.consumer_statements : [],
                    evidenceKeywords: Array.isArray(item.evidenceKeywords) ? item.evidenceKeywords.map(safeText) : [],
                });
            }
        }
      };

      mergeSection('consumerProblems');
      mergeSection('coreAspirations');
      mergeSection('usageRoutines');
      mergeSection('searchTriggers');
      mergeSection('purchaseBarriers');
      mergeSection('emergingTrends');
      mergeSection('categoryNeedGaps');
      
      // Intent Statements
      const newIntents = raw.consumerIntentStatements || [];
      const currentIntents = merged.consumerIntentStatements || [];
      for (const item of newIntents) {
          if (!currentIntents.some(c => c.title === item.title) && currentIntents.length < 8) {
              currentIntents.push({
                  title: safeText(item.title),
                  description: safeText(item.description)
              });
          }
      }
      merged.consumerIntentStatements = currentIntents;

      return merged;

    } catch (e) {
      console.warn("Synthesis Chunk Failed", e);
      return existing;
    }
  },

  async enrichAnchorIntelligence(anchors: any[], categoryName: string): Promise<any[]> {
    const ai = getAI();
    // Fallback for huge lists
    const processingAnchors = anchors.slice(0, 15);
    
    const anchorContexts = processingAnchors.map(a => ({
        id: a.anchor_id,
        keywords: (a.evidence || []).slice(0, 8).join(", ")
    }));

    const prompt = `
        Category: "${categoryName}" (India/Bharat Men's Grooming).
        
        I have identified the following Search Intent Anchors (clusters of user queries):
        ${JSON.stringify(anchorContexts)}

        For EACH anchor, generate a rich profile.
        
        JSON OUTPUT FORMAT:
        {
            "profiles": [
                {
                    "id": "string (must match anchor id exactly)",
                    "context": "string (2-3 sentences: Who is searching, what situation, what job-to-be-done. Be specific to India men context.)",
                    "whyItMatters": ["string (bullet 1)", "string (bullet 2)"],
                    "exampleStatements": ["string (quote 1)", "string (quote 2)", "string (quote 3)"]
                }
            ]
        }
        
        Constraints:
        - exampleStatements should sound like real Indian male consumers (casual, direct, maybe Hinglish hints if natural).
        - whyItMatters should explain strategic relevance.
    `;
    
    try {
         const resp = await ai.models.generateContent({
            model: 'gemini-3-flash-preview',
            contents: prompt,
            config: { responseMimeType: 'application/json' }
         });
         const raw = JSON.parse(cleanJson(resp.text || "{}"));
         const profiles = raw.profiles || [];
         const profileMap = new Map(profiles.map((p: any) => [p.id, p]));
         
         return anchors.map(a => {
             const p = profileMap.get(a.anchor_id) as any;
             if (p) {
                 return {
                     ...a,
                     context: p.context,
                     whyItMatters: p.whyItMatters,
                     exampleStatements: p.exampleStatements
                 };
             }
             return a;
         });
    } catch (e) {
        console.warn("Anchor enrichment failed", e);
        return anchors; // Graceful degradation
    }
  }
};
