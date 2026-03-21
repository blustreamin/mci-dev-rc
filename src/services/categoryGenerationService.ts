/**
 * Category Generation Service
 * 
 * Takes a free-text category description + geography context and uses Gemini
 * to generate a full CategoryBaseline-compatible config (anchors, sub-categories,
 * seed keywords, key brands).
 * 
 * This replaces the need for hardcoded CORE_CATEGORIES for new projects.
 */

import { GoogleGenAI } from "@google/genai";
import { AiGeneratedCategory, IndustryId } from '../config/projectContext';

const MODEL = 'gemini-2.5-flash-preview-05-20';

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
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .substring(0, 40)
        .replace(/^-|-$/g, '');
}

export interface CategoryGenerationInput {
    categoryText: string;     // "premium dog food", "electric two-wheelers", etc.
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
    if (!apiKey) {
        return { ok: false, error: "Gemini API key not configured." };
    }

    const ai = new GoogleGenAI({ apiKey });

    const prompt = `You are a Category Intelligence Architect for consumer and market research.

A user wants to set up a research project for the following:
- Category: "${input.categoryText}"
- Industry: ${input.industry}
- Country/Market: ${input.countryName} (${input.countryCode})
- Language: ${input.language}

Your task is to generate a complete category research configuration. Think like a senior research consultant at Nielsen, Kantar, or McKinsey setting up a category deep-dive.

Generate STRICT JSON with this exact schema:
{
    "category": "<Clean, professional category name — e.g. 'Premium Dog Food', 'Electric Two-Wheelers', 'Men's Face Care'>",
    "consumerDescription": "<2-3 sentence description of what this category means to consumers in ${input.countryName}. What problem does it solve? What aspiration does it serve?>",
    "anchors": ["<5-8 strategic research pillars/themes for this category — e.g. 'Product Performance & Quality', 'Price & Value Perception', 'Brand Trust & Loyalty', 'Purchase Channels', 'Emerging Trends'>"],
    "subCategories": [
        {
            "name": "<Sub-category group name>",
            "anchors": ["<3-6 specific research anchors within this sub-category>"]
        }
    ],
    "defaultKeywords": ["<20-30 high-relevance consumer search keywords for this category in ${input.countryName}. Mix of branded, generic, problem-solution, and comparison queries. Must be terms real consumers would type into Google in ${input.language}.>"],
    "keyBrands": ["<8-15 key brands competing in this category in ${input.countryName}. Include both market leaders and notable challengers/D2C brands.>"]
}

RULES:
1. Sub-categories: Generate 2-4 meaningful sub-category groups, each with 3-6 anchors.
2. Keywords: Must be realistic search queries in ${input.language} for ${input.countryName}. Include "best", "vs", "review", "price", "buy" variations. No generic filler.
3. Brands: Only include brands actually available/relevant in ${input.countryName}. Do NOT include global brands that don't operate there.
4. Anchors: Should be strategic research themes, not product features. Think: "Purchase Decision Journey", "Sustainability Concerns", "Digital vs Offline Channel Mix".
5. Be specific to ${input.countryName} — pricing in local currency context, local platforms (e.g. Flipkart/Amazon.in for India, Amazon.com for US), local consumer behaviours.

Output ONLY the JSON. No markdown, no explanations.`;

    try {
        const response = await ai.models.generateContent({
            model: MODEL,
            contents: prompt,
        });

        const raw = response?.text || '';
        const parsed = safeParseJSON(raw);

        if (!parsed || !parsed.category || !parsed.anchors || !parsed.defaultKeywords) {
            return { 
                ok: false, 
                error: "AI generated invalid structure. Missing required fields.", 
                rawResponse: raw.substring(0, 500) 
            };
        }

        // Validate minimum quality
        if (parsed.anchors.length < 3) {
            return { ok: false, error: "AI generated too few anchors (need at least 3).", rawResponse: raw.substring(0, 500) };
        }
        if (parsed.defaultKeywords.length < 10) {
            return { ok: false, error: "AI generated too few keywords (need at least 10).", rawResponse: raw.substring(0, 500) };
        }

        const category: AiGeneratedCategory = {
            id: slugify(parsed.category),
            category: parsed.category,
            consumerDescription: parsed.consumerDescription || '',
            anchors: parsed.anchors || [],
            subCategories: (parsed.subCategories || []).map((sc: any) => ({
                name: sc.name || 'General',
                anchors: sc.anchors || [],
            })),
            defaultKeywords: parsed.defaultKeywords || [],
            keyBrands: parsed.keyBrands || [],
            generatedAt: new Date().toISOString(),
        };

        return { ok: true, category };

    } catch (e: any) {
        return { ok: false, error: `Gemini API error: ${e.message}` };
    }
}
