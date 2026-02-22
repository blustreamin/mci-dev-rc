/**
 * KEYWORD EXPANSION ENGINE
 * 
 * Takes curated seeds (~200) and expands to 1500+ using proven
 * Indian search patterns. All expansions follow real Google
 * autocomplete/suggest patterns.
 * 
 * Strategy:
 * 1. Head terms × brand matrix
 * 2. Price point modifiers (under 500, under 1000, etc.)
 * 3. Intent modifiers (best, review, vs, how to)
 * 4. Concern/benefit modifiers (for oily skin, for hair fall, etc.)
 * 5. Platform modifiers (amazon, flipkart, online)
 * 6. Alphabet expansion (face wash a → face wash acne, etc.)
 */

import { CURATED_SEEDS, getCuratedSeeds } from './curatedKeywordSeeds';
import { HEAD_TERMS, BRAND_PACKS } from './categoryKeywordGuard';

// Indian-specific price points that generate real searches
const PRICE_MODIFIERS = [
    'under 100', 'under 200', 'under 300', 'under 500',
    'under 1000', 'under 1500', 'under 2000', 'under 3000', 'under 5000',
    'price', 'price in india', 'price list', 'cost',
    'cheap', 'affordable', 'budget', 'premium'
];

// Intent modifiers that generate real search volume
const INTENT_MODIFIERS = [
    'best', 'top 10', 'top 5', 'review', 'reviews',
    'buy online', 'online', 'amazon', 'flipkart',
    'vs', 'or', 'comparison',
    'benefits', 'side effects', 'how to use',
    'for men', 'for men india', 'india',
    'new', 'latest', 'combo', 'combo offer', 'pack',
    'kit', 'set', 'gift set'
];

// Concern modifiers by category type
const CONCERN_MODIFIERS: Record<string, string[]> = {
    'skin': [
        'for oily skin', 'for dry skin', 'for sensitive skin', 
        'for acne', 'for pimples', 'for dark spots', 'for tan removal',
        'for pigmentation', 'for dark circles', 'for open pores',
        'for combination skin', 'for normal skin', 'for aging skin',
        'for glowing skin', 'for fair skin', 'for men oily skin',
        'for acne prone skin', 'for blackheads', 'for whiteheads'
    ],
    'hair': [
        'for hair fall', 'for hair growth', 'for dandruff', 'for dry hair',
        'for oily hair', 'for thin hair', 'for thick hair', 'for curly hair',
        'for straight hair', 'for colored hair', 'for grey hair',
        'for frizzy hair', 'for damaged hair', 'for men hair fall',
        'for dry scalp', 'for itchy scalp', 'for split ends'
    ],
    'body': [
        'for body odour', 'for sweating', 'for dry skin', 'for summer',
        'for winter', 'for gym', 'for sensitive skin', 'for daily use',
        'for office', 'for men', 'long lasting', 'all day'
    ],
    'grooming': [
        'for beginners', 'at home', 'tips', 'routine', 'tutorial',
        'step by step', 'for sensitive skin', 'without irritation',
        'daily', 'weekly', 'morning', 'night'
    ]
};

// Map categories to concern types
const CATEGORY_CONCERN_MAP: Record<string, string[]> = {
    'shaving': ['grooming'],
    'beard': ['grooming', 'hair'],
    'hair-styling': ['hair'],
    'sexual-wellness': [],
    'intimate-hygiene': ['body', 'skin'],
    'hair-colour': ['hair'],
    'face-care': ['skin'],
    'deodorants': ['body'],
    'hair-oil': ['hair'],
    'fragrance-premium': ['body'],
    'skincare-spec': ['skin'],
    'shampoo': ['hair'],
    'soap': ['body', 'skin'],
    'body-lotion': ['body', 'skin'],
    'talcum': ['body'],
    'oral-care': []
};

// Brand vs brand comparison pairs
function generateBrandComparisons(brands: string[]): string[] {
    const combos: string[] = [];
    const topBrands = brands.slice(0, 8); // Top 8 brands only
    for (let i = 0; i < topBrands.length; i++) {
        for (let j = i + 1; j < Math.min(topBrands.length, i + 3); j++) {
            combos.push(`${topBrands[i]} vs ${topBrands[j]}`);
        }
    }
    return combos;
}

export function expandKeywords(categoryId: string): string[] {
    const curated = getCuratedSeeds(categoryId);
    const heads = HEAD_TERMS[categoryId] || [];
    const brands = BRAND_PACKS[categoryId] || [];
    const expanded = new Set<string>(curated);
    
    // 1. Head terms × top brands (with product type)
    const topHeads = heads.slice(0, 6);
    const topBrands = brands.slice(0, 12);
    
    for (const brand of topBrands) {
        for (const head of topHeads) {
            expanded.add(`${brand} ${head}`);
            expanded.add(`${brand} ${head} price`);
            expanded.add(`${brand} ${head} review`);
            expanded.add(`${brand} ${head} for men`);
            expanded.add(`${brand} ${head} india`);
            expanded.add(`${brand} ${head} online`);
            expanded.add(`best ${brand} ${head}`);
        }
    }
    
    // 2. Head terms × price modifiers
    for (const head of topHeads) {
        for (const mod of PRICE_MODIFIERS) {
            expanded.add(`${head} ${mod}`);
            expanded.add(`best ${head} ${mod}`);
        }
    }
    
    // 3. Head terms × intent modifiers
    for (const head of topHeads) {
        for (const mod of INTENT_MODIFIERS) {
            if (mod === 'vs') continue; // Skip standalone 'vs'
            expanded.add(`${head} ${mod}`);
        }
    }
    
    // 4. Head terms × concern modifiers
    const concernTypes = CATEGORY_CONCERN_MAP[categoryId] || [];
    for (const type of concernTypes) {
        const concerns = CONCERN_MODIFIERS[type] || [];
        for (const head of topHeads.slice(0, 4)) {
            for (const concern of concerns) {
                expanded.add(`${head} ${concern}`);
            }
        }
    }
    
    // 5. Brand comparisons
    const comparisons = generateBrandComparisons(topBrands);
    comparisons.forEach(c => expanded.add(c));
    
    // 6. Brand × intent modifiers
    for (const brand of topBrands.slice(0, 6)) {
        expanded.add(`${brand} products`);
        expanded.add(`${brand} products for men`);
        expanded.add(`${brand} price list`);
        expanded.add(`${brand} combo offer`);
        expanded.add(`${brand} review`);
        expanded.add(`${brand} online`);
        expanded.add(`${brand} amazon`);
        expanded.add(`${brand} flipkart`);
        expanded.add(`is ${brand} good`);
        expanded.add(`${brand} side effects`);
    }
    
    // 7. "How to" patterns
    const howToPatterns = [
        'how to choose', 'how to apply', 'how to use',
        'how to remove', 'which is best', 'what is best',
        'difference between', 'benefits of', 'disadvantages of'
    ];
    for (const head of topHeads.slice(0, 3)) {
        for (const pattern of howToPatterns) {
            expanded.add(`${pattern} ${head}`);
        }
    }
    
    // 8. Seasonal/occasion modifiers
    const occasions = [
        'for summer', 'for winter', 'for rainy season',
        'for wedding', 'for office', 'for gym', 'for travel',
        'for daily use', 'for first time', 'for beginners'
    ];
    for (const head of topHeads.slice(0, 3)) {
        for (const occ of occasions) {
            expanded.add(`${head} ${occ}`);
        }
    }
    
    // 9. Location-specific (Indian cities)
    const cities = ['mumbai', 'delhi', 'bangalore', 'hyderabad', 'chennai', 'kolkata', 'pune'];
    for (const head of topHeads.slice(0, 2)) {
        for (const city of cities) {
            expanded.add(`${head} ${city}`);
            expanded.add(`best ${head} ${city}`);
        }
    }
    
    // 10. Year modifiers
    expanded.add(`best ${topHeads[0]} 2025`);
    expanded.add(`best ${topHeads[0]} 2024`);
    expanded.add(`top ${topHeads[0]} 2025`);

    // Filter: remove too short, too long
    const result = Array.from(expanded)
        .filter(k => k.length >= 3 && k.length <= 80)
        .map(k => k.toLowerCase().trim());
    
    return [...new Set(result)];
}

/**
 * Returns expanded keywords in batches suitable for DFS validation.
 * Each batch is max 700 keywords (DFS limit).
 */
export function getExpansionBatches(categoryId: string): string[][] {
    const all = expandKeywords(categoryId);
    const batches: string[][] = [];
    const BATCH_SIZE = 700;
    
    for (let i = 0; i < all.length; i += BATCH_SIZE) {
        batches.push(all.slice(i, i + BATCH_SIZE));
    }
    
    return batches;
}
