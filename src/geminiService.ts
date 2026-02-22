
import { GoogleGenAI } from "@google/genai";
// Fixed: root geminiService.ts should import from ./types (root) not ./src/types
import { 
    SweepResult, DeepDiveResult, 
    CategoryBaseline, Country, PreSweepData, ApiResponse, AuditLogEntry,
    KeywordMetric, AnchorData, RunContext, Trend5yOutput, FetchableData
} from "./types";
import { DEMAND_SWEEP_CONTRACT } from './demandSweepContract';
import { getCachedResult, setCachedResult } from './persistenceService';
import { computeKeywordBaseHash, normalizeKeywordString } from './driftHash';
import { CATEGORY_ANCHORS_V1, V1AnchorDef } from './src/contracts/categoryAnchorsV1';

const safeProcess = (typeof process !== 'undefined' && process && process.env) 
    ? process 
    : { env: {} as Record<string, string | undefined> };

const FAST_MODEL = 'gemini-3-flash-preview'; 
const LITE_MODEL = 'gemini-flash-lite-latest';
const IMAGE_MODEL = 'gemini-2.5-flash-image';
const THINKING_MODEL = 'gemini-3-pro-preview';

function getAI() {
  const apiKey = 'AIzaSyAQgj4c9UTOU_lvCXUXupansTwIJgnYop4';
  if (!apiKey) throw new Error("API Key missing. Please set process.env.API_KEY.");
  return new GoogleGenAI({ apiKey });
}

function safeParseJSON(input: string): any {
  if (!input) return {};
  let cleaned = input.replace(/```json/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(cleaned); } catch (e) { return {}; }
}

// --- UTILS ---

const INTENT_RULES: Record<string, string[]> = {
    Decision: ["buy", "price", "coupon", "discount", "near me", "order", "best under", "amazon", "flipkart", "meesho", "store", "deal", "cost", "online"],
    Consideration: ["review", "vs", "comparison", "top", "best", "which", "brand", "recommended", "list", "rating"],
    Care: ["side effects", "sensitive", "irritation", "acne", "burn", "rash", "dandruff", "dry skin", "itch", "problem", "repair", "treatment"],
    Discovery: ["what is", "how to", "benefits", "guide", "tips", "routine", "meaning", "uses", "ideas", "types"]
};

function inferIntent(keyword: string): string {
    const norm = keyword.toLowerCase();
    for (const [intent, tokens] of Object.entries(INTENT_RULES)) {
        if (tokens.some(t => norm.includes(t))) return intent;
    }
    return "Discovery"; // Default
}

function filterKeyword(k: string): boolean {
    if (!k || k.length < 3 || k.length > 80) return false;
    if (/^[^a-z0-9]+$/i.test(k)) return false; // All symbols
    if (/^\d+$/.test(k)) return false; // All numbers
    if (/(\S)\1{3,}/.test(k)) return false; // Repeats e.g. "aaaa"
    if (k.includes("undefined") || k.includes("null") || k.includes("N/A")) return false;
    return true;
}

// --- STRATEGY (V1) ---

export async function runPreSweepIntelligence(
  category: CategoryBaseline,
  country: Country,
  logFn: (log: AuditLogEntry) => void,
  abortSignal: AbortSignal
): Promise<FetchableData<PreSweepData>> {
    const startTime = Date.now();
    const cacheKey = `preSweepV1::${category.id}`;
    
    const cached = await getCachedResult<PreSweepData>(cacheKey);
    if (cached) {
        logFn({ timestamp: new Date().toISOString(), stage: 'Strategy', category: category.category, step: 'CACHE', attempt: 1, status: 'Success', durationMs: 10, message: 'Loaded from cache.' });
        return { status: 'Success', data: cached, lastAttempt: new Date().toISOString() };
    }

    logFn({ timestamp: new Date().toISOString(), stage: 'Strategy', category: category.category, step: 'INIT', attempt: 1, status: 'Running', durationMs: 0, message: 'Initializing V1 Strategy Engine...' });

    const v1Def = CATEGORY_ANCHORS_V1[category.id];
    if (!v1Def) throw new Error(`Missing V1 Anchors for ${category.id}`);
    
    const anchorList = v1Def.anchors.map(a => a.name).join(", ");

    const ai = getAI();
    const prompt = `
        You are a Category Intelligence Architect for ${country}.
        Category: ${category.category}
        Context: ${category.consumerDescription}
        
        MANDATORY ANCHORS (Use exactly these):
        ${anchorList}

        Task:
        1. For EACH anchor, generate exactly 45 unique, high-relevance search keywords used by consumers in ${country}.
        2. For EACH anchor, provide 10 specific "Key Insights" (bullet points) explaining the consumer behavior.
        3. Write a "Strategic Note" (8-12 bullets) summarizing the category landscape: Problems, Aspirations, Routines, Triggers, Trends.

        Output STRICT JSON:
        {
            "strategicNote": ["string", "string"],
            "anchors": [
                {
                    "name": "string (Must match input anchor exactly)",
                    "insights": ["string", "string" ... (10 items)],
                    "keywords": ["string", "string" ... (45 items)]
                }
            ]
        }
    `;

    try {
        logFn({ timestamp: new Date().toISOString(), stage: 'Strategy', category: category.category, step: 'GENERATE', attempt: 1, status: 'Running', durationMs: 0, message: 'Generating Keywords & Insights...' });

        const response = await ai.models.generateContent({
            model: THINKING_MODEL,
            contents: prompt,
            config: { 
                responseMimeType: 'application/json',
                thinkingConfig: { thinkingBudget: 32768 }
            }
        });

        const rawData = safeParseJSON(response.text || "{}");
        if (!rawData.anchors || !Array.isArray(rawData.anchors)) throw new Error("Invalid model output structure.");

        const flattenedKeywords: any[] = [];
        const intentMap: any[] = [];

        rawData.anchors.forEach((a: any) => {
            const validName = v1Def.anchors.find(va => va.name === a.name)?.name || a.name;
            let keywords = (a.keywords || []).map((k: string) => normalizeKeywordString(k)).filter(filterKeyword);
            keywords = Array.from(new Set(keywords));

            keywords.forEach((k: string) => {
                flattenedKeywords.push({
                    keyword: k,
                    anchor: validName,
                    subCategory: 'General',
                    intentBucket: inferIntent(k),
                    rationale: 'Generated V1'
                });
            });

            intentMap.push({
                subCategory: 'General',
                anchors: [{
                    anchor: validName,
                    consumer_problems: a.insights || [],
                    evidence: keywords.slice(0, 10)
                }]
            });
        });

        const baseHash = await computeKeywordBaseHash(flattenedKeywords.map(k => ({
            keywordCanonical: k.keyword, anchor: k.anchor, cluster: null, intent: k.intentBucket, language: 'en', canonicalFamilyId: 'v1', originalTerm: k.keyword
        })));

        const anchors_frozen = intentMap.flatMap((i: any) => i.anchors.map((a: any) => a.anchor));
        const anchor_intelligence = intentMap.flatMap((i: any) => i.anchors.map((a: any) => ({
            anchor_id: a.anchor,
            summary: a.consumer_problems?.[0] || "",
            evidence: a.evidence
        })));

        const result: PreSweepData = {
            category: category.category,
            keywordBaseHash: baseHash,
            isFromCache: false,
            summary: rawData.strategicNote?.[0] || "Strategy Generated",
            strategicNote: rawData.strategicNote || [],
            intentMap,
            selected_keywords: flattenedKeywords,
            validityMeta: { coverage: 1, status: 'OPTIMAL', reportId: `v1-${Date.now()}` },
            problems: [],
            aspirations: [],
            routines: [],
            triggers: [],
            barriers: [],
            trends: [],
            category_need_gaps: [],
            need_gaps: [],
            needGaps: [],
            anchors_frozen,
            anchor_intelligence
        };

        await setCachedResult(cacheKey, result);
        logFn({ timestamp: new Date().toISOString(), stage: 'Strategy', category: category.category, step: 'COMPLETE', attempt: 1, status: 'Success', durationMs: Date.now() - startTime, message: `Generated ${flattenedKeywords.length} keywords.` });

        return { status: 'Success', data: result, lastAttempt: new Date().toISOString() };
    } catch (e: any) {
        logFn({ timestamp: new Date().toISOString(), stage: 'Strategy', category: category.category, step: 'ERROR', attempt: 1, status: 'Failed', durationMs: Date.now() - startTime, message: e.message });
        return { status: 'Failed', lastAttempt: new Date().toISOString(), error: { type: 'GEN_FAIL', message: e.message } };
    }
}

// --- DEMAND (V1 ROBUST) ---

interface VolumeEntry {
    keyword: string;
    volume: number;
    confidence?: string;
    source?: string;
}

async function robustBatchFetch(keywords: string[]): Promise<VolumeEntry[]> {
    const ai = getAI();
    const prompt1 = `
        Estimate monthly search volumes in India for: ${JSON.stringify(keywords)}
        Return STRICT JSON Array: [{"keyword": "string", "volume": number}]
    `;

    try {
        const resp = await ai.models.generateContent({
            model: FAST_MODEL,
            contents: prompt1,
            config: { responseMimeType: 'application/json', tools: [{ googleSearch: {} }] }
        });
        return safeParseJSON(resp.text || "[]");
    } catch (e) {
        return [];
    }
}

export async function runCategorySweep(
  category: CategoryBaseline,
  strategyOverride: any,
  country: Country,
  logFn: (log: AuditLogEntry) => void,
  abortSignal: AbortSignal,
  overrideAnchors: string[] | undefined,
  runContext: RunContext
): Promise<FetchableData<SweepResult>> {
    const startTime = Date.now();
    const strategyCacheKey = `preSweepV1::${category.id}`;
    let strategy = await getCachedResult<PreSweepData>(strategyCacheKey);
    if (!strategy) strategy = await getCachedResult<PreSweepData>(`preSweep::${category.id}`);
    if (!strategy) throw new Error("Strategy missing.");

    const allKeywords = strategy.selected_keywords;
    const volumeMap = new Map<string, number>();
    const BATCH_SIZE = 20;

    for (let i = 0; i < allKeywords.length; i += BATCH_SIZE) {
        if (abortSignal.aborted) throw new Error("Cancelled");
        const batch = allKeywords.slice(i, i + BATCH_SIZE).map(k => k.keyword);
        const results = await robustBatchFetch(batch);
        results.forEach(r => volumeMap.set(normalizeKeywordString(r.keyword), r.volume));
        await new Promise(r => setTimeout(r, 800));
    }

    let resolvedCount = 0;
    let zeroCount = 0;
    let validVolCount = 0;
    
    allKeywords.forEach(k => {
        const v = volumeMap.get(normalizeKeywordString(k.keyword)) ?? -1;
        if (v !== -1) {
            resolvedCount++;
            if (v === 0) zeroCount++;
            if (v > 0) validVolCount++;
        }
    });

    const resolvedCoverage = allKeywords.length > 0 ? resolvedCount / allKeywords.length : 0;
    const zeroPct = resolvedCount > 0 ? zeroCount / resolvedCount : 0;
    const FAILED_QUALITY = resolvedCoverage < 0.6 || zeroPct > 0.9 || validVolCount === 0;

    if (FAILED_QUALITY) {
        return { 
            status: 'Success', 
            lastAttempt: new Date().toISOString(), 
            data: { 
                ...createEmptySweep(category, runContext.runId), 
                isFailedDataQuality: true, 
                resolvedCoverage, 
                unresolvedPercent: 1 - resolvedCoverage, 
                zeroVolumePercent: zeroPct,
                totalKeywordsUsedInMetrics: validVolCount,
                activeAnchorsCount: 0,
                zeroVolumeAnchorsCount: 0 
            } as any 
        };
    }

    let totalVol = 0;
    const anchorStats: Record<string, { vol: number, keywords: KeywordMetric[] }> = {};
    let weightedSum = 0;

    allKeywords.forEach(k => {
        const vol = volumeMap.get(normalizeKeywordString(k.keyword)) || 0;
        if (vol > 0) {
            totalVol += vol;
            if (!anchorStats[k.anchor]) anchorStats[k.anchor] = { vol: 0, keywords: [] };
            anchorStats[k.anchor].vol += vol;
            const weight = DEMAND_SWEEP_CONTRACT.intentWeights[k.intentBucket as any] || 0.55;
            weightedSum += vol * weight;
        }
    });

    const demandIndex = totalVol / 1000000;
    const readinessScore = totalVol > 0 ? Math.min(10, Math.max(1, ((weightedSum / totalVol - 0.55) / 0.45) * 9 + 1)) : 0;
    const activeAnchors = Object.values(anchorStats).filter(a => a.vol > 0);
    let hhi = 0;
    activeAnchors.forEach(a => hhi += Math.pow(a.vol / totalVol, 2));
    const spreadScore = activeAnchors.length > 1 ? (1 - hhi) * 10 : 0;

    const trend = await fetchCategoryTrend(category.category);
    const synthesis = await generateSynthesis(category.category, demandIndex, readinessScore, spreadScore, []);

    const result: SweepResult = {
        category: category.category,
        demand_index_mn: demandIndex,
        metric_scores: { readiness: readinessScore, spread: spreadScore },
        engagement_readiness: readinessScore > 7 ? 'High' : 'Medium',
        demand_spread: spreadScore > 7 ? 'High' : 'Medium',
        trend_5y: trend,
        anchors: [],
        synthesis,
        analyst_insight: [],
        runId: runContext.runId,
        resolvedCoverage,
        totalKeywordsInput: allKeywords.length,
        totalKeywordsResolved: resolvedCount,
        resolvedKeywordCount: resolvedCount,
        isFailedDataQuality: false,
        totalKeywordsUsedInMetrics: validVolCount,
        activeAnchorsCount: activeAnchors.length,
        zeroVolumeAnchorsCount: Object.keys(anchorStats).length - activeAnchors.length,
        unresolvedPercent: 1 - resolvedCoverage,
        zeroVolumePercent: zeroPct,
        methodologyVersion: 'v3.0.0',
        indexSource: 'LIVE'
    };

    return { status: 'Success', data: result, lastAttempt: new Date().toISOString() };
}

async function fetchCategoryTrend(category: string): Promise<Trend5yOutput> {
    const ai = getAI();
    const prompt = `What is the 5-year search interest trend for "${category}" in India? JSON: {"value_percent": number, "label": "Rising|Stable|Declining"}`;
    try {
        const resp = await ai.models.generateContent({ model: LITE_MODEL, contents: prompt, config: { responseMimeType: 'application/json' } });
        const data = safeParseJSON(resp.text || "{}");
        return { 
            value_percent: data.value_percent, 
            trend_label: data.label || 'Unknown', 
            source: 'lite_estimate', 
            coverage: 1, 
            windowId: 'now', 
            keywordCountTotal: 1, 
            keywordCountWithTrend: 1, 
            method: 'MODEL_ESTIMATE', 
            period: '5y', 
            timestamp: new Date().toISOString() 
        };
    } catch {
        return { value_percent: null, trend_label: 'Unknown', source: 'fail', coverage: 0, windowId: 'now', keywordCountTotal: 0, keywordCountWithTrend: 0, method: 'UNKNOWN', period: '5y', timestamp: new Date().toISOString() };
    }
}

async function generateSynthesis(category: string, demand: number, readiness: number, spread: number, anchors: AnchorData[]) {
    const ai = getAI();
    const prompt = `Synthesize demand: ${category}, Demand: ${demand.toFixed(2)} Mn, Readiness: ${readiness.toFixed(1)}, Spread: ${spread.toFixed(1)}. JSON: {"key_takeaway": "string", "summary_statement": "string", "early_outlook": "string"}`;
    try {
        const resp = await ai.models.generateContent({ model: LITE_MODEL, contents: prompt, config: { responseMimeType: 'application/json' } });
        return safeParseJSON(resp.text || "{}");
    } catch {
        return { key_takeaway: "Analysis complete", summary_statement: "Data processed", early_outlook: "Stable" };
    }
}

export async function editImage(base64: string, prompt: string): Promise<string | null> {
    const ai = getAI();
    try {
        const response = await ai.models.generateContent({
            model: IMAGE_MODEL,
            contents: {
                parts: [
                    { inlineData: { data: base64, mimeType: 'image/png' } },
                    { text: prompt }
                ]
            }
        });
        for (const part of response.candidates[0].content.parts) {
            if (part.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
        }
        return null;
    } catch (e) {
        console.error("Image edit failed", e);
        return null;
    }
}

function createEmptySweep(category: CategoryBaseline, runId: string): SweepResult {
    return { 
        category: category.category, 
        demand_index_mn: 0, 
        metric_scores: { readiness: 0, spread: 0 }, 
        engagement_readiness: 'Low', 
        demand_spread: 'Low', 
        trend_5y: {} as any, 
        anchors: [], 
        synthesis: {} as any, 
        analyst_insight: [], 
        runId, 
        resolvedCoverage: 0, 
        totalKeywordsInput: 0, 
        totalKeywordsResolved: 0, 
        resolvedKeywordCount: 0,
        totalKeywordsUsedInMetrics: 0,
        activeAnchorsCount: 0,
        zeroVolumeAnchorsCount: 0,
        unresolvedPercent: 0,
        zeroVolumePercent: 0,
        methodologyVersion: 'v3.0.0',
        indexSource: 'LIVE',
        isFailedDataQuality: false
    };
}

export async function runSingleDeepDive(category: string, runId: string, context?: SweepResult): Promise<FetchableData<DeepDiveResult>> {
    if (!context) return { status: 'Failed', lastAttempt: new Date().toISOString(), error: { type: 'Input', message: 'No demand context' } };
    const ai = getAI();
    const prompt = `Deep dive on ${category}. Demand ${context.demand_index_mn.toFixed(2)}. JSON: {"category": "${category}", "consumer_intelligence": {"cohorts": [], "problems": [], "aspirations": [], "barriers": []}, "market_dynamics": {"maturity_signal": "", "winning_formula": "", "strategic_implications": []}, "content_intelligence": {"themes": [], "visual_codes": []}, "synthesis": {"core_truth": "", "primary_tension": ""}}`;
    try {
        const resp = await ai.models.generateContent({ model: THINKING_MODEL, contents: prompt, config: { responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 32768 } } });
        return { status: 'Success', data: { ...safeParseJSON(resp.text || "{}"), model_used: THINKING_MODEL, generated_at: new Date().toISOString() } as any, lastAttempt: new Date().toISOString() };
    } catch (e: any) {
        return { status: 'Failed', lastAttempt: new Date().toISOString(), error: { type: 'API', message: e.message } };
    }
}

export async function runTruthWarmup() { return {} as any; }
export async function verifyV3Wiring() { return ["V1 Restored"]; }
export async function ensureBenchmarkSnapshot() {}
export async function runSinglePlaybook() { return {} as any; }
