
import { CategoryBaseline } from '../../types';
import { SeedKeywordRow } from './csvIngestion/types';
// Fixed: src/services/strategySeedCluster.ts should import from ../../types (root) not ../types
import { StrategyPack, StrategyPackItem } from '../../types';
import { StrategyContract, IntentNode, AnchorNarrative } from '../contracts/strategyContract';
import { normalizeKeywordString } from '../../driftHash';
import { GoogleGenAI } from "@google/genai";

const safeProcess = (typeof process !== 'undefined' && process && process.env) 
    ? process 
    : { env: {} as Record<string, string | undefined> };

function getApiKey(): string | undefined {
    if (safeProcess.env.API_KEY) return safeProcess.env.API_KEY;
    try {
        // @ts-ignore
        if (import.meta && import.meta.env) {
            // @ts-ignore
            if (import.meta.env.VITE_GOOGLE_API_KEY) return import.meta.env.VITE_GOOGLE_API_KEY;
            // @ts-ignore
            if (import.meta.env.VITE_GEMINI_API_KEY) return import.meta.env.VITE_GEMINI_API_KEY;
        }
    } catch (e) {}
    return undefined;
}

function getAI() {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("API Key missing. Set VITE_GOOGLE_API_KEY.");
  return new GoogleGenAI({ apiKey });
}

interface RefinementOutput {
    category: string;
    intent_anchors: Array<{
        anchor_name: string;
        intent_type: string;
        clusters: string[]; 
        intelligence: {
            problems: string[];
            aspirations: string[];
            routines: string[];
            triggers: string[];
            emerging_signals: string[];
        };
        mapped_exemplars?: string[]; 
    }>;
}

export const StrategySeedCluster = {
    
    /**
     * Updated Cluster: Accepts StrategyPack instead of raw rows for LLM.
     */
    async cluster(
        category: CategoryBaseline,
        strategyPack: StrategyPack,
        windowId: string
    ): Promise<StrategyContract> {
        
        console.log(`[RefinementEngine] Using StrategyPack with ${strategyPack.keywords.length} representative keywords.`);

        // 1. AI Execution (Gemini 3 Pro + Thinking) using Pack
        const refinedData = await this.runRefinementLoop(category.category, strategyPack);

        // 2. Map Pack Keywords to Anchors
        // We only map the Pack keywords here for the Contract's explicit list.
        // Full corpus mapping happens in Demand via expansion.
        const { anchorMap, zeroVolStats } = this.performSmartBackfill(refinedData, strategyPack.keywords);

        // 3. Contract Construction
        return this.buildContract(category, windowId, refinedData, anchorMap, strategyPack, zeroVolStats);
    },

    async runRefinementLoop(categoryName: string, pack: StrategyPack): Promise<RefinementOutput> {
        const ai = getAI();
        
        // Prepare context from Pack
        const inputContext = {
            stats: pack.stats,
            samples: pack.keywords.map(k => ({ t: k.t, v: k.v, bucket: k.s }))
        };

        const prompt = `
            ROLE & AUTHORITY
            You are the Keyword Intelligence Refinement Engine.
            Objective: Transform a representative keyword pack into a high-signal, intent-aligned Strategic Architecture.

            INPUT CONTEXT
            Category: ${categoryName}
            Corpus Stats: ${JSON.stringify(pack.stats)}
            Sample Data (Top 800 Weighted): ${JSON.stringify(inputContext.samples)}

            MANDATORY EXECUTION STEPS
            
            STEP 1: Semantic Analysis
            Analyze the provided samples. Identify core themes driven by consumer intent.
            Do NOT create anchors based on numeric attributes (e.g. "100ml", "Price") unless they represent a distinct product class.
            
            STEP 2: Anchor Construction
            Create 8-14 distinct "Intent Anchors".
            - Anchor Name must be specific (e.g., "Acne Control", not "Other").
            - Assign Intent: Discovery, Consideration, Decision, Care, Routine, Aspirational.
            
            STEP 3: Intelligence Synthesis
            For EACH anchor, infer:
            - Problems: What pain point does this solve?
            - Aspirations: What is the emotional goal?
            - Routines: When is this used?
            - Triggers: What prompts the search?

            OUTPUT FORMAT (STRICT JSON)
            {
                "category": "${categoryName}",
                "intent_anchors": [
                    {
                        "anchor_name": "string",
                        "intent_type": "string",
                        "clusters": ["string", "string"], 
                        "mapped_exemplars": ["string", "string"], 
                        "intelligence": {
                            "problems": ["string"],
                            "aspirations": ["string"],
                            "routines": ["string"],
                            "triggers": ["string"],
                            "emerging_signals": ["string"]
                        }
                    }
                ]
            }
            
            Ensure "mapped_exemplars" includes exact strings from the input samples.
        `;

        try {
            const response = await ai.models.generateContent({
                model: 'gemini-3-pro-preview',
                contents: prompt,
                config: { 
                    responseMimeType: 'application/json',
                    thinkingConfig: { thinkingBudget: 32768 }
                }
            });

            return JSON.parse(response.text || "{}");
        } catch (e) {
            console.error("Refinement Engine Failed", e);
            throw new Error("AI Refinement Engine failed to generate strategy structure.");
        }
    },

    /**
     * Maps keywords to anchors using simple token matching.
     * Can be used for Pack (small) or Full Corpus (large).
     */
    performSmartBackfill(
        refinedData: RefinementOutput, 
        items: StrategyPackItem[] | SeedKeywordRow[]
    ): { anchorMap: Record<string, string[]>, zeroVolStats: any } {
        const anchorMap: Record<string, string[]> = {};
        
        // Zero Volume Policy Stats
        const stats = {
            total_zero_volume: 0,
            ignored: 0,
            retained: 0,
            reasons: {
                semantic_reinforcement: 0,
                high_intent_phrase: 0,
                trend_candidate: 0
            }
        };

        // Initialize
        refinedData.intent_anchors.forEach(a => anchorMap[a.anchor_name] = []);

        // 1. Build Matchers
        const matchers: { anchor: string, tokens: Set<string> }[] = refinedData.intent_anchors.map(a => {
            const tokens = new Set<string>();
            a.anchor_name.toLowerCase().split(/\W+/).forEach(t => { if(t.length>2) tokens.add(t); });
            a.clusters.forEach(c => c.toLowerCase().split(/\W+/).forEach(t => { if(t.length>2) tokens.add(t); }));
            a.mapped_exemplars?.forEach(e => e.toLowerCase().split(/\W+/).forEach(t => { if(t.length>3) tokens.add(t); }));
            return { anchor: a.anchor_name, tokens };
        });

        const intentPattern = /\b(buy|price|cost|best|top|review|vs|how|what|cure|treatment|routine)\b/i;

        // 2. Assign
        for (const item of items) {
            // Handle both PackItem and SeedRow shapes
            const text = (item as any).keywordText || (item as any).t || "";
            const vol = (item as any).baseVolume ?? (item as any).v ?? 0;
            const trendLbl = (item as any).trend_label || (item as any).tr;

            const norm = text.toLowerCase();
            
            // --- ZERO VOLUME QUALIFICATION GATE ---
            if (vol === 0) {
                stats.total_zero_volume++;
                let allowed = false;
                 
                // Exception B: High Intent
                if (intentPattern.test(norm) && norm.length > 15) {
                    stats.reasons.high_intent_phrase++;
                    allowed = true;
                } 
                // Exception C: Trend Candidate
                else if (trendLbl && trendLbl !== 'Unknown' && trendLbl !== 'Stable') {
                    stats.reasons.trend_candidate++;
                    allowed = true;
                } 
                
                if (allowed) {
                    stats.retained++;
                } else {
                    stats.ignored++;
                    continue; 
                }
            }

            let bestAnchor = 'Unclassified'; 
            let maxScore = 0;

            for (const m of matchers) {
                let score = 0;
                for (const t of m.tokens) {
                    if (norm.includes(t)) score++;
                }
                
                if (score > maxScore) {
                    maxScore = score;
                    bestAnchor = m.anchor;
                }
            }

            if (maxScore === 0) {
                bestAnchor = refinedData.intent_anchors[0]?.anchor_name || 'Unclassified';
            }

            if (!anchorMap[bestAnchor]) anchorMap[bestAnchor] = [];
            anchorMap[bestAnchor].push(normalizeKeywordString(text));
        }

        return { anchorMap, zeroVolStats: stats };
    },

    buildContract(
        category: CategoryBaseline, 
        windowId: string, 
        data: RefinementOutput, 
        anchorMap: Record<string, string[]>,
        pack: StrategyPack,
        zeroVolStats: any
    ): StrategyContract {
        
        // 1. Construct Intent Nodes
        const intentGroups: Record<string, AnchorNarrative[]> = {};
        const allKeywordsList: string[] = [];
        const topAnchorShares: {anchorName: string, share: number}[] = [];
        
        // Calc Pack Volume for relative shares in the Contract (Demand will expand later)
        const totalPackVolume = pack.keywords.reduce((sum, k) => sum + k.v, 0);

        data.intent_anchors.forEach(a => {
            const keywords = anchorMap[a.anchor_name] || [];
            allKeywordsList.push(...keywords);
            
            // Calc metrics strictly from Pack
            const anchorVol = keywords.reduce((sum, k) => {
                const item = pack.keywords.find(p => normalizeKeywordString(p.t) === k);
                return sum + (item?.v || 0);
            }, 0);

            const share = totalPackVolume > 0 ? (anchorVol / totalPackVolume) * 100 : 0;
            topAnchorShares.push({ anchorName: a.anchor_name, share });

            const narrative: AnchorNarrative = {
                anchorId: a.anchor_name,
                anchorName: a.anchor_name,
                intentBucket: (a.intent_type as any) || "Discovery",
                sharePercent: share,
                trendLabel: 'Stable',
                trendCoverage: 0,
                problems: a.intelligence.problems,
                aspirations: a.intelligence.aspirations,
                emergingTrends: a.intelligence.emerging_signals,
                evidenceTags: a.clusters,
                exemplars: (a.mapped_exemplars || []).slice(0, 5)
            };

            if (!intentGroups[a.intent_type]) intentGroups[a.intent_type] = [];
            intentGroups[a.intent_type].push(narrative);
        });

        const intentMap: IntentNode[] = Object.entries(intentGroups).map(([intent, anchors]) => ({
            id: intent,
            name: intent,
            anchors
        }));

        const uniqueKw = Array.from(new Set(allKeywordsList)).sort();
        
        return {
            categoryId: category.id,
            categoryName: category.category,
            windowId,
            createdAtISO: new Date().toISOString(),
            intentMap,
            strategicSummary: [
                `Strategy derived from ${pack.keywords.length} representative keywords (Corpus: ${pack.stats.totalCorpus}).`,
                `Top driver: ${topAnchorShares.sort((a,b)=>b.share-a.share)[0]?.anchorName}`,
                `Zero Volume Policy: Retained ${zeroVolStats.retained} high-signal phrases`
            ],
            dataQuality: {
                volumeCoveragePercent: 100, // Relative to Pack
                monthlySeriesCoveragePercent: 0,
                anchorsCount: data.intent_anchors.length,
                topAnchorShares: topAnchorShares.sort((a,b) => b.share - a.share).slice(0, 5)
            },
            anchorKeywordSet: anchorMap,
            selected_keywords: uniqueKw,
            intentMixTargets: {},
            exclusions: [],
            keywordQualityReport: {
                total: uniqueKw.length,
                deduped: 0,
                invalid: 0,
                generic: 0,
                brandNoise: 0,
                adultRisk: 0,
                notes: ["StrategyPackV1", `SeedHash: ${pack.seedHash}`]
            },
            strategyHash: "COMPUTED_AT_RUNTIME", 
            provenance: {
                usedTruthSeed: true,
                seedKeywordCount: pack.stats.totalCorpus,
                generatedKeywordCount: 0,
                seedSource: 'MANGOOLS_REFINED_V1'
            }
        };
    }
};
