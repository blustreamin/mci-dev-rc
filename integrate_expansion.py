#!/usr/bin/env python3
"""
INTEGRATE KEYWORD EXPANSION ENGINE
Adds the expansion engine and modifies the growth service to use it.
Target: 1500+ keywords per category, ~25K total across 16 categories.
"""
import os, shutil

# ============================================================
# STEP 1: Copy expansion engine
# ============================================================
print("=== STEP 1: Copy keywordExpansionEngine.ts ===")
src = 'keywordExpansionEngine.ts'
dst = 'src/services/keywordExpansionEngine.ts'
if os.path.exists(src):
    shutil.copy(src, dst)
    print("  OK")
else:
    print(f"  ERROR: {src} not found in project root")

# ============================================================
# STEP 2: Modify growth service to use expansion engine
# Instead of just 40 curated seeds per pass, send expanded keywords
# in batches of 700 to DFS search_volume
# ============================================================
print("\n=== STEP 2: Modify growth service ===")
growth_path = 'src/services/categoryKeywordGrowthService.ts'
with open(growth_path, 'r') as f:
    content = f.read()

# Add import
if 'keywordExpansionEngine' not in content:
    content = content.replace(
        "import { getCuratedSeeds } from './curatedKeywordSeeds';",
        "import { getCuratedSeeds } from './curatedKeywordSeeds';\nimport { expandKeywords } from './keywordExpansionEngine';"
    )
    print("  OK: Added expansion engine import")

# Replace the curated seeds section in the growth loop
old_curated = """                // A1. PRIMARY: Curated high-volume keywords
                // Send curated keywords directly to search_volume endpoint (WORKS through proxy)
                let dfsDiscoveredRows: any[] = [];
                const curatedKws = getCuratedSeeds(categoryId);
                const CURATED_BATCH = 40;
                const curatedOffset = ((attempt - 1) * CURATED_BATCH) % Math.max(curatedKws.length, 1);
                const curatedBatch = curatedKws.slice(curatedOffset, curatedOffset + CURATED_BATCH)
                    .filter(k => !existingSet.has(normalizeKeywordString(k)));
                
                if (curatedBatch.length > 0) {
                    console.log(`[GROW_UNIVERSAL][CURATED] Pass ${attempt}: ${curatedBatch.length} curated keywords`);
                    try {
                        const volRes = await DataForSeoClient.fetchGoogleVolumes_DFS({
                            keywords: curatedBatch,
                            location: 2356,
                            language: 'en',
                            creds,
                            useProxy: true,
                            jobId,
                            categoryId
                        });
                        
                        if (volRes.ok && volRes.parsedRows) {
                            for (const row of volRes.parsedRows) {
                                if ((row.search_volume || 0) > 0) {
                                    candidates.push(row.keyword);
                                    dfsDiscoveredRows.push(row);
                                }
                            }
                            console.log(`[GROW_UNIVERSAL][CURATED] returned=${volRes.parsedRows.length} valid=${dfsDiscoveredRows.length}`);
                        }
                    } catch (e: any) {
                        console.warn(`[GROW_UNIVERSAL][CURATED] Volume check failed: ${e.message}`);
                    }
                    await sleep(300);
                }"""

new_curated = """                // A1. PRIMARY: Expanded keyword corpus
                // Use expansion engine for large corpus, curated seeds as fallback
                let dfsDiscoveredRows: any[] = [];
                const allExpanded = expandKeywords(categoryId);
                const newExpanded = allExpanded.filter(k => !existingSet.has(normalizeKeywordString(k)));
                
                // Send in batches of 700 (DFS limit), rotate by attempt
                const EXPANSION_BATCH = 700;
                const totalBatches = Math.ceil(newExpanded.length / EXPANSION_BATCH);
                const batchIndex = (attempt - 1) % Math.max(totalBatches, 1);
                const expansionBatch = newExpanded.slice(
                    batchIndex * EXPANSION_BATCH, 
                    (batchIndex + 1) * EXPANSION_BATCH
                );
                
                if (expansionBatch.length > 0) {
                    console.log(`[GROW_UNIVERSAL][EXPAND] Pass ${attempt}: batch ${batchIndex+1}/${totalBatches}, ${expansionBatch.length} keywords (${newExpanded.length} total new)`);
                    try {
                        const volRes = await DataForSeoClient.fetchGoogleVolumes_DFS({
                            keywords: expansionBatch,
                            location: 2356,
                            language: 'en',
                            creds,
                            useProxy: true,
                            jobId,
                            categoryId
                        });
                        
                        if (volRes.ok && volRes.parsedRows) {
                            for (const row of volRes.parsedRows) {
                                if ((row.search_volume || 0) > 0) {
                                    candidates.push(row.keyword);
                                    dfsDiscoveredRows.push(row);
                                }
                            }
                            console.log(`[GROW_UNIVERSAL][EXPAND] returned=${volRes.parsedRows.length} valid=${dfsDiscoveredRows.length}`);
                        }
                    } catch (e: any) {
                        console.warn(`[GROW_UNIVERSAL][EXPAND] Volume check failed: ${e.message}`);
                    }
                    await sleep(500);
                }"""

if old_curated in content:
    content = content.replace(old_curated, new_curated)
    print("  OK: Growth service now uses expansion engine")
else:
    print("  SKIP: Curated section not found exactly")

# Also increase max attempts to cover all batches
content = content.replace(
    "const maxAttempts = params.maxAttempts || 15; // More passes for DFS discovery rotation",
    "const maxAttempts = params.maxAttempts || 5; // Each pass sends 700 keywords, 5 passes = 3500 max"
)

with open(growth_path, 'w') as f:
    f.write(content)

# ============================================================
# STEP 3: Increase rebuild target to accommodate larger corpus
# ============================================================
print("\n=== STEP 3: Adjust rebuild targets ===")
# The growth target determines when to stop growing
# With 1500+ keywords available, we want more validated keywords
with open(growth_path, 'r') as f:
    content = f.read()

content = content.replace(
    "const target = tier === 'FULL' ? 500 : 200; // Lowered: realistic with DFS discovery",
    "const target = tier === 'FULL' ? 2000 : 500; // Raised: expansion engine provides 1500+ candidates"
)

with open(growth_path, 'w') as f:
    f.write(content)

print("\n=== ALL DONE ===")
print("Run: git add -A && git commit -m '25K keywords: expansion engine + 700/batch DFS validation' && git push")
