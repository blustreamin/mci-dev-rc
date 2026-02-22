
import { GoogleGenAI } from "@google/genai";
import { AnchorIntelligence } from "../contracts/strategyContract";
import { normalizeKeywordString } from "../../driftHash";

// Safe env access
const safeProcess = (typeof process !== 'undefined' && process && process.env) 
    ? process 
    : { env: {} as Record<string, string | undefined> };

function getAI() {
  const apiKey = 'AIzaSyAQgj4c9UTOU_lvCXUXupansTwIJgnYop4';
  if (!apiKey) throw new Error("API Key missing");
  return new GoogleGenAI({ apiKey });
}

// Rule-based intent mapping
const INTENT_RULES: Record<string, string[]> = {
    Decision: ["buy", "price", "amazon", "flipkart", "cost", "cheap", "offer", "discount", "sale", "store", "shop", "order", "online"],
    Consideration: ["best", "top", "review", "vs", "compare", "better", "which", "brand", "list", "rating", "good"],
    Care: ["how to use", "steps", "routine", "side effects", "after", "maintain", "wash", "clean", "apply", "dosage", "safety"],
    Discovery: ["what is", "benefits", "meaning", "why", "types", "ideas", "trends", "style", "images", "photos"]
};

export const KeywordIntelligence = {

    normalizeKeyword(k: string): string {
        return normalizeKeywordString(k);
    },

    extractSignals(keywords: string[]): { bigrams: string[], modifiers: string[] } {
        const bigramCounts: Record<string, number> = {};
        const modifierCounts: Record<string, number> = {};
        const stopWords = new Set(["for", "in", "the", "a", "of", "and", "to", "is", "men", "mens", "india"]);

        keywords.forEach(k => {
            const parts = k.toLowerCase().split(/\s+/);
            
            // Bigrams
            for (let i = 0; i < parts.length - 1; i++) {
                if (stopWords.has(parts[i]) || stopWords.has(parts[i+1])) continue;
                const bg = `${parts[i]} ${parts[i+1]}`;
                bigramCounts[bg] = (bigramCounts[bg] || 0) + 1;
            }

            // Modifiers (First word usually, or known modifiers)
            const first = parts[0];
            if (!stopWords.has(first) && first.length > 2) {
                modifierCounts[first] = (modifierCounts[first] || 0) + 1;
            }
        });

        const sortedBigrams = Object.entries(bigramCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(e => e[0]);

        const sortedModifiers = Object.entries(modifierCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(e => e[0]);

        return { bigrams: sortedBigrams, modifiers: sortedModifiers };
    },

    inferIntentBucket(keywords: string[]): AnchorIntelligence['intentBucket'] {
        const scores: Record<string, number> = { Decision: 0, Consideration: 0, Care: 0, Discovery: 0 };
        
        keywords.forEach(k => {
            const norm = k.toLowerCase();
            for (const [intent, triggers] of Object.entries(INTENT_RULES)) {
                if (triggers.some(t => norm.includes(t))) {
                    scores[intent]++;
                }
            }
        });

        // Find max
        let maxIntent = "Discovery";
        let maxScore = -1;
        for (const [intent, score] of Object.entries(scores)) {
            if (score > maxScore) {
                maxScore = score;
                maxIntent = intent;
            }
        }
        
        return maxIntent as any; // Cast to strict type
    },

    async buildAnchorIntelligence(
        anchorId: string, 
        anchorName: string, 
        keywords: string[]
    ): Promise<AnchorIntelligence> {
        
        // 1. Deterministic Prep
        const { bigrams, modifiers } = this.extractSignals(keywords);
        const intentBucket = this.inferIntentBucket(keywords);
        const exemplars = keywords.slice(0, 12);

        // 2. LLM Synthesis
        let signals = {
            problemStatements: [`Consumers searching for ${anchorName}`],
            aspirations: [`Better solutions for ${anchorName}`],
            routines: ["Daily usage"],
            triggers: ["Need based"]
        };

        try {
            const ai = getAI();
            const prompt = `
                Analyze these search keywords for the anchor "${anchorName}".
                Keywords: ${exemplars.join(", ")}
                Patterns: ${bigrams.join(", ")}
                
                Task: Infer the underlying consumer psychology.
                1. What specific problems are they trying to solve?
                2. What is their desired outcome (aspiration)?
                3. What triggers this search?
                4. Is this part of a routine?

                Output STRICT JSON:
                {
                    "problemStatements": ["string", "string"],
                    "aspirations": ["string", "string"],
                    "routines": ["string"],
                    "triggers": ["string"]
                }
                Do not invent facts. Use only the keyword evidence.
            `;

            const resp = await ai.models.generateContent({
                model: 'gemini-2.5-flash-lite',
                contents: prompt,
                config: { responseMimeType: 'application/json' }
            });

            const json = JSON.parse(resp.text || "{}");
            if (json.problemStatements && Array.isArray(json.problemStatements)) {
                signals = json;
            }
        } catch (e) {
            console.warn(`LLM Synthesis failed for ${anchorName}, using fallback.`, e);
            // Fallback logic already set in default 'signals'
        }

        return {
            anchorId,
            anchorName,
            intentBucket,
            keywordCount: keywords.length,
            keywordExemplars: exemplars,
            signals: {
                problemStatements: signals.problemStatements?.slice(0, 5) || [],
                aspirations: signals.aspirations?.slice(0, 5) || [],
                routines: signals.routines?.slice(0, 5) || [],
                triggers: signals.triggers?.slice(0, 5) || []
            },
            evidence: {
                topBigrams: bigrams,
                topModifiers: modifiers,
                intentRationale: `Classified as ${intentBucket} based on modifiers like: ${modifiers.slice(0,3).join(', ')}`
            }
        };
    }
};
