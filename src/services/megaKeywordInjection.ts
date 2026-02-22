/**
 * MEGA KEYWORD INJECTION - 1000+ keywords per category
 * 
 * All keywords are designed to PASS the CategoryKeywordGuard:
 * - Each contains a HEAD_TERM or BRAND from the guard
 * - Real Indian search patterns
 * - Sent to DFS search_volume for validation
 */

import { HEAD_TERMS, BRAND_PACKS } from './categoryKeywordGuard';

// Price points Indians actually search
const PRICES = ['under 100', 'under 200', 'under 300', 'under 500', 'under 1000', 'under 1500', 'under 2000', 'under 3000', 'under 5000'];

// Intent modifiers
const BUY_MODS = ['price', 'price in india', 'buy online', 'amazon', 'flipkart', 'online', 'review', 'reviews', 'combo', 'combo offer', 'pack', 'kit', 'set', 'gift set', 'price list'];
const BEST_MODS = ['best', 'top 10', 'top 5', 'top', 'latest', 'new'];
const COMPARE_MODS = ['vs', 'or', 'comparison', 'alternative'];
const CONCERN_MODS: Record<string, string[]> = {
    'skin': ['for oily skin', 'for dry skin', 'for sensitive skin', 'for acne', 'for pimples', 'for dark spots', 'for tan removal', 'for pigmentation', 'for dark circles', 'for glowing skin', 'for fair skin', 'for combination skin', 'for normal skin', 'for acne prone skin', 'for blackheads', 'for open pores', 'for men oily skin'],
    'hair': ['for hair fall', 'for hair growth', 'for dandruff', 'for dry hair', 'for oily hair', 'for thin hair', 'for thick hair', 'for curly hair', 'for colored hair', 'for grey hair', 'for frizzy hair', 'for damaged hair', 'for dry scalp', 'for itchy scalp'],
    'body': ['for body odour', 'for sweating', 'for dry skin', 'for summer', 'for winter', 'for gym', 'for daily use', 'for office', 'long lasting', 'all day', 'for sensitive skin', 'for men'],
    'grooming': ['for beginners', 'at home', 'tips', 'routine', 'for sensitive skin', 'without irritation', 'daily', 'for men'],
    'oral': ['for bad breath', 'for sensitive teeth', 'for yellow teeth', 'for gum bleeding', 'for whitening', 'for cavity', 'for kids', 'for braces', 'for smokers']
};

const CATEGORY_CONCERNS: Record<string, string[]> = {
    'shaving': ['grooming', 'skin'],
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
    'oral-care': ['oral']
};

// City modifiers (real searches happen with city names)
const CITIES = ['mumbai', 'delhi', 'bangalore', 'hyderabad', 'chennai', 'kolkata', 'pune', 'ahmedabad', 'jaipur', 'lucknow'];

// How-to patterns
const HOWTO = ['how to use', 'how to apply', 'how to choose', 'benefits of', 'side effects of', 'is safe', 'advantages of', 'disadvantages of'];

// Occasions
const OCCASIONS = ['for wedding', 'for office', 'for gym', 'for travel', 'for daily use', 'for summer', 'for winter', 'for date', 'for interview', 'for college'];

function generateForCategory(categoryId: string): string[] {
    const heads = HEAD_TERMS[categoryId] || [];
    const brands = BRAND_PACKS[categoryId] || [];
    const kws = new Set<string>();
    
    // Limit to top heads/brands for reasonable combinations
    const topHeads = heads.slice(0, 8);
    const topBrands = brands.slice(0, 14);
    
    // 1. HEAD × PRICE (8 heads × 9 prices = 72)
    for (const h of topHeads) {
        for (const p of PRICES) {
            kws.add(`${h} ${p}`);
            kws.add(`best ${h} ${p}`);
        }
    }
    
    // 2. HEAD × BUY_MODS (8 × 15 = 120)
    for (const h of topHeads) {
        for (const m of BUY_MODS) {
            kws.add(`${h} ${m}`);
        }
    }
    
    // 3. HEAD × BEST_MODS (8 × 6 = 48)
    for (const h of topHeads) {
        for (const m of BEST_MODS) {
            kws.add(`${m} ${h}`);
            kws.add(`${m} ${h} for men`);
            kws.add(`${m} ${h} india`);
        }
    }
    
    // 4. BRAND × HEAD (14 × 8 = 112)
    for (const b of topBrands) {
        for (const h of topHeads.slice(0, 6)) {
            kws.add(`${b} ${h}`);
            kws.add(`${b} ${h} price`);
            kws.add(`${b} ${h} review`);
            kws.add(`${b} ${h} for men`);
            kws.add(`${b} ${h} online`);
        }
    }
    
    // 5. BRAND × BUY_MODS (14 × 10 = 140)
    for (const b of topBrands) {
        for (const m of ['price', 'price in india', 'review', 'online', 'amazon', 'flipkart', 'combo', 'products', 'range', 'new']) {
            kws.add(`${b} ${m}`);
        }
    }
    
    // 6. BRAND × BRAND (comparisons) (14C2 ÷ ~50)
    for (let i = 0; i < Math.min(topBrands.length, 10); i++) {
        for (let j = i+1; j < Math.min(topBrands.length, 10); j++) {
            kws.add(`${topBrands[i]} vs ${topBrands[j]}`);
        }
    }
    
    // 7. HEAD × CONCERN_MODS
    const concernTypes = CATEGORY_CONCERNS[categoryId] || [];
    for (const type of concernTypes) {
        const concerns = CONCERN_MODS[type] || [];
        for (const h of topHeads.slice(0, 5)) {
            for (const c of concerns) {
                kws.add(`${h} ${c}`);
            }
        }
    }
    
    // 8. HEAD × HOWTO (8 × 8 = 64)
    for (const h of topHeads.slice(0, 4)) {
        for (const ht of HOWTO) {
            kws.add(`${ht} ${h}`);
        }
    }
    
    // 9. HEAD × OCCASIONS (8 × 10 = 80)
    for (const h of topHeads.slice(0, 4)) {
        for (const occ of OCCASIONS) {
            kws.add(`${h} ${occ}`);
        }
    }
    
    // 10. BRAND standalone + modifiers (14 × 5 = 70)
    for (const b of topBrands) {
        kws.add(`${b} for men`);
        kws.add(`${b} products`);
        kws.add(`${b} products for men`);
        kws.add(`is ${b} good`);
        kws.add(`${b} side effects`);
    }
    
    // 11. HEAD × CITIES (for local intent) (4 × 10 = 40)
    for (const h of topHeads.slice(0, 4)) {
        for (const city of CITIES) {
            kws.add(`${h} ${city}`);
        }
    }
    
    // 12. Specific high-volume patterns per category
    const specificKws = getSpecificKeywords(categoryId);
    specificKws.forEach(k => kws.add(k));
    
    // Filter: valid length, lowercase, trimmed, dedupe
    const result = Array.from(kws)
        .map(k => k.toLowerCase().trim())
        .filter(k => k.length >= 4 && k.length <= 80);
    
    return [...new Set(result)];
}

function getSpecificKeywords(categoryId: string): string[] {
    const extras: Record<string, string[]> = {
        'deodorants': [
            'deo for men', 'body spray for men', 'roll on for men', 'antiperspirant for men',
            'deodorant for heavy sweating', 'no gas deodorant', 'pocket perfume for men',
            'deo combo pack', 'body spray under 200', 'long lasting body spray',
            'deodorant gift set for men', 'aluminium free deodorant india',
            'natural deodorant for men', 'deodorant for gym', 'fresh smelling deo',
            'body spray combo offer', 'deo pack of 3', 'travel size deodorant',
            'sweat proof deodorant men', 'best smelling body spray india',
            'deo for body odour', 'strongest deodorant for men', 'deo stick for men',
            'roll on vs spray deodorant', 'deodorant vs perfume difference'
        ],
        'face-care': [
            'face wash for oily skin men', 'face wash for pimples men', 'face wash for dark spots men',
            'moisturizer for oily skin men', 'sunscreen for oily skin men', 'sunscreen spf 50 for men',
            'vitamin c serum for men', 'niacinamide serum for men', 'retinol for men',
            'salicylic acid face wash for men', 'charcoal face wash for men',
            'face cream for glowing skin men', 'anti aging cream for men india',
            'dark circle cream for men', 'under eye cream for men',
            'face toner for men', 'face primer for men', 'bb cream for men',
            'lip balm for men', 'face scrub for men india', 'pimple patch for men',
            'acne treatment cream men', 'face mask for men india',
            'skincare routine for men india', 'skincare for beginners men'
        ],
        'shampoo': [
            'anti dandruff shampoo for men', 'hair fall shampoo for men',
            'shampoo for oily scalp men', 'shampoo for dry scalp men',
            'sulfate free shampoo india', 'paraben free shampoo india',
            'ketoconazole shampoo for men', 'biotin shampoo for men',
            'onion shampoo for hair fall', 'charcoal shampoo for men',
            'shampoo and conditioner combo men', '2 in 1 shampoo conditioner men',
            'dry shampoo for men', 'scalp scrub for men', 'hair mask for men',
            'deep conditioning treatment men', 'color protect shampoo men',
            'beer shampoo for men', 'herbal shampoo for men india'
        ],
        'soap': [
            'body wash for men india', 'shower gel for men india', 'soap for men india',
            'antibacterial soap for men', 'charcoal soap for men', 'body wash for dry skin men',
            'body wash for oily skin men', 'exfoliating body wash men',
            'soap for body acne men', 'soap for back acne men',
            'moisturizing body wash men', 'body wash under 200',
            'shower gel vs soap difference', 'liquid soap vs bar soap benefits',
            'best smelling body wash men', 'body wash for gym',
            'neem soap for men', 'glycerin soap for men'
        ],
        'shaving': [
            'trimmer for face men', 'body groomer for men india', 'nose trimmer men',
            'ear and nose trimmer', 'manscaping trimmer india', 'back hair trimmer',
            'pubic hair trimmer men', 'zero trim body groomer',
            'how to shave without bumps', 'shaving tips for sensitive skin',
            'best pre shave oil india', 'razor vs trimmer which is better',
            'gillette guard vs mach3', 'philips oneblade review india',
            'electric shaver vs trimmer', 'safety razor blades india',
            'shaving cream vs foam difference', 'how to prevent ingrown hairs men'
        ],
        'hair-oil': [
            'onion hair oil for growth', 'rosemary oil for hair growth india',
            'castor oil for hair growth men', 'coconut oil for hair fall men',
            'bhringraj oil for hair growth', 'ayurvedic hair oil for men',
            'non sticky hair oil for men india', 'lightweight hair oil men',
            'hair oil for dandruff control', 'hair oil for dry scalp men',
            'overnight hair oil treatment men', 'hot oil treatment for hair men',
            'derma roller with minoxidil', 'finasteride for hair loss india',
            'prp treatment for hair cost india', 'biotin tablets for hair growth india'
        ],
        'fragrance-premium': [
            'long lasting perfume for men india', 'perfume gift set for men india',
            'best perfume under 500 for men', 'best perfume under 1000 for men',
            'best perfume under 2000 for men', 'best edp for men india',
            'office wear perfume for men', 'date night perfume for men',
            'summer perfume for men india', 'winter perfume for men india',
            'clone perfume india', 'niche perfume india',
            'arabian perfume for men india', 'attar for men india',
            'how to make perfume last longer', 'perfume notes explained'
        ],
        'skincare-spec': [
            'best vitamin c serum india', 'best niacinamide serum india',
            'best retinol serum india', 'best hyaluronic acid serum india',
            'best salicylic acid serum india', 'alpha arbutin serum for men',
            'aha bha serum for men', 'glycolic acid serum india',
            'peptide serum india', 'serum for oily skin men',
            'serum for acne men', 'serum for glowing skin men',
            'morning skincare routine men', 'night skincare routine men',
            'korean skincare routine men', 'minimalist vs derma co review',
            'niacinamide vs vitamin c which first', 'retinol side effects india'
        ],
        'sexual-wellness': [
            'condom variety pack india', 'best condom brand india',
            'condom size chart india', 'best thin condom india',
            'best dotted condom india', 'best delay condom india',
            'lubricant gel for men', 'water based lubricant india',
            'delay spray for men india', 'stamina tablets for men india',
            'shilajit capsule for men', 'ashwagandha for men india',
            'testosterone booster india', 'how to last longer in bed',
            'premature ejaculation treatment india'
        ],
        'intimate-hygiene': [
            'intimate wash for men india', 'intimate hygiene wash for men',
            'anti chafing cream for men india', 'anti fungal cream for men india',
            'jock itch treatment india', 'jock itch cream india',
            'groin sweat solution men', 'dark inner thighs treatment men',
            'fungal infection cream for men', 'itching in private area male treatment',
            'intimate area whitening cream men', 'ph balanced intimate wash men',
            'ball powder for men india', 'anti chafing powder for men'
        ],
        'hair-colour': [
            'hair colour for grey hair men', 'ammonia free hair colour india',
            'natural hair dye for men india', 'henna for grey hair men',
            'best beard colour for men india', 'semi permanent hair colour men',
            'temporary hair colour for men', 'hair colour shampoo for men india',
            'instant grey coverage men', 'herbal hair colour india men',
            'how to colour hair at home men', 'hair colour side effects men',
            'indigo hair dye for grey hair men'
        ],
        'body-lotion': [
            'body lotion for dry skin men winter', 'body lotion for summer men',
            'non greasy body lotion for men india', 'body lotion with spf for men',
            'moisturizer for rough skin men', 'cocoa butter body lotion men',
            'aloe vera body lotion for men', 'vitamin e body lotion men',
            'after shower body lotion men', 'winter skin care for men india',
            'best body lotion under 200 men', 'body cream vs body lotion difference'
        ],
        'talcum': [
            'prickly heat powder for men india', 'best cooling powder for men summer',
            'body powder for gym men', 'anti fungal body powder men',
            'talc free body powder india', 'sweat absorbing powder for men',
            'powder for underarms men', 'antifungal foot powder india',
            'menthol body powder for summer', 'is talcum powder safe for men',
            'talc vs cornstarch powder body'
        ],
        'oral-care': [
            'best toothpaste for sensitive teeth india', 'best whitening toothpaste india',
            'electric toothbrush price india', 'oral b electric toothbrush india',
            'best mouthwash for bad breath india', 'activated charcoal toothpaste india',
            'teeth whitening kit india', 'teeth whitening strips india',
            'water flosser price india', 'tongue cleaner india',
            'gum disease treatment india', 'bleeding gums toothpaste india',
            'toothpaste for smokers india', 'ayurvedic toothpaste india',
            'oil pulling benefits teeth'
        ],
        'beard': [
            'beard growth oil for patchy beard', 'minoxidil for beard growth india',
            'derma roller for beard growth india', 'beard growth tips naturally',
            'biotin for beard growth india', 'beard styles for round face men',
            'how to grow beard faster naturally india', 'patchy beard solution india',
            'beard dandruff treatment india', 'grey beard dye for men india',
            'beard straightener for men india', 'beard transplant cost india',
            'coconut oil for beard growth', 'castor oil for beard growth'
        ]
    };
    return extras[categoryId] || [];
}

export { generateForCategory };
