
import { HEAD_TERMS, BRAND_PACKS } from '../services/categoryKeywordGuard';

// Stopwords to ignore during tokenization
const STOPWORDS = new Set([
    'and', 'or', 'the', 'a', 'an', 'in', 'on', 'at', 'for', 'to', 'of', 'with', 'by', 
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 
    'does', 'did', 'but', 'if', 'so', 'not', 'no', 'can', 'could', 'should', 'would',
    'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those', 'men', 'mens', 'male', 'india'
]);

export function selectAnchorKeywordChips(args: {
    anchorTitle: string;
    anchorContext: string;
    keywordPool: any[]; // Expecting objects with { keyword: string }
    categoryId: string;
}): string[] {
    const { anchorTitle, anchorContext, keywordPool, categoryId } = args;
    const titleLower = anchorTitle.toLowerCase();
    const contextLower = (anchorContext || "").toLowerCase();
    
    // 1. Extract Semantic Tokens from Anchor
    const tokens = new Set<string>();
    
    // From Title (High Weight)
    titleLower.split(/[^a-z0-9]+/).forEach(t => {
        if (t.length > 2 && !STOPWORDS.has(t)) tokens.add(t);
    });

    // From Context (Medium Weight) - extract tokens
    contextLower.split(/[^a-z0-9]+/).forEach(t => {
        if (t.length > 4 && !STOPWORDS.has(t)) tokens.add(t);
    });

    // 2. Score Candidates
    const candidates = keywordPool.map(item => {
        const text = (item.keyword || item).toLowerCase(); // Handle string or object
        let score = 0;
        
        // Token Overlap
        tokens.forEach(t => {
            if (text.includes(t)) score += 10;
        });

        // Intent Bonus
        if (text.includes('best') || text.includes('price') || text.includes('review')) score += 2;

        // Penalize Brand spam if anchor is not about brands
        const isBrandAnchor = titleLower.includes('brand') || titleLower.includes('top') || titleLower.includes('best');
        if (!isBrandAnchor) {
            const brands = BRAND_PACKS[categoryId] || [];
            const hasBrand = brands.some(b => text.includes(b));
            if (hasBrand) score -= 5;
        }

        return { text: (item.keyword || item), score };
    });

    // 3. Filter & Sort
    const selected = candidates
        .filter(c => c.score > 0)
        .sort((a, b) => b.score - a.score);

    let finalChips = selected.map(c => c.text);
    
    // Dedupe
    finalChips = Array.from(new Set(finalChips));

    // Fallback: If < 5 chips, use generic high volume ones that aren't already there
    if (finalChips.length < 5) {
         const generic = keywordPool
             .map(k => (k.keyword || k))
             .filter(k => typeof k === 'string' && (k.includes('price') || k.includes('review') || k.includes('best')))
             .slice(0, 10);
         finalChips = Array.from(new Set([...finalChips, ...generic]));
    }

    return finalChips.slice(0, 12);
}

// Maintain signature compatibility for existing calls if any
export const filterKeywordsForAnchor = (args: any) => {
    // Adapter to new logic
    return selectAnchorKeywordChips({
        anchorTitle: args.anchorTitle,
        anchorContext: args.anchorContext,
        keywordPool: args.keywords.map((k: string) => ({ keyword: k })),
        categoryId: args.categoryId
    });
};
