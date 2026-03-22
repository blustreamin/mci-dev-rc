/**
 * Category Generation Service — Claude (Anthropic API)
 * 
 * Uses Claude Sonnet via the Anthropic Messages API for reliable structured JSON output.
 * Multi-call: Call 0 (extract product) + Call 1 (structure + 150kw) + Calls 2-6 (100kw each)
 */

import { AiGeneratedCategory, IndustryId } from '../config/projectContext';

const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

function safeParseJSON(input: string): any {
    if (!input) return null;
    let cleaned = input.replace(/```json/gi, "").replace(/```/g, "").trim();
    try { return JSON.parse(cleaned); } catch {}
    const objMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objMatch) { try { return JSON.parse(objMatch[0]); } catch {} }
    return null;
}

function slugify(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').substring(0, 40).replace(/^-|-$/g, '');
}

async function callClaude(systemPrompt: string, userMessage: string, maxTokens: number = 4096): Promise<string> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            model: CLAUDE_MODEL,
            max_tokens: maxTokens,
            system: systemPrompt,
            messages: [{ role: "user", content: userMessage }],
        }),
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Claude API ${response.status}: ${err.substring(0, 200)}`);
    }

    const data = await response.json();
    return data.content?.[0]?.text || '';
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

    const startTime = Date.now();
    const STEP_TIMES = [3, 12, 8, 8, 8, 8, 8];

    const emitProgress = (step: number, phase: string, keywords: number) => {
        const elapsed = (Date.now() - startTime) / 1000;
        const remaining = STEP_TIMES.slice(step).reduce((s, v) => s + v, 0);
        onProgress?.({ step: step + 1, totalSteps: 7, phase, keywords, elapsedSec: Math.round(elapsed), estimatedRemainingSec: Math.round(remaining) });
    };

    const systemPrompt = `You are a search keyword researcher. You ALWAYS respond with valid JSON only. No markdown, no explanation, no preamble — just the JSON object or array requested.`;

    // --- CALL 0: Extract core product term ---
    let coreProduct = '';
    try {
        emitProgress(0, 'Extracting core product term...', 0);
        const extractResp = await callClaude(
            'You extract product terms. Respond with ONLY the product term, nothing else.',
            `Extract the single core product term (1-2 words, lowercase) from this brief:\n\n"${input.categoryText}"\n\nExamples:\n- "Indiska Paneer is a premium artisanal fresh malai paneer brand..." → paneer\n- "A luxury beard oil brand targeting urban men..." → beard oil\n- "Premium organic dog food for Indian pet owners..." → dog food\n\nRespond with ONLY the term:`,
            50
        );
        coreProduct = extractResp.trim().toLowerCase().replace(/['".\n]/g, '');
    } catch (e) {
        const words = input.categoryText.toLowerCase().split(/\s+/);
        const common = ['paneer', 'cheese', 'milk', 'butter', 'ghee', 'shampoo', 'soap', 'oil', 'cream', 'phone', 'laptop', 'car', 'bike', 'tea', 'coffee'];
        coreProduct = common.find(p => words.includes(p)) || words.filter(w => w.length >= 4)[0] || 'product';
    }
    console.log(`[CategoryGen] Core product: "${coreProduct}"`);
    emitProgress(0, `Core product: "${coreProduct}"`, 0);

    // --- CALL 1: Structure + 150 keywords ---
    try {
        emitProgress(1, 'Generating category structure + 150 seed keywords via Claude...', 0);

        const call1Prompt = `Generate a keyword research framework for: "${input.categoryText}"

CORE PRODUCT: "${coreProduct}"
Industry: ${input.industry}
Country: ${input.countryName} (${input.countryCode})
Languages: ${input.language}

Return a JSON object with this exact schema:
{
    "category": "Short professional category name (3-5 words max)",
    "consumerDescription": "2-3 sentences about this category for consumers in ${input.countryName}",
    "anchors": ["8-12 strategic research pillars"],
    "subCategories": [{"name": "subcategory name", "anchors": ["4-6 specific anchors"]}],
    "defaultKeywords": ["EXACTLY 150 Google search keywords — see rules below"],
    "keyBrands": ["10-20 brands in ${input.countryName}"]
}

KEYWORD RULES:
PART A (80 keywords) — MANDATORY generic keywords that WILL have Google search volume:
- Head terms: "${coreProduct}", "${coreProduct} price", "best ${coreProduct}", "${coreProduct} near me", "buy ${coreProduct} online"
- Brand queries: "[Brand] ${coreProduct}" for top 10 brands
- Price: "${coreProduct} price per kg", "${coreProduct} 1kg price", "cheap ${coreProduct}"
- Comparison: "${coreProduct} vs [alternative]", "best ${coreProduct} brand India"
- How-to: "how to store ${coreProduct}", "how to make ${coreProduct}", "${coreProduct} recipes"
- Purchase: "buy ${coreProduct} online", "${coreProduct} home delivery", "${coreProduct} on Amazon"
- Health: "${coreProduct} nutrition", "${coreProduct} protein", "is ${coreProduct} healthy"
- Do NOT include the brand name from the brief. Just "${coreProduct}" + modifiers.

PART B (70 keywords) — Brief-specific niche keywords:
- Brand-specific terms from the brief
- Premium/artisanal variants, SKU-related searches
- Regional terms for ${input.countryName}

Generate 8-12 subCategories covering distinct research dimensions.
DETERMINISTIC: Start Part A with: "${coreProduct}", "${coreProduct} price", "best ${coreProduct}", "${coreProduct} near me", "buy ${coreProduct} online", "${coreProduct} brand", "${coreProduct} review".

Respond with ONLY the JSON object.`;

        const resp1 = await callClaude(systemPrompt, call1Prompt, 8000);
        const parsed = safeParseJSON(resp1);

        if (!parsed?.category || !parsed?.defaultKeywords) {
            console.error(`[CategoryGen] Call 1 failed. Preview: ${resp1.substring(0, 300)}`);
            return { ok: false, error: "AI returned invalid structure.", rawResponse: resp1.substring(0, 500) };
        }

        let allKeywords: string[] = [...(parsed.defaultKeywords || [])];
        const brands = parsed.keyBrands || [];
        console.log(`[CategoryGen] Call 1 done: ${allKeywords.length} kw, ${brands.length} brands`);
        emitProgress(1, `Structure ready: ${allKeywords.length} keywords, ${brands.length} brands`, allKeywords.length);

        // --- CALLS 2-6: Keyword expansion (100 each) ---
        const langContext = input.language.includes(',') ? `Generate keywords in ALL of these languages: ${input.language}. Include transliterated/romanized versions.` : `Generate keywords in ${input.language}.`;

        const batches = [
            { focus: 'brand-specific and price queries', detail: `For brands (${brands.slice(0, 8).join(', ')}): "[brand] ${coreProduct} price", "[brand] review", "[brand] vs [competitor]". Also: "${coreProduct} price per kg", "cheap ${coreProduct}", "${coreProduct} rate today".` },
            { focus: 'informational and how-to queries', detail: `"how to store ${coreProduct}", "is ${coreProduct} good for health", "${coreProduct} nutrition 100g", "${coreProduct} calories", "${coreProduct} protein content", "homemade ${coreProduct} recipe".` },
            { focus: 'comparison and commercial queries', detail: `"${coreProduct} vs [alternative]", "best ${coreProduct} brand", "organic vs regular ${coreProduct}", "top 10 ${coreProduct} brands in ${input.countryName}", "${coreProduct} review".` },
            { focus: `regional and language-specific queries in ${input.language}`, detail: `Keywords for different regions of ${input.countryName}. ${langContext} Examples: "${coreProduct} in Chennai", "${coreProduct} home delivery [city]", "best ${coreProduct} [region]".` },
            { focus: 'purchase channels, delivery, and occasion queries', detail: `"${coreProduct} on Amazon", "${coreProduct} BigBasket", "${coreProduct} Blinkit", "${coreProduct} home delivery", "order ${coreProduct} online", "${coreProduct} near me".` },
        ];

        for (let i = 0; i < batches.length; i++) {
            await new Promise(r => setTimeout(r, 1500));
            const b = batches[i];

            const expandPrompt = `Generate exactly 100 Google search keywords for "${parsed.category}" in ${input.countryName}.

Focus: ${b.focus}
Examples: ${b.detail}

Rules:
- Real search queries only.
- 80%+ must contain "${coreProduct}" or a variant.
- Generic enough to have Google Ads search volume.
- ${langContext}
- NO duplicates.

Respond with ONLY a JSON array of strings: ["keyword1", "keyword2", ...]`;

            try {
                emitProgress(i + 2, `Expanding: ${b.focus}`, allKeywords.length);
                const resp = await callClaude(systemPrompt, expandPrompt, 4000);
                const expanded = safeParseJSON(resp);
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
        emitProgress(6, `Complete: ${allKeywords.length} unique keywords`, allKeywords.length);

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
        return { ok: false, error: `Claude API error: ${e.message}` };
    }
}
