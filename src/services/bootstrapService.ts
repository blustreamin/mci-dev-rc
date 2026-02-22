
import { SnapshotKeywordRow } from '../types';
import { CategoryKeywordGuard, BRAND_PACKS, HEAD_TERMS } from './categoryKeywordGuard';

export type DemandClass = 'HEAD' | 'MID' | 'LONG';

async function computeSHA256(text: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// High-Intent Expansion Patterns
const HIGH_INTENT_PATTERNS = [
    (base: string) => `${base} for men`,
    (base: string) => `best ${base} for men`,
    (base: string) => `${base} men india`,
    (base: string) => `${base} price`,
    (base: string) => `${base} brands`,
    (base: string) => `top ${base}`,
    (base: string) => `${base} kit`,
    (base: string) => `buy ${base} online`,
    (base: string) => `${base} review`,
    (base: string) => `how to use ${base}`
];

export const BootstrapService = {
    getSeedsForAnchor(categoryId: string, anchorName: string): string[] {
        return [];
    },

    generateCandidates(categoryId: string, anchorName: string, existingSeeds: string[] = []): string[] {
        const candidates = new Set<string>();
        const brands = BRAND_PACKS[categoryId] || [];
        const heads = HEAD_TERMS[categoryId] || [];
        
        // 0. CRITICAL: Add raw head terms and brand names as direct seeds
        // These are the highest-volume keywords in every category
        heads.forEach(h => candidates.add(h.toLowerCase().trim()));
        brands.forEach(b => candidates.add(b.toLowerCase().trim()));

        // 1. Seed Usage (Pass-through)
        existingSeeds.forEach(seed => candidates.add(seed.toLowerCase().trim()));

        // Limit combinations to prevent explosion. 
        const topBrands = brands.slice(0, 20); // Increased depth
        const topHeads = heads.slice(0, 25);   // Increased depth

        // A. Brand Combinations
        topBrands.forEach(brand => {
            topHeads.forEach(head => {
                candidates.add(`${brand} ${head}`); // "gillette razor"
                candidates.add(`${brand} ${head} price`); // "gillette razor price"
                candidates.add(`${brand} ${head} review`); // "gillette razor review"
                candidates.add(`${brand} ${head} india`); // "gillette razor india"
            });
        });

        // B. Head Term Expansion (India Men Intent) - ENHANCED
        topHeads.forEach(head => {
            HIGH_INTENT_PATTERNS.forEach(pat => candidates.add(pat(head)));
            
            // Explicit male grooming context
            candidates.add(`${head} for sensitive skin men`);
            candidates.add(`${head} benefits for men`);
            candidates.add(`${head} grooming`);
        });

        // C. Anchor Specific Context
        // If anchorName is meaningful, use it as a modifier
        if (anchorName && !anchorName.includes('&') && anchorName.length < 25) {
            const anchorLower = anchorName.toLowerCase();
            HIGH_INTENT_PATTERNS.forEach(pat => candidates.add(pat(anchorLower)));
            
            // Cross-pollinate anchor with heads
            topHeads.slice(0, 5).forEach(head => {
                candidates.add(`${head} ${anchorLower}`);
            });
        }

        // 3. Filter & Guard (V3 Strict)
        const result = Array.from(candidates).filter(k => {
            const check = CategoryKeywordGuard.isSpecific(k, categoryId);
            return check.ok;
        });

        // 4. Sort Deterministically
        return result.sort(); 
    },

    inferIntent(keyword: string): string {
        const k = keyword.toLowerCase();
        if (k.includes('buy') || k.includes('price') || k.includes('offer') || k.includes('online') || k.includes('cost') || k.includes('amazon') || k.includes('shop')) return 'Decision';
        if (k.includes('best') || k.includes('review') || k.includes('vs') || k.includes('top') || k.includes('better') || k.includes('brand')) return 'Consideration';
        if (k.includes('burn') || k.includes('irritation') || k.includes('bump') || k.includes('fix') || k.includes('solution') || k.includes('problem') || k.includes('pain') || k.includes('acne')) return 'Problem';
        if (k.includes('how to') || k.includes('what is') || k.includes('guide') || k.includes('tips') || k.includes('routine') || k.includes('step')) return 'Discovery';
        return 'Discovery'; // Default
    },

    classifyAnchor(categoryId: string, anchorName: string, seeds: string[]): DemandClass {
        return seeds.length > 5 ? 'HEAD' : 'MID';
    },

    getTargets(dClass: DemandClass): { target: number; minVol: number } {
        return { target: 300, minVol: 10 };
    },

    async bootstrapFromSeeds(categoryId: string, anchorDisplayName: string, target: number, _append?: boolean): Promise<SnapshotKeywordRow[]> {
        const candidates = this.generateCandidates(categoryId, anchorDisplayName);
        const selected = candidates.slice(0, target); // Take top N
        
        const rows: SnapshotKeywordRow[] = [];
        const now = new Date().toISOString();

        for (const k of selected) {
            const id = await computeSHA256(`${k.toLowerCase().trim()}|en|${categoryId}|${anchorDisplayName}`);
            rows.push({
                keyword_id: id,
                created_at_iso: now,
                keyword_text: k.toLowerCase().trim(),
                language_code: 'en',
                country_code: 'IN',
                category_id: categoryId,
                anchor_id: anchorDisplayName,
                intent_bucket: this.inferIntent(k),
                status: 'UNVERIFIED',
                volume: 0,
                active: true
            });
        }
        return rows;
    }
};
