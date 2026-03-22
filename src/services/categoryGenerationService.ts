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
    // Detect if language is non-Latin (Arabic, Hindi, Tamil, etc.)
    const nonLatinLanguages = ['ar', 'hi', 'ta', 'te', 'bn', 'mr', 'gu', 'kn', 'ml', 'pa', 'ur', 'th', 'ko', 'ja', 'zh'];
    const primaryLangCode = (input.language || 'en').split(',')[0].trim().toLowerCase();
    const isNonLatin = nonLatinLanguages.some(l => primaryLangCode.startsWith(l));
    
    const bilingualInstruction = isNonLatin 
        ? `\n\nCRITICAL LANGUAGE RULE: The target market uses ${input.language}, but Google Ads search volume data works BEST with English/Latin-script keywords. You MUST generate a MIX:
- PART A (80 keywords): ALL in English (Latin script). Examples: "${coreProduct} price", "best ${coreProduct}", "buy ${coreProduct} online". These are the keywords that will have Google Ads search volume.
- PART B (70 keywords): Mix of English (40) + ${input.language} script (30). For non-English keywords, also include the romanized/transliterated version. Example: if Arabic, include both "عصير برتقال" AND "aseer burtuqal".
- Category name, anchors, consumerDescription, and keyBrands should be in English.
- DO NOT generate all keywords in ${input.language} script — they will return ZERO search volume from Google Ads.`
        : '';

    const prompt1 = `You are a search keyword researcher. Keywords will be validated against Google Ads search volume data.

BRIEF: "${input.categoryText}"
CORE PRODUCT: "${coreProduct}"
Industry: ${input.industry}
Country: ${input.countryName} (${input.countryCode})
Language: ${input.language}${bilingualInstruction}

Generate JSON:
{
    "category": "<SHORT professional category name in English, 3-5 words max>",
    "consumerDescription": "<2-3 sentences about this category for consumers in ${input.countryName}>",
    "anchors": ["<8-12 strategic research pillars in English>"],
    "subCategories": [{"name": "<name in English>", "anchors": ["<4-6 specific anchors>"]}],
    "defaultKeywords": ["<EXACTLY 150 keywords — see SPLIT below>"],
    "keyBrands": ["<10-20 brands in ${input.countryName}>"]
}

IMPORTANT: Generate 8-12 subCategories covering distinct research dimensions.

CRITICAL KEYWORD SPLIT — your keywords will be checked against Google Ads. Zero-volume keywords are USELESS.

UNIVERSAL RULES FOR ALL KEYWORDS:
- DIVERSITY IS EVERYTHING. Do NOT generate 50 variations of "${coreProduct} + [modifier]". Instead generate DIVERSE short keywords across the full category universe.
- Keywords MUST be SHORT: 1-4 words. Anything over 5 words will have ZERO Google Ads volume. "best ${coreProduct}" = GOOD. "${coreProduct} for weight loss in India online buy" = ZERO VOLUME.
- Include competitor/alternative brand names as STANDALONE 1-2 word keywords (e.g., "Ozempic", "Hootsuite", "Amul" — not "${coreProduct} vs Ozempic").
- Include the CATEGORY name, PROBLEM/CONDITION name, and RELATED terms as separate keywords — not just the core product.
- At least 30 keywords should be 1-2 words only. At least 30 should be brand names.
${(() => {
    const text = input.categoryText.toLowerCase();
    const isPharma = input.industry === 'Health & Wellness' || text.match(/\b(pharma|drug|medicine|tablet|injection|capsule|syrup|dosage|prescription|generic|otc|semaglutide|insulin|vaccine|antibiotic)\b/);
    const isSaaS = input.industry === 'Technology / SaaS' || input.industry === 'Financial Services' || text.match(/\b(saas|software|tool|app|platform|automation|crm|erp|api)\b/);
    
    if (isPharma) return `
PHARMA/HEALTH CATEGORY DETECTED. Use pharmaceutical search patterns:

PART A: MANDATORY GENERIC KEYWORDS (80 keywords):
- ${isNonLatin ? 'ALL in English (Latin script).' : ''}
- Generic drug names: "${coreProduct}" and ALL synonyms/salts (1-2 words each)
- Brand names as STANDALONE keywords: List every brand selling this molecule (e.g., "Ozempic", "Wegovy", "Rybelsus", "Saxenda") — these are HIGH volume
- Drug class: the therapeutic class as a keyword (e.g., "glp-1", "glp-1 agonist", "incretin")
- Condition keywords: the conditions it treats as standalone keywords (e.g., "diabetes", "weight loss", "obesity", "type 2 diabetes")
- Form factor: "injection", "tablet", "pen", "oral" as standalone and combined with product
- Price/availability: "${coreProduct} price", "${coreProduct} cost", "${coreProduct} price India", "buy ${coreProduct}"
- Comparison: "[Brand A] vs [Brand B]" for top 5 pairs
- Side effects: "${coreProduct} side effects", "is ${coreProduct} safe"
- Manufacturer names as standalone: e.g., "Novo Nordisk", "Eli Lilly", "Dr Reddys", "Lupin"
- Related treatments: other drugs in the same class or for the same condition
- DO NOT generate long-tail like "${coreProduct} injection mechanism of action" — nobody searches that

PART B: BRIEF-SPECIFIC KEYWORDS (70 keywords):
- ${isNonLatin ? '40 English + 30 ' + input.language : 'Can include ' + input.language + ' terms'}
- Specific formulations, dosages, and strengths mentioned in the brief
- Patient journey keywords: "doctor consultation for [condition]", "[condition] treatment options"
- Insurance/cost: "[drug] insurance coverage", "affordable [drug]", "[drug] generic"
- Lifestyle keywords: "weight loss tips", "diabetes management", "how to lose weight fast"`;
    
    if (isSaaS) return `
B2B/SaaS/TECHNOLOGY CATEGORY DETECTED. Use SaaS search patterns:

PART A: MANDATORY GENERIC KEYWORDS (80 keywords):
- ${isNonLatin ? 'ALL in English (Latin script).' : ''}
- Head terms: "${coreProduct}", "best ${coreProduct}", "${coreProduct} tools", "${coreProduct} software", "free ${coreProduct}"
- Brand names as STANDALONE keywords: List every competitor tool (e.g., "Hootsuite", "Buffer", "Canva") — HIGH volume
- "[Brand] pricing", "[Brand] review", "[Brand] alternative", "[Brand] vs [Competitor]"
- Category terms: the broader category as keywords (e.g., "social media tools", "marketing software", "scheduling app")
- Problem keywords: what problem does this solve? (e.g., "how to schedule posts", "manage social media", "grow followers")
- Use cases: "${coreProduct} for startups", "${coreProduct} for freelancers"
- SHORT keywords only (2-4 words). "${coreProduct} software for small business owners" = ZERO VOLUME.

PART B: BRIEF-SPECIFIC KEYWORDS (70 keywords):
- ${isNonLatin ? '40 English + 30 ' + input.language : 'Can include ' + input.language + ' terms'}
- Adjacent tool categories and feature keywords
- Specific use cases from the brief`;
    
    return `
CONSUMER PRODUCT CATEGORY:

PART A: MANDATORY GENERIC KEYWORDS (80 keywords):
- ${isNonLatin ? 'ALL in English (Latin script).' : ''}
- Head terms: "${coreProduct}", "${coreProduct} price", "best ${coreProduct}", "buy ${coreProduct}"
- Brand names as STANDALONE keywords: List every competitor brand (e.g., "Amul", "Mother Dairy") — HIGH volume
- "[Brand] ${coreProduct}", "[Brand] price", "[Brand] review" for top 10 brands
- Category terms: the broader category (e.g., if paneer, also "dairy products", "cheese", "protein food")
- Price: "${coreProduct} price", "cheap ${coreProduct}", "${coreProduct} 1kg price"
- Purchase: "buy ${coreProduct} online", "${coreProduct} near me", "${coreProduct} delivery"
- How-to: "how to make ${coreProduct}", "${coreProduct} recipe"
- Health: "${coreProduct} benefits", "${coreProduct} nutrition", "${coreProduct} calories"
- DO NOT generate long-tail like "best ${coreProduct} brand in India for cooking" — keep it SHORT (1-4 words)

PART B: BRIEF-SPECIFIC KEYWORDS (70 keywords):
- ${isNonLatin ? '40 English + 30 ' + input.language : 'Can include ' + input.language + ' terms'}
- Brand-specific and premium/niche terms from the brief
- Regional terms, SKU-related searches, competitive positioning`;
})()}

RULES:
1. Every keyword = a real Google search query people actually type. NOT research themes or academic phrases.
2. DIVERSITY: No more than 5 keywords should share the same 3-word prefix. Spread across brands, conditions, features, comparisons.
3. LENGTH: At least 50 keywords must be 1-3 words. Maximum 4 words for Part A. Part B can go up to 5 words.
4. BRANDS: Include at least 20 competitor brand names as standalone 1-2 word keywords.
5. ${input.language} language terms where natural.
6. NO duplicates. NO academic phrases. NO keywords over 6 words.
7. For the SAME brief, you MUST generate the SAME keywords every time. Be systematic, not creative.

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

        // --- CALLS 2-6: Keyword expansion (100 each, 2.5s delay between) ---
        const langContext = isNonLatin 
            ? `CRITICAL: Generate 70%+ of keywords in English (Latin script). Google Ads has much better volume data for English keywords even in ${input.countryName}. Include up to 30% in ${input.language} script for local coverage.`
            : input.language.includes(',') 
                ? `Generate keywords in ALL of these languages: ${input.language}. Include transliterated/romanized versions of non-English terms.` 
                : `Generate keywords in ${input.language}.`;
        
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
