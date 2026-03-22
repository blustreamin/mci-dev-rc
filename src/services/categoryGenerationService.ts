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
    try { return JSON.parse(cleaned); } catch {}
    // Try extracting JSON object
    const objMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objMatch) { try { return JSON.parse(objMatch[0]); } catch {} }
    // Try extracting JSON array
    const arrMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrMatch) { try { return JSON.parse(arrMatch[0]); } catch {} }
    return null;
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
    const STEP_TIMES = [3, 15, 8, 8, 8, 8, 8]; // estimated seconds per step

    const emitProgress = (step: number, phase: string, keywords: number) => {
        const elapsed = (Date.now() - startTime) / 1000;
        const remaining = STEP_TIMES.slice(step).reduce((s, v) => s + v, 0);
        onProgress?.({ step: step + 1, totalSteps: 7, phase, keywords, elapsedSec: Math.round(elapsed), estimatedRemainingSec: Math.round(remaining) });
    };

    // --- CALL 0: Extract core product term via LLM (deterministic) ---
    // This ensures consistent extraction regardless of brief phrasing
    let coreProduct = '';
    try {
        emitProgress(0, 'Extracting core product term from brief...', 0);
        const extractResp = await ai.models.generateContent({
            model: MODEL,
            contents: `Extract the SINGLE core product term from this brief. Return ONLY the product term (1-2 words, lowercase). No explanation.

Brief: "${input.categoryText}"

Examples:
- "Indiska Paneer is a premium artisanal fresh malai paneer brand..." → "paneer"
- "A luxury beard oil brand targeting urban men..." → "beard oil"  
- "Premium organic dog food for Indian pet owners..." → "dog food"
- "Electric scooter startup competing with Ola and Ather..." → "electric scooter"

Return ONLY the product term:`,
            config: { maxOutputTokens: 50, temperature: 0 },
        });
        coreProduct = (extractResp?.text || '').trim().toLowerCase().replace(/['"]/g, '');
    } catch (e) {
        // Fallback: heuristic extraction
        const briefWords = input.categoryText.toLowerCase().split(/\s+/);
        const commonProducts = ['paneer', 'cheese', 'milk', 'yogurt', 'butter', 'ghee', 'shampoo', 'soap', 'oil', 'cream', 'serum', 'phone', 'laptop', 'car', 'bike', 'scooter', 'tea', 'coffee', 'snack', 'chocolate'];
        coreProduct = commonProducts.find(p => briefWords.includes(p)) || briefWords.filter(w => w.length >= 4)[0] || 'product';
    }
    console.log(`[CategoryGen] Core product term: "${coreProduct}"`);
    emitProgress(0, `Core product: "${coreProduct}"`, 0);

    // --- CALL 1: Structure + 150 seed keywords (MANDATORY GENERIC + BRAND SPECIFIC) ---
    const prompt1 = `You are a search keyword researcher. Keywords will be validated against Google Ads search volume data.

BRIEF: "${input.categoryText}"
CORE PRODUCT: "${coreProduct}"
Industry: ${input.industry}
Country: ${input.countryName} (${input.countryCode})
Language: ${input.language}

Generate JSON:
{
    "category": "<SHORT professional category name, 3-5 words max>",
    "consumerDescription": "<2-3 sentences about this category for consumers in ${input.countryName}>",
    "anchors": ["<8-12 strategic research pillars>"],
    "subCategories": [{"name": "<n>", "anchors": ["<4-6 specific anchors>"]}],
    "defaultKeywords": ["<EXACTLY 150 keywords — see SPLIT below>"],
    "keyBrands": ["<10-20 brands in ${input.countryName}>"]
}

IMPORTANT: Generate 8-12 subCategories covering distinct research dimensions.

CRITICAL KEYWORD SPLIT — your keywords will be checked against Google Ads. Zero-volume keywords are USELESS.

PART A: MANDATORY GENERIC KEYWORDS (80 keywords) — These MUST have search volume:
- Head terms: "${coreProduct}", "${coreProduct} price", "${coreProduct} near me", "best ${coreProduct}", "buy ${coreProduct} online"
- Brand queries: "[Brand] ${coreProduct}" for top 10 brands
- Price: "${coreProduct} price per kg", "${coreProduct} 1kg price", "cheap ${coreProduct}", "${coreProduct} rate today"
- Comparison: "${coreProduct} vs [alternative]", "best ${coreProduct} brand India"
- How-to: "how to store ${coreProduct}", "how to make ${coreProduct}", "${coreProduct} recipes"
- Purchase: "buy ${coreProduct} online", "${coreProduct} home delivery", "${coreProduct} on Amazon", "${coreProduct} BigBasket"
- Health: "${coreProduct} nutrition", "${coreProduct} protein", "${coreProduct} calories", "is ${coreProduct} healthy"
- These are GENERIC — do NOT include the brand name from the brief. Just "${coreProduct}" + modifiers.

PART B: BRIEF-SPECIFIC KEYWORDS (70 keywords) — Niche terms from the brief:
- Brand-specific: terms related to the specific brand/positioning described in the brief
- Premium/artisanal variants, texture terms, SKU-related searches
- Regional terms specific to the geography mentioned in the brief
- Competitive positioning queries

RULES:
1. Every keyword = a real Google search query. NOT research themes.
2. Part A keywords should be GENERIC — they WILL have search volume.
3. Part B can be more niche but must still be plausible search queries.
4. ${input.language} language terms where natural.
5. NO duplicates. NO academic phrases.
6. DETERMINISTIC ORDERING: Always start Part A with these exact keywords in order: "${coreProduct}", "${coreProduct} price", "best ${coreProduct}", "${coreProduct} near me", "buy ${coreProduct} online", "${coreProduct} brand", "${coreProduct} review". Then add the rest.
7. For the SAME brief, you MUST generate the SAME keywords every time. Be systematic, not creative.

Output ONLY JSON.`;

    try {
        console.log(`[CategoryGen] Call 1/6: Structure + 150 keywords...`);
        emitProgress(0, 'Generating category structure + 150 seed keywords', 0);
        const resp1 = await ai.models.generateContent({
            model: MODEL,
            contents: prompt1,
            config: { maxOutputTokens: 8000, temperature: 0, responseMimeType: 'application/json' },
        });

        const parsed = safeParseJSON(resp1?.text || '');
        if (!parsed?.category || !parsed?.defaultKeywords) {
            console.error(`[CategoryGen] Call 1 FAILED. Response length: ${(resp1?.text || '').length}. Preview: ${(resp1?.text || '').substring(0, 300)}`);
            return { ok: false, error: "AI returned invalid structure. Check browser console for details.", rawResponse: (resp1?.text || '').substring(0, 500) };
        }
        if ((parsed.anchors?.length || 0) < 3) {
            return { ok: false, error: "Too few anchors." };
        }

        let allKeywords: string[] = [...(parsed.defaultKeywords || [])];
        const brands = parsed.keyBrands || [];
        console.log(`[CategoryGen] Call 1 done: ${allKeywords.length} kw, ${brands.length} brands`);
        emitProgress(1, `Structure ready: ${allKeywords.length} keywords, ${brands.length} brands`, allKeywords.length);

        // --- CALLS 2-6: Keyword expansion (100 each, 2.5s delay between) ---
        const langContext = input.language.includes(',') ? `Generate keywords in ALL of these languages: ${input.language}. Include transliterated/romanized versions of non-English terms.` : `Generate keywords in ${input.language}.`;
        
        const batches = [
            { focus: 'brand-specific and price queries', detail: `For each brand (${brands.slice(0, 8).join(', ')}): "[brand] ${coreProduct} price", "[brand] ${coreProduct} review", "[brand] vs [competitor]", "buy [brand] ${coreProduct} online". Also: "${coreProduct} price per kg", "cheap ${coreProduct}", "${coreProduct} rate today", "${coreProduct} wholesale price", "${coreProduct} 500g price", "${coreProduct} 1kg price".` },
            { focus: 'informational and how-to queries', detail: `"how to store ${coreProduct}", "is ${coreProduct} good for health", "${coreProduct} nutrition 100g", "why does ${coreProduct} become hard", "${coreProduct} calories", "${coreProduct} protein content", "homemade ${coreProduct} recipe", "${coreProduct} shelf life", "${coreProduct} making at home", "${coreProduct} uses".` },
            { focus: 'comparison and commercial queries', detail: `"${coreProduct} vs [alternative]", "best ${coreProduct} brand", "${coreProduct} for [specific dish]", "organic vs regular ${coreProduct}", "which ${coreProduct} is best for cooking", "top 10 ${coreProduct} brands in ${input.countryName}", "${coreProduct} review", "fresh vs packaged ${coreProduct}", "${coreProduct} quality test".` },
            { focus: `regional and language-specific queries in ${input.language}`, detail: `Keywords people in different regions of ${input.countryName} would search. Include city names. ${langContext} Examples: "${coreProduct} in Chennai", "${coreProduct} in Bangalore", "${coreProduct} home delivery [city]", "best ${coreProduct} [region]", "${coreProduct} shop near me".` },
            { focus: 'purchase channels, delivery, and occasion queries', detail: `"${coreProduct} on Amazon", "${coreProduct} BigBasket", "${coreProduct} Blinkit", "${coreProduct} home delivery", "order ${coreProduct} online", "${coreProduct} near me", "${coreProduct} subscription", "buy fresh ${coreProduct}", "${coreProduct} delivery app", "${coreProduct} online ${input.countryName}".` },
        ];

        for (let i = 0; i < batches.length; i++) {
            await new Promise(r => setTimeout(r, 2500)); // Rate limit safety

            const b = batches[i];
            const expandPrompt = `Generate EXACTLY 100 Google search keywords for "${parsed.category}" in ${input.countryName}.

Focus: ${b.focus}
Examples: ${b.detail}

RULES:
- Real search queries only. Things people actually type into Google.
- 80%+ must contain "${coreProduct}" or a close variant.
- These keywords MUST be generic enough to have Google Ads search volume. 
- Do NOT use the full brand description. Use short terms like "${coreProduct}", "fresh ${coreProduct}", "best ${coreProduct}".
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
                    config: { maxOutputTokens: 4000, temperature: 0, responseMimeType: 'application/json' },
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
