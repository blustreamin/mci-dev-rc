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

export async function generateCategoryConfig(
    input: CategoryGenerationInput
): Promise<CategoryGenerationResult> {
    const apiKey = getApiKey();
    if (!apiKey) return { ok: false, error: "Gemini API key not configured." };

    const ai = new GoogleGenAI({ apiKey });

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
    "anchors": ["<6-10 strategic research pillars>"],
    "subCategories": [{"name": "<n>", "anchors": ["<4-8 anchors>"]}],
    "defaultKeywords": ["<EXACTLY 150 search keywords>"],
    "keyBrands": ["<10-20 brands in ${input.countryName}>"]
}

KEYWORD RULES:
- Every keyword = a real Google search query people in ${input.countryName} would type.
- Mix: 30 head terms (1-2 words), 70 mid-tail (3-4 words), 50 long-tail (5+ words).
- Include: brand queries, price queries, "best X", "X vs Y", "how to", "X review", "buy X online".
- 80%+ must contain "${input.categoryText}" or a close variant.
- Specific to ${input.countryName}. Use local platforms and currency.
- NO duplicates. NO academic phrases. NO standalone substitute-product terms.

Output ONLY JSON.`;

    try {
        console.log(`[CategoryGen] Call 1/4: Structure + 150 keywords...`);
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

        // --- CALLS 2-4: Keyword expansion (150 each, 2s delay between) ---
        const batches = [
            { focus: 'brand-specific, price, and purchase-intent queries', detail: `For each brand (${brands.slice(0, 8).join(', ')}): "[brand] ${input.categoryText} price", "[brand] review", "[brand] vs [competitor]", "buy [brand] online". Also: "${input.categoryText} price per kg", "cheap ${input.categoryText}", "${input.categoryText} offer today".` },
            { focus: 'informational, how-to, problem-solution queries', detail: `"how to store ${input.categoryText}", "is ${input.categoryText} good for health", "${input.categoryText} nutrition facts", "why does ${input.categoryText} become hard", "${input.categoryText} calories", "${input.categoryText} benefits for gym", "homemade ${input.categoryText} recipe".` },
            { focus: 'comparison, long-tail, and niche queries', detail: `"${input.categoryText} vs [alternative]", "best ${input.categoryText} brand in [city]", "${input.categoryText} for [specific dish]", "organic vs regular ${input.categoryText}", "${input.categoryText} home delivery [city]", "which ${input.categoryText} is best for [use case]".` },
        ];

        for (let i = 0; i < batches.length; i++) {
            await new Promise(r => setTimeout(r, 2500)); // Rate limit safety

            const b = batches[i];
            const expandPrompt = `Generate EXACTLY 150 Google search keywords for "${parsed.category}" in ${input.countryName}.

Focus: ${b.focus}
Examples: ${b.detail}

RULES:
- Real search queries only. Things people actually type into Google.
- 80%+ must contain "${input.categoryText}" or a variant.
- NO duplicates with existing keywords.
- Specific to ${input.countryName} market, ${input.language} language.

Output ONLY a JSON array: ["keyword1", "keyword2", ...]`;

            try {
                console.log(`[CategoryGen] Call ${i + 2}/4: ${b.focus}...`);
                const resp = await ai.models.generateContent({
                    model: MODEL,
                    contents: expandPrompt,
                    config: { maxOutputTokens: 5000, temperature: 0.8 },
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
