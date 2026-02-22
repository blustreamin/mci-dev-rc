#!/usr/bin/env python3
"""
Wire mega keyword injection into the expansion engine.
The expansion engine is called by the growth service during rebuild.
This replaces the existing expandKeywords function to use the mega generator.
"""
import shutil

# 1. Copy mega injection file
print("=== Step 1: Copy megaKeywordInjection.ts ===")
shutil.copy('megaKeywordInjection.ts', 'src/services/megaKeywordInjection.ts')
print("  OK")

# 2. Update expansion engine to use mega injection + curated seeds
print("\n=== Step 2: Update keywordExpansionEngine.ts ===")

engine_content = '''
import { getCuratedSeeds } from './curatedKeywordSeeds';
import { generateForCategory } from './megaKeywordInjection';

/**
 * KEYWORD EXPANSION ENGINE v2
 * Combines curated seeds + mega injection for 1500+ keywords per category.
 */
export function expandKeywords(categoryId: string): string[] {
    const curated = getCuratedSeeds(categoryId);
    const mega = generateForCategory(categoryId);
    
    const combined = new Set<string>();
    
    // Add all curated seeds first (highest quality)
    curated.forEach(k => combined.add(k.toLowerCase().trim()));
    
    // Add mega injection keywords
    mega.forEach(k => combined.add(k.toLowerCase().trim()));
    
    // Filter
    const result = Array.from(combined)
        .filter(k => k.length >= 4 && k.length <= 80);
    
    console.log(`[EXPAND] ${categoryId}: curated=${curated.length} mega=${mega.length} combined=${result.length}`);
    return result;
}

export function getExpansionBatches(categoryId: string): string[][] {
    const all = expandKeywords(categoryId);
    const batches: string[][] = [];
    const BATCH_SIZE = 700;
    
    for (let i = 0; i < all.length; i += BATCH_SIZE) {
        batches.push(all.slice(i, i + BATCH_SIZE));
    }
    
    return batches;
}
'''

with open('src/services/keywordExpansionEngine.ts', 'w') as f:
    f.write(engine_content)
print("  OK")

# 3. Verify growth service imports expansion engine
print("\n=== Step 3: Verify growth service wiring ===")
with open('src/services/categoryKeywordGrowthService.ts', 'r') as f:
    content = f.read()

if 'expandKeywords' in content:
    print("  OK: Growth service already imports expandKeywords")
else:
    print("  WARN: Growth service may need manual wiring")

print("\n=== DONE ===")
print("Commit and push, then Flush & Rebuild.")
print("Expected: ~1500 keywords sent to DFS per category, ~400-600 validated with volume.")
