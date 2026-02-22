
// Fixed: src/services/strategyRunner.ts should import from ../../types (root) not ../types
import { CategoryBaseline, AuditLogEntry, PreSweepData } from '../../types';
import { GoogleGenAI } from "@google/genai";
import { computeKeywordBaseHash } from '../driftHash';

const safeProcess = (typeof process !== 'undefined' && process && process.env) 
    ? process 
    : { env: {} as Record<string, string | undefined> };

function getAI() {
  const apiKey = safeProcess.env.API_KEY;
  if (!apiKey) throw new Error("API Key missing");
  return new GoogleGenAI({ apiKey });
}

// Helper to parse loose JSON from LLM
function cleanAndParseJSON(text: string): any {
    const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
    try {
        return JSON.parse(cleaned);
    } catch (e) {
        console.error("JSON Parse Fail", e);
        throw new Error("Failed to parse Strategy output.");
    }
}

export const StrategyRunner = {
    
    async execute(
        category: CategoryBaseline,
        country: string,
        logFn: (log: AuditLogEntry) => void,
        abortSignal: AbortSignal
    ): Promise<PreSweepData> { 
        
        const ai = getAI();
        const startTime = Date.now();

        logFn({
            timestamp: new Date().toISOString(), stage: 'Strategy', category: category.category, step: 'INIT',
            attempt: 1, status: 'Running', durationMs: 0, message: 'Initializing Generative Strategy Engine...'
        });

        // 1. Generate Intent Map & Keywords
        // We do this in one shot for speed and coherence in v1
        const prompt = `
            You are a Category Intelligence Architect for the Indian Market.
            Category: ${category.category}
            Context: ${category.consumerDescription}
            Seed Keywords: ${category.defaultKeywords.join(", ")}
            
            Task:
            1. Deconstruct this category into 4-6 distinct "Intent Buckets" (e.g., Discovery, Problem Solving, Brand Search).
            2. For each bucket, identify 2-3 "Anchors" (Sub-themes).
            3. For each Anchor, generate 10-15 high-relevance search keywords used by Indian men.
            4. Write a "Strategic Note" summarizing the market landscape in 5 bullet points.

            Output Format (Strict JSON):
            {
                "intentMap": [
                    {
                        "subCategory": "string (Intent Bucket Name)",
                        "anchors": [
                            {
                                "anchor": "string (Anchor Name)",
                                "consumer_problems": ["string"],
                                "evidence": ["string (Keyword 1)", "string (Keyword 2)"]
                            }
                        ]
                    }
                ],
                "selected_keywords": [
                    { "keyword": "string", "anchor": "string", "intentBucket": "string" }
                ],
                "strategicNote": ["string", "string"]
            }
            
            IMPORTANT: Ensure "selected_keywords" contains a flat list of ALL keywords generated in the intentMap structure. Total keywords should be ~100-150.
        `;

        try {
            logFn({
                timestamp: new Date().toISOString(), stage: 'Strategy', category: category.category, step: 'GENERATE',
                attempt: 1, status: 'Running', durationMs: Date.now() - startTime, message: 'Generating Intent Map & Keyword Corpus...'
            });

            const response = await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: prompt,
                config: { responseMimeType: 'application/json' }
            });

            const rawData = cleanAndParseJSON(response.text || "{}");

            // Validate Structure
            if (!rawData.intentMap || !rawData.selected_keywords) {
                throw new Error("Invalid structure returned from LLM");
            }

            // Dedupe and Normalize
            const uniqueKw = new Map();
            rawData.selected_keywords.forEach((k: any) => {
                const key = k.keyword.toLowerCase().trim();
                if (!uniqueKw.has(key)) {
                    uniqueKw.set(key, {
                        keyword: k.keyword,
                        anchor: k.anchor,
                        subCategory: 'Generated', // Simplification
                        intentBucket: k.intentBucket,
                        rationale: 'LLM Generated'
                    });
                }
            });

            const finalList = Array.from(uniqueKw.values());
            const baseHash = await computeKeywordBaseHash(finalList.map(k => ({
                keywordCanonical: k.keyword, anchor: k.anchor, cluster: null, intent: k.intentBucket, language: 'en', canonicalFamilyId: 'gen', originalTerm: k.keyword
            })));

            logFn({
                timestamp: new Date().toISOString(), stage: 'Strategy', category: category.category, step: 'COMPLETE',
                attempt: 1, status: 'Success', durationMs: Date.now() - startTime, message: `Strategy Generated: ${finalList.length} unique keywords.`
            });

            const anchorsFrozen = rawData.intentMap.flatMap((im: any) => im.anchors.map((a: any) => a.anchor));
            const anchorIntel = rawData.intentMap.flatMap((im: any) => im.anchors.map((a: any) => ({
                anchor_id: a.anchor,
                summary: a.consumer_problems?.[0] || "Generated Anchor",
                evidence: a.evidence || []
            })));

            return {
                category: category.category,
                keywordBaseHash: baseHash,
                isFromCache: false,
                summary: rawData.strategicNote[0] || "Strategy Generated",
                strategicNote: rawData.strategicNote,
                intentMap: rawData.intentMap,
                selected_keywords: finalList,
                validityMeta: {
                    coverage: 1,
                    status: 'OPTIMAL',
                    reportId: `gen-${Date.now()}`
                },
                // Fix: Add missing properties
                problems: [],
                aspirations: [],
                routines: [],
                triggers: [],
                barriers: [],
                trends: [],
                category_need_gaps: [],
                need_gaps: [],
                needGaps: [],
                anchors_frozen: anchorsFrozen,
                anchor_intelligence: anchorIntel,
                
                // Stub contract for type compatibility if needed downstream
                strategyContract: { strategyHash: baseHash, selected_keywords: finalList } as any
            };

        } catch (e: any) {
            logFn({
                timestamp: new Date().toISOString(), stage: 'Strategy', category: category.category, step: 'ERROR',
                attempt: 1, status: 'Failed', durationMs: Date.now() - startTime, message: e.message
            });
            throw e;
        }
    }
};
