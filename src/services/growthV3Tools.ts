
import { normalizeKeywordString } from '../driftHash';
import { HEAD_TERMS, BRAND_PACKS } from './categoryKeywordGuard';

export const IndiaMenIntentFilters = {
    // Negative Filters: Exclude female/irrelevant/noise terms
    NEGATIVES: [
        // Gender exclusions
        'women', 'woman', 'female', 'ladies', 'girl', 'girls', 
        'pregnancy', 'maternity', 'bra', 'saree', 'lehenga', 
        'lipstick', 'makeup', 'foundation', 'concealer', 'blush', 'eyeliner', 'kajal', 'bindi', 'nail polish',
        'sanitary', 'period', 'menstrual', 'tampon', 'pad',
        'bridal', 'mehendi', 'makeover', 'for women', 'for girls',
        
        // Task 2: Low Intent / Blog Noise / Info-only
        'meaning', 'definition', 'pdf', 'research paper', 'history of', 'wiki', 
        'how to become', 'jobs', 'course', 'meme', 'aesthetic', 'trend', 
        'reddit', 'quora', 'essay', 'article', 'ppt', 'project', 'salary', 'career',
        'benefits of', 'disadvantages', 'side effects of'
    ],

    // Positive Signals: Male intent context
    POSITIVES: [
        'men', 'mens', 'male', 'boys', 'grooming', 'beard', 'moustache', 
        'shaving', 'razor', 'trimmer', 'aftershave', 'deodorant', 'body spray', 
        'perfume', 'hair gel', 'hair wax', 'pomade', 'beard oil', 'beard balm', 
        'face wash men', 'sunscreen men', 'intimate hygiene men', 'for men', "men's",
        'india', 'indian', 'in india'
    ],

    // Intent Heuristics (Task 3: Commercial Shapes)
    TRANSACTIONAL: [
        'best', 'price', 'buy', 'online', 'near me', 'review', 'top', 
        'brand', 'vs', 'comparison', 'kit', 'combo', 'price list', 'offer', 'cost', 'shop', 'store'
    ],
    
    // Core check function
    isIndiaMenIntent(keyword: string, categoryId: string): boolean {
        const norm = keyword.toLowerCase().trim();
        
        // Task 4: Max length 6 words
        const wordCount = norm.split(/\s+/).length;
        if (wordCount > 6) return false;

        // 1. Negative Filter (Hard Fail)
        if (this.NEGATIVES.some(n => norm.includes(n))) return false;

        // 2. Category Context Check
        const heads = HEAD_TERMS[categoryId] || [];
        const brands = BRAND_PACKS[categoryId] || [];
        
        const hasHead = heads.some(h => norm.includes(h.toLowerCase()));
        const hasBrand = brands.some(b => norm.includes(b.toLowerCase()));
        
        // Must relate to category via Head or Brand
        if (!hasHead && !hasBrand) return false;

        // 3. Strict Intent Check (Task 3)
        // Must have (Head OR Brand) AND (Transactional OR Explicit Male/India Context)
        const hasTransactional = this.TRANSACTIONAL.some(t => norm.includes(t));
        const hasExplicitContext = this.POSITIVES.some(p => norm.includes(p));

        if (hasTransactional || hasExplicitContext) {
            // Reject informational-only if no context
            if (norm.startsWith('what is') || norm.startsWith('why ') || norm.startsWith('how to make')) {
                 return false;
            }
            return true;
        }

        return false;
    },

    generateSeeds(categoryId: string, existingKeywords: string[]): string[] {
        const seeds = new Set<string>();
        const heads = HEAD_TERMS[categoryId] || [];
        const brands = BRAND_PACKS[categoryId] || [];
        
        // Task 6: Category-Specific India Men Seed Sets
        // Use strong head terms as anchors
        
        const suffixes = ['for men', 'for male', 'mens', 'price india', 'online india', 'best', 'review', 'kit india'];
        
        // 1. Head Templates
        heads.slice(0, 40).forEach(h => {
            suffixes.forEach(s => {
                if (s === 'best') seeds.add(`best ${h} india`);
                else if (s === 'review') seeds.add(`${h} review`);
                else seeds.add(`${h} ${s}`);
            });
            // Specific India Men patterns
            seeds.add(`${h} for men india`);
            seeds.add(`buy ${h} online`);
        });

        // 2. Brand Templates (Brand + Product)
        brands.slice(0, 15).forEach(b => {
             seeds.add(`${b} price india`);
             seeds.add(`${b} products online`);
             // Combine with top heads
             heads.slice(0, 3).forEach(h => {
                 seeds.add(`${b} ${h} price`);
             });
        });

        return Array.from(seeds);
    }
};
