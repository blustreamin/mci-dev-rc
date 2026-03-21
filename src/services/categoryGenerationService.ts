/**
 * Category Generation Service — Multi-Call Approach
 * 
 * Call 1: Category structure + 150 seed keywords
 * Calls 2-4: 150 keywords each (brand, informational, long-tail)
 * Total: 500-600 unique keywords without hitting rate limits
 */

import { GoogleGenAI } from "@google/genai";
import { AiGeneratedCategory, IndustryId } from '../config/projectContext';

const MODEL = 'gemini-3-flash-preview';

function getApiKey(): string | undefined {
    if (typeof process !== 'undefined' && process.env?.API_KEY) return process.env.API_KEY;
    if ((import.meta as any).env?.VITE_GOOGLE_API_KEY) return (import.meta as any).env.VITE_GOOGLE_API_KEY;
    if ((import.meta as any).env?.VITE_GEMINI_API_KEY) return (import.meta as any).env.VITE_GEMINI_API_KEY;
    return undefined;
}

function safeParseJSON(input: string): any {
    if (!input) return null;
    let cleaned = input.replace(/```json/gi, "").replace(/```/g, "").trim();
    try { return JSON.parse(cleaned); } catch (e) { return null; }
}

function slugify(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').substring(0, 40).replace(/^-|-$/g, '');
}

export interface CategoryGenerationInput {
    categoryText: string;
    industry: IndustryId;
    countryName: string;
    countryCode: string;
    language: string;
}

export interface CategoryGenerationResult {
    ok: boolean;
    category?: AiGeneratedCategory;
    error?: string;
    rawResponse?: string;
}

export type GenerationProgress = {
    step: number;
    totalSteps: number;
    phase: string;
    keywords: number;
    elapsedSec: number;
    estimatedRemainingSec: number;
};

export async function generateCategoryConfig(
    input: CategoryGenerationInput,
    onProgress?: (p: GenerationProgress) => void
): Promise<CategoryGenerationResult> {
    const apiKey = getApiKey();
    if (!apiKey) return { ok: false, error: "Gemini API key not configured." };

    const ai = new GoogleGenAI({ apiKey });
    const startTime = Date.now();
    const STEP_TIMES = [15, 8, 8, 8, 8, 8]; // estimated seconds per step

    const emitProgress = (step: number, phase: string, keywords: number) => {
        const elapsed = (Date.now() - startTime) / 1000;
        const remaining = STEP_TIMES.slice(step).reduce((s, v) => s + v, 0);
        onProgress?.({ step: step + 1, totalSteps: 6, phase, keywords, elapsedSec: Math.round(elapsed), estimatedRemainingSec: Math.round(remaining) });
    };

    // --- CALL 1: Structure + 150 seed keywords ---
    const prompt1 = `You are a search keyword researcher. Keywords will be validated against Google Ads volume data.

Category: "${input.categoryText}"
Industry: ${input.industry}
Country: ${input.countryName} (${input.countryCode})
Language: ${input.language}

Generate JSON:
{
    "category": "<Professional category name>",
    "consumerDescription": "<2-3 sentences about this category for consumers in ${input.countryName}>",
    "anchors": ["<8-12 strategic research pillars — e.g. Product Quality, Price & Value, Brand Trust, Purchase Channels, Health & Nutrition, Cooking & Usage, Freshness & Storage, Regional Preferences, Premium vs Mass, Online vs Offline>"],
    "subCategories": [{"name": "<n>", "anchors": ["<4-6 specific anchors>"]}],
    "defaultKeywords": ["<EXACTLY 150 search keywords>"],
    "keyBrands": ["<10-20 brands in ${input.countryName}>"]
}

IMPORTANT: Generate 8-12 subCategories covering distinct research dimensions. NOT 3-4.

KEYWORD RULES:
- Every keyword = a real Google search query people in ${input.countryName} would type.
- Mix: 30 head terms (1-2 words), 70 mid-tail (3-4 words), 50 long-tail (5+ words).
- Include: brand queries, price queries, "best X", "X vs Y", "how to", "X review", "buy X online".
- 80%+ must contain "${input.categoryText}" or a close variant.
- Specific to ${input.countryName}. Use local platforms and currency.
- NO duplicates. NO academic phrases. NO standalone substitute-product terms.

Output ONLY JSON.`;

    try {
        console.log(`[CategoryGen] Call 1/6: Structure + 150 keywords...`);
        emitProgress(0, 'Generating category structure + 150 seed keywords', 0);
        const resp1 = await ai.models.generateContent({
            model: MODEL,
            contents: prompt1,
            config: { maxOutputTokens: 8000, temperature: 0.7 },
        });

        const parsed = safeParseJSON(resp1?.text || '');
        if (!parsed?.category || !parsed?.defaultKeywords) {
            return { ok: false, error: "AI returned invalid structure.", rawResponse: (resp1?.text || '').substring(0, 500) };
        }
        if ((parsed.anchors?.length || 0) < 3) {
            return { ok: false, error: "Too few anchors." };
        }

        let allKeywords: string[] = [...(parsed.defaultKeywords || [])];
        const brands = parsed.keyBrands || [];
        console.log(`[CategoryGen] Call 1 done: ${allKeywords.length} kw, ${brands.length} brands`);
        emitProgress(1, `Structure ready: ${allKeywords.length} keywords, ${brands.length} brands`, allKeywords.length);

        // --- CALLS 2-6: Keyword expansion (100 each, 2s delay between) ---
        // 150 seed + 5×100 expansion = 650 before dedup → ~500 after
        const langContext = input.language.includes(',') ? `Generate keywords in ALL of these languages: ${input.language}. Include transliterated/romanized versions of non-English terms.` : `Generate keywords in ${input.language}.`;
        
        const batches = [
            { focus: 'brand-specific and price queries', detail: `For each brand (${brands.slice(0, 8).join(', ')}): "[brand] ${input.categoryText} price", "[brand] review", "[brand] vs [competitor]", "buy [brand] online", "[brand] ${input.categoryText} 1kg price". Also price queries: "cheap ${input.categoryText}", "${input.categoryText} rate today", "${input.categoryText} wholesale price".` },
            { focus: 'informational and how-to queries', detail: `"how to store ${input.categoryText}", "is ${input.categoryText} good for health", "${input.categoryText} nutrition 100g", "why does ${input.categoryText} become hard", "${input.categoryText} calories", "${input.categoryText} protein content", "homemade ${input.categoryText} recipe", "${input.categoryText} shelf life".` },
            { focus: 'comparison and commercial queries', detail: `"${input.categoryText} vs [alternative]", "best ${input.categoryText} brand", "${input.categoryText} for [specific dish]", "organic vs regular ${input.categoryText}", "which ${input.categoryText} is best for cooking", "top 10 ${input.categoryText} brands in ${input.countryName}", "${input.categoryText} review".` },
            { focus: `regional and language-specific queries in ${input.language}`, detail: `Generate keywords that people in different regions of ${input.countryName} would search. Include local city names, regional terms, and transliterated queries. ${langContext} Examples: "${input.categoryText} in [city name]", "[regional term for ${input.categoryText}]", "${input.categoryText} home delivery [city]", "best ${input.categoryText} [region]".` },
            { focus: 'purchase channels, delivery, and occasion queries', detail: `"${input.categoryText} on Amazon", "${input.categoryText} BigBasket", "${input.categoryText} home delivery", "order ${input.categoryText} online", "${input.categoryText} near me", "${input.categoryText} subscription", "${input.categoryText} for [festival/occasion]", "${input.categoryText} gift pack", "bulk ${input.categoryText} order".` },
        ];

        for (let i = 0; i < batches.length; i++) {
            await new Promise(r => setTimeout(r, 2500)); // Rate limit safety

            const b = batches[i];
            const expandPrompt = `Generate EXACTLY 100 Google search keywords for "${parsed.category}" in ${input.countryName}.

Focus: ${b.focus}
Examples: ${b.detail}

RULES:
- Real search queries only. Things people actually type into Google.
- 80%+ must contain "${input.categoryText}" or a variant.
- NO duplicates with existing keywords.
- ${langContext}
- Specific to ${input.countryName} market.

Output ONLY a JSON array: ["keyword1", "keyword2", ...]`;

            try {
                console.log(`[CategoryGen] Call ${i + 2}/6: ${b.focus}...`);
                emitProgress(i + 1, `Expanding: ${b.focus}`, allKeywords.length);
                const resp = await ai.models.generateContent({
                    model: MODEL,
                    contents: expandPrompt,
                    config: { maxOutputTokens: 4000, temperature: 0.8 },
                });
                const expanded = safeParseJSON(resp?.text || '');
                if (Array.isArray(expanded)) {
                    allKeywords.push(...expanded.filter((k: string) => typeof k === 'string' && k.length > 2));
                    console.log(`[CategoryGen] Call ${i + 2} done: +${expanded.length} (total: ${allKeywords.length})`);
                }
            } catch (e: any) {
                console.warn(`[CategoryGen] Expansion ${i + 2} failed: ${e.message}`);
            }
        }

        // Deduplicate
        const seen = new Set<string>();
        allKeywords = allKeywords.filter(kw => {
            const key = kw.toLowerCase().trim();
            if (seen.has(key) || key.length < 2) return false;
            seen.add(key);
            return true;
        });

        console.log(`[CategoryGen] Final: ${allKeywords.length} unique keywords`);
        emitProgress(5, `Complete: ${allKeywords.length} unique keywords`, allKeywords.length);

        const category: AiGeneratedCategory = {
            id: slugify(parsed.category),
            category: parsed.category,
            consumerDescription: parsed.consumerDescription || '',
            anchors: parsed.anchors || [],
            subCategories: (parsed.subCategories || []).map((sc: any) => ({
                name: sc.name || 'General',
                anchors: sc.anchors || [],
            })),
            defaultKeywords: allKeywords,
            keyBrands: brands,
            generatedAt: new Date().toISOString(),
        };

        return { ok: true, category };

    } catch (e: any) {
        return { ok: false, error: `Gemini API error: ${e.message}` };
    }
}
