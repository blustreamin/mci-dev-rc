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

    const prompt = `You are a search keyword researcher building a keyword corpus for consumer market research. Your keywords will be validated against Google Ads search volume data via DataForSEO.

Category: "${input.categoryText}"
Industry: ${input.industry}
Country: ${input.countryName} (${input.countryCode})
Language: ${input.language}

Generate JSON with this schema:
{
    "category": "<Professional category name>",
    "consumerDescription": "<2-3 sentences about this category for consumers in ${input.countryName}>",
    "anchors": ["<6-10 strategic research pillars>"],
    "subCategories": [{"name": "<name>", "anchors": ["<4-8 anchors>"]}],
    "defaultKeywords": ["<MUST be 200-250 keywords>"],
    "keyBrands": ["<10-20 brands in ${input.countryName}>"]
}

CRITICAL KEYWORD RULES — your keywords will be checked against real Google search data. Bad keywords = zero volume = useless corpus.

GENERATE EXACTLY 200-250 KEYWORDS following this distribution:

HEAD TERMS (40 keywords, 1-2 words):
- Generic category terms: "paneer", "cottage cheese", "tofu"
- Brand names alone: "Amul", "Mother Dairy"  
- Category + modifier: "fresh paneer", "organic paneer", "malai paneer"

MID-TAIL (100 keywords, 3-4 words):
- "best paneer brand India"
- "paneer price per kg"
- "Amul paneer review"
- "paneer vs tofu protein"
- "buy paneer online"
- "paneer making at home"
- "low fat paneer brand"
- "paneer nutrition per 100g"

LONG-TAIL (80 keywords, 5+ words):
- "how to check paneer is fresh"
- "best paneer for butter masala"
- "Amul paneer price 1 kg Delhi"
- "is paneer good for weight loss"
- "difference between paneer and cottage cheese"
- "which brand paneer is best for cooking"

FOR EACH of the top 10 brands, generate 5-8 brand-specific keywords:
- "[Brand] paneer price"
- "[Brand] paneer 1kg"
- "[Brand] paneer review"
- "[Brand] vs [Competitor]"
- "is [Brand] paneer good"
- "[Brand] paneer online"

ALSO INCLUDE:
- 20+ price queries: "paneer price", "cheap paneer", "paneer 500g price", "paneer rate today"
- 20+ comparison queries: "[A] vs [B]", "paneer vs tofu", "fresh vs packaged paneer"  
- 20+ problem/solution: "why paneer becomes hard", "how to store paneer", "paneer not setting"
- 15+ purchase queries: "buy paneer online", "paneer near me", "paneer home delivery", "paneer on Amazon"
- 10+ recipe/usage: "paneer tikka recipe", "paneer for gym", "paneer protein content"

RULES:
1. EVERY keyword must be something a real person types into Google. NOT research themes or anchor descriptions.
2. Use ${input.language} language terms where consumers would naturally search in that language.
3. Include local platforms: Flipkart, Amazon.in, BigBasket, Blinkit for India.
4. NO duplicates. NO filler. NO academic phrases.
5. The examples above use paneer — adapt ALL keywords to "${input.categoryText}" specifically.
6. CRITICAL: Every keyword MUST be directly about "${input.categoryText}". Do NOT include keywords about substitute or adjacent categories (e.g., for paneer do NOT include "tofu", "cottage cheese", "cheese", "curd" as standalone terms — only include them in comparison queries like "paneer vs tofu").
7. At least 80% of keywords must contain the core product term or a close variant of "${input.categoryText}".

Output ONLY the JSON. No markdown.`;

    try {
        const response = await ai.models.generateContent({
            model: MODEL,
            contents: prompt,
            config: {
                maxOutputTokens: 16000,  // 200+ keywords = large JSON
                temperature: 0.7,        // Some creativity for keyword variety
            },
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
        if (parsed.defaultKeywords.length < 100) {
            return { ok: false, error: `Only ${parsed.defaultKeywords.length} keywords generated (need 100+). Try again.`, rawResponse: raw.substring(0, 500) };
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
