
import { HEAD_TERMS, BRAND_PACKS } from './categoryKeywordGuard';
import { normalizeKeywordString } from '../driftHash';

export const BootstrapServiceV3 = {
    
    /**
     * Generates high-intent candidates specific to the category.
     * Enforces inclusion of HEAD_TERMS or BRAND_PACKS.
     */
    generate(
        categoryId: string, 
        anchorName: string, 
        limit: number = 2000
    ): string[] {
        const candidates = new Set<string>();
        const heads = HEAD_TERMS[categoryId] || [];
        const brands = BRAND_PACKS[categoryId] || [];

        // Safety: If no knowledge base, fail fast
        if (heads.length === 0 && brands.length === 0) {
            console.warn(`[BOOTSTRAP_V3] No dictionary for ${categoryId}`);
            return [];
        }

        // --- TEMPLATES ---
        const templates = [
            (b: string, h: string) => `${b} ${h}`,             // "gillette razor"
            (b: string, h: string) => `${b} ${h} price`,       // "gillette razor price"
            (b: string, h: string) => `${b} ${h} for men`,     // "gillette razor for men"
            (b: string, h: string) => `best ${h} ${b}`,        // "best razor gillette"
            (b: string, h: string) => `${b} ${h} online`,      // "gillette razor online"
            (b: string, h: string) => `${b} ${h} review`,      // "gillette razor review"
            (b: string, h: string) => `${h} by ${b}`,          // "razor by gillette"
            (b: string, h: string) => `${b} new ${h}`,         // "gillette new razor"
            (b: string, h: string) => `${b} ${h} combo`,       // "gillette razor combo"
            (b: string, h: string) => `${b} ${h} kit`,         // "gillette razor kit"
        ];

        // Anchor-Specific Context
        const anchorToken = anchorName.toLowerCase().replace(/&/g, '').split(' ')[0]; // Simple token extraction
        
        // 1. Brand + Head Combinations (High Intent)
        // Limit depth to avoid explosion
        const topBrands = brands.slice(0, 25);
        const topHeads = heads.slice(0, 15);

        for (const brand of topBrands) {
            for (const head of topHeads) {
                // Apply templates
                templates.forEach(tpl => candidates.add(normalizeKeywordString(tpl(brand, head))));
                
                // Add Anchor Context if relevant
                if (anchorToken && anchorToken.length > 3) {
                     candidates.add(normalizeKeywordString(`${brand} ${head} ${anchorToken}`));
                }
            }
        }

        // 2. Generic Head Expansion (Mid Intent)
        // Only if we haven't hit limit
        if (candidates.size < limit) {
             for (const head of topHeads) {
                 candidates.add(normalizeKeywordString(`best ${head} in india`));
                 candidates.add(normalizeKeywordString(`${head} brands list`));
                 candidates.add(normalizeKeywordString(`${head} price list`));
                 candidates.add(normalizeKeywordString(`top 10 ${head}`));
                 
                 if (anchorToken) {
                     candidates.add(normalizeKeywordString(`${head} for ${anchorToken}`));
                 }
             }
        }

        // --- FILTERING ---
        const result = Array.from(candidates).filter(k => {
            if (!k || k.length < 5) return false;
            const tokens = k.split(' ');
            if (tokens.length < 2) return false;
            
            // Year Guard
            if (/\b(202[3-7])\b/.test(k)) return false;

            // PURE GENERIC GUARD
            // Must contain at least one head term or one brand
            const hasHead = heads.some(h => k.includes(h));
            const hasBrand = brands.some(b => k.includes(b));
            
            return hasHead || hasBrand;
        });

        // Deterministic Sort
        return result.sort().slice(0, limit);
    },

    /**
     * Generates high-quality SEED keywords for DFS discovery.
     * These are real search patterns, not brand×head combinations.
     * Used as input to DataForSeoClient.fetchKeywordsForKeywords().
     */
    generateDiscoverySeeds(categoryId: string): string[] {
        const heads = HEAD_TERMS[categoryId] || [];
        const brands = BRAND_PACKS[categoryId] || [];
        const seeds = new Set<string>();

        // A. Pure head terms (highest signal seeds)
        for (const head of heads) {
            seeds.add(head);
            seeds.add(`${head} for men`);
            seeds.add(`best ${head}`);
            seeds.add(`${head} india`);
        }

        // B. High-intent patterns
        const intentModifiers = [
            'price', 'review', 'vs', 'alternative', 'side effects',
            'how to use', 'benefits', 'for sensitive skin', 'natural',
            'affordable', 'premium', 'recommended', 'dermatologist'
        ];
        
        for (const head of heads.slice(0, 8)) {
            for (const mod of intentModifiers) {
                seeds.add(`${head} ${mod}`);
            }
        }

        // C. Top brand seeds (discovery anchor)
        for (const brand of brands.slice(0, 10)) {
            seeds.add(`${brand} ${heads[0] || categoryId}`);
            seeds.add(`${brand} products`);
        }

        // D. Problem/need patterns (high readiness signal)
        const categoryProblems: Record<string, string[]> = {
            'shaving': ['razor burn remedy', 'ingrown hair after shaving', 'how to shave without cuts', 'shaving rash treatment', 'smooth shave tips'],
            'beard': ['patchy beard growth', 'beard itch remedy', 'how to grow thick beard', 'beard dandruff treatment', 'grey beard dye'],
            'hair-styling': ['hair fall from gel', 'hairstyle for thin hair men', 'how to style hair without damage', 'hair wax vs gel', 'matte finish hair'],
            'sexual-wellness': ['premature ejaculation solution', 'condom size guide', 'sexual stamina tips', 'delay spray side effects', 'best lubricant'],
            'intimate-hygiene': ['jock itch treatment', 'groin sweat solution', 'intimate area darkening', 'anti chafing cream men', 'ball powder men'],
            'hair-colour': ['ammonia free hair colour men', 'grey hair coverage shampoo', 'how to colour hair at home men', 'semi permanent hair colour', 'natural hair dye'],
            'face-care': ['oily face control men', 'dark spots removal men', 'pimple treatment for men', 'sunscreen for men oily skin', 'face moisturizer men dry skin'],
            'deodorants': ['body odour solution', 'long lasting deo men', 'deodorant vs perfume', 'antiperspirant for heavy sweating', 'natural deodorant men'],
            'hair-oil': ['hair fall control oil', 'dandruff oil treatment', 'non sticky hair oil men', 'ayurvedic hair oil', 'onion oil for hair growth'],
            'fragrance-premium': ['long lasting perfume men', 'perfume vs eau de toilette', 'office wear fragrance men', 'date night perfume', 'budget luxury perfume india'],
            'skincare-spec': ['vitamin c serum for men', 'retinol for beginners', 'dark circle cream men', 'anti aging cream men 30s', 'niacinamide benefits for men'],
            'shampoo': ['anti dandruff shampoo men', 'shampoo for hair fall men', 'sulphate free shampoo', 'dry scalp treatment shampoo', 'shampoo for oily hair men'],
            'soap': ['body wash vs soap men', 'antibacterial soap men', 'moisturizing soap for men', 'charcoal soap benefits', 'soap for dry skin men'],
            'body-lotion': ['body lotion for men dry skin', 'non greasy body lotion', 'winter moisturizer men', 'body lotion vs cream', 'cocoa butter lotion men'],
            'talcum': ['prickly heat powder men', 'talc free body powder', 'cooling powder for summer', 'anti sweat powder men', 'talcum powder side effects'],
            'oral-care': ['teeth whitening at home', 'best electric toothbrush india', 'sensitive teeth toothpaste', 'mouthwash for bad breath', 'activated charcoal toothpaste']
        };

        const problems = categoryProblems[categoryId] || [];
        problems.forEach(p => seeds.add(p));

        return Array.from(seeds).filter(s => s.length >= 3).sort();
    }
};
