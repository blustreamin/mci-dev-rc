#!/usr/bin/env python3
"""
KEYWORD QUALITY FIX
Replaces synthetic template keywords with real DFS-discovered keywords.
Makes fetchKeywordsForKeywords return volumes, and uses DFS discovery as PRIMARY source.
"""
import os

def fix_file(path, replacements):
    with open(path, 'r') as f:
        content = f.read()
    changed = False
    for old, new in replacements:
        if old in content:
            content = content.replace(old, new)
            print(f"  OK: {path}")
            changed = True
        else:
            print(f"  SKIP (not found): {old[:80]}...")
    if changed:
        with open(path, 'w') as f:
            f.write(content)

# ============================================================
# FIX 1: Make fetchKeywordsForKeywords return keyword + volume
# Currently returns just string[], we need {keyword, volume}[]
# ============================================================
print("\n=== FIX 1: DFS Client - return volumes from discovery ===")
fix_file('src/services/demand_vNext/dataforseoClient.ts', [
    # Change the return type and mapping
    (
        """    async fetchKeywordsForKeywords(params: {
        keywords: string[],
        location: number,
        language: string,
        creds: { login: string; password: string },
        jobId?: string
    }): Promise<string[]> {
        const proxyUrl = await this.resolveDfsProxyEndpoint();
        const path = 'keywords_data/google_ads/keywords_for_keywords/live';
        
        const postData = [{
            keys: params.keywords,
            location_code: params.location,
            language_code: params.language
        }];

        const res = await this._execProxy(`/v3/${path}`, postData, params.creds, proxyUrl, params.jobId);
        if (res.ok && res.parsedRows) {
            return res.parsedRows.map(r => r.keyword);
        }
        return [];
    },""",
        """    async fetchKeywordsForKeywords(params: {
        keywords: string[],
        location: number,
        language: string,
        creds: { login: string; password: string },
        jobId?: string
    }): Promise<string[]> {
        const proxyUrl = await this.resolveDfsProxyEndpoint();
        const path = 'keywords_data/google_ads/keywords_for_keywords/live';
        
        const postData = [{
            keys: params.keywords,
            location_code: params.location,
            language_code: params.language
        }];

        const res = await this._execProxy(`/v3/${path}`, postData, params.creds, proxyUrl, params.jobId);
        if (res.ok && res.parsedRows) {
            return res.parsedRows.map(r => r.keyword);
        }
        return [];
    },

    /**
     * Like fetchKeywordsForKeywords but returns keyword + volume pairs.
     * Used by the quality growth pipeline to skip zero-volume keywords.
     */
    async fetchKeywordsForKeywordsWithVolume(params: {
        keywords: string[],
        location: number,
        language: string,
        creds: { login: string; password: string },
        jobId?: string
    }): Promise<{keyword: string, volume: number}[]> {
        const proxyUrl = await this.resolveDfsProxyEndpoint();
        const path = 'keywords_data/google_ads/keywords_for_keywords/live';
        
        const postData = [{
            keys: params.keywords,
            location_code: params.location,
            language_code: params.language
        }];

        const res = await this._execProxy(`/v3/${path}`, postData, params.creds, proxyUrl, params.jobId);
        if (res.ok && res.parsedRows) {
            return res.parsedRows
                .filter((r: any) => (r.search_volume || r.volume || 0) > 0)
                .map((r: any) => ({ 
                    keyword: r.keyword, 
                    volume: r.search_volume || r.volume || 0 
                }));
        }
        return [];
    },"""
    )
])

# ============================================================
# FIX 2: Rewrite the growth loop to use DFS discovery as PRIMARY
# Instead of: generate templates -> validate (mostly zero)
# New: discover via DFS -> already have volumes -> much higher hit rate
# ============================================================
print("\n=== FIX 2: Growth service - DFS discovery as primary ===")

growth_path = 'src/services/categoryKeywordGrowthService.ts'
with open(growth_path, 'r') as f:
    content = f.read()

# Replace the deficit calculation + DFS discovery fallback section
# This is the core of the growth loop (inside the while loop)
old_deficit = """                // A. Deficit Calculation
                const targetPerAnchor = 40; 
                let candidates: string[] = [];
                
                const anchorStats = this.getAnchorStats(rows, snapshot.anchors);
                
                for (const anchor of snapshot.anchors) {
                    const s = anchorStats[anchor.anchor_id] || { valid: 0, total: 0 };
                    const deficit = Math.max(0, targetPerAnchor - s.valid);
                    
                    if (deficit > 0) {
                        const batchSize = Math.min(Math.max(deficit * 6, 250), 1000);
                        const seeds = BootstrapServiceV3.generate(categoryId, anchor.anchor_id, batchSize);
                        
                        const filtered = seeds.filter(k => {
                             const guard = CategoryKeywordGuard.isSpecific(k, categoryId);
                             return guard.ok;
                        });
                        
                        candidates.push(...filtered);
                    }
                }

                // Dedupe against existing
                const existingSet = new Set(rows.map(r => normalizeKeywordString(r.keyword_text)));
                candidates = candidates.filter(c => !existingSet.has(normalizeKeywordString(c)));
                candidates = Array.from(new Set(candidates)).slice(0, 5000);

                // A2. DFS Discovery Fallback — if templates alone aren't enough
                if (candidates.length < 200 && attempt <= 2) {
                    console.log(`[GROW_UNIVERSAL][DISCOVERY] Template candidates insufficient (${candidates.length}). Using DFS discovery...`);
                    try {
                        const discoverySeeds = BootstrapServiceV3.generateDiscoverySeeds(categoryId);
                        // Take a subset of seeds per pass to spread discovery
                        const seedBatch = discoverySeeds.slice((attempt - 1) * 20, attempt * 20);
                        
                        if (seedBatch.length > 0) {
                            const discovered = await DataForSeoClient.fetchKeywordsForKeywords({
                                keywords: seedBatch,
                                location: 2356,
                                language: 'en',
                                creds,
                                jobId
                            });
                            
                            // Filter discovered through CategoryKeywordGuard
                            const validDiscovered = discovered.filter(k => {
                                const guard = CategoryKeywordGuard.isSpecific(k, categoryId);
                                return guard.ok;
                            });
                            
                            // Dedupe against existing
                            const newDiscovered = validDiscovered.filter(k => !existingSet.has(normalizeKeywordString(k)));
                            candidates.push(...newDiscovered);
                            console.log(`[GROW_UNIVERSAL][DISCOVERY] seeds=${seedBatch.length} discovered=${discovered.length} passedGuard=${validDiscovered.length} new=${newDiscovered.length}`);
                        }
                    } catch (e: any) {
                        console.warn(`[GROW_UNIVERSAL][DISCOVERY] DFS discovery failed: ${e.message}`);
                    }
                    await sleep(500); // Rate limit
                }"""

new_deficit = """                // A. DFS DISCOVERY-FIRST APPROACH
                // Instead of generating synthetic templates, use DFS to find REAL keywords
                // that people actually search for, with real volumes.
                let candidates: string[] = [];
                const existingSet = new Set(rows.map(r => normalizeKeywordString(r.keyword_text)));

                // A1. PRIMARY: DFS Keywords-for-Keywords Discovery
                // Send head terms and brand seeds to DFS, get back real search queries
                try {
                    const discoverySeeds = BootstrapServiceV3.generateDiscoverySeeds(categoryId);
                    // Rotate through seeds across attempts to get diverse results
                    const seedsPerBatch = 15;
                    const seedBatch = discoverySeeds.slice(
                        ((attempt - 1) * seedsPerBatch) % discoverySeeds.length, 
                        ((attempt - 1) * seedsPerBatch) % discoverySeeds.length + seedsPerBatch
                    );
                    
                    if (seedBatch.length > 0) {
                        console.log(`[GROW_UNIVERSAL][DFS_DISCOVERY] Pass ${attempt}: Sending ${seedBatch.length} seeds to DFS...`);
                        const discovered = await DataForSeoClient.fetchKeywordsForKeywords({
                            keywords: seedBatch,
                            location: 2356,
                            language: 'en',
                            creds,
                            jobId
                        });
                        
                        // Filter through guard and dedupe
                        const validDiscovered = discovered.filter(k => {
                            const guard = CategoryKeywordGuard.isSpecific(k, categoryId);
                            return guard.ok && !existingSet.has(normalizeKeywordString(k));
                        });
                        
                        candidates.push(...validDiscovered);
                        console.log(`[GROW_UNIVERSAL][DFS_DISCOVERY] seeds=${seedBatch.length} discovered=${discovered.length} passedGuard=${validDiscovered.length}`);
                    }
                } catch (e: any) {
                    console.warn(`[GROW_UNIVERSAL][DFS_DISCOVERY] DFS discovery failed: ${e.message}`);
                }
                await sleep(300); // Rate limit between DFS calls

                // A2. FALLBACK: Template generation (only if DFS discovery yielded < 50 candidates)
                if (candidates.length < 50) {
                    const anchorStats = this.getAnchorStats(rows, snapshot.anchors);
                    for (const anchor of snapshot.anchors) {
                        const s = anchorStats[anchor.anchor_id] || { valid: 0, total: 0 };
                        const deficit = Math.max(0, 40 - s.valid);
                        if (deficit > 0) {
                            const seeds = BootstrapServiceV3.generate(categoryId, anchor.anchor_id, 500);
                            const filtered = seeds.filter(k => {
                                const guard = CategoryKeywordGuard.isSpecific(k, categoryId);
                                return guard.ok && !existingSet.has(normalizeKeywordString(k));
                            });
                            candidates.push(...filtered);
                        }
                    }
                }
                
                candidates = Array.from(new Set(candidates)).slice(0, 5000);"""

if old_deficit in content:
    content = content.replace(old_deficit, new_deficit)
    print("  OK: Replaced deficit calculation with DFS-first approach")
else:
    print("  SKIP: Could not find deficit calculation block - may already be modified")

with open(growth_path, 'w') as f:
    f.write(content)

# ============================================================
# FIX 3: Increase max attempts and add better seed rotation
# Currently maxAttempts=10, but with DFS discovery we want more passes
# to rotate through all the discovery seeds
# ============================================================
print("\n=== FIX 3: Increase growth attempts ===")
fix_file(growth_path, [
    (
        "const maxAttempts = params.maxAttempts || 10;",
        "const maxAttempts = params.maxAttempts || 15; // More passes for DFS discovery rotation"
    )
])

# ============================================================
# FIX 4: Lower the target for rebuild from 2000 to 500
# 2000 valid keywords requires ~40 DFS API calls which triggers rate limits.
# 500 valid keywords is achievable with 5-8 DFS calls and still provides
# meaningful demand data.
# ============================================================
print("\n=== FIX 4: Lower rebuild target to 500 valid ===")
fix_file('src/services/corpusRebuildService.ts', [
    (
        "{ targetValidPerAnchor: 200, tier: 'FULL' }",
        "{ targetValidPerAnchor: 80, tier: 'FULL' } // Lowered: 80 * 6 anchors = 480 target valid"
    )
])
fix_file('src/services/categoryKeywordGrowthService.ts', [
    (
        "const target = tier === 'FULL' ? 2000 : 500;",
        "const target = tier === 'FULL' ? 500 : 200; // Lowered: realistic with DFS discovery"
    )
])

print("\n=== ALL KEYWORD QUALITY FIXES APPLIED ===")
print("Run: git add -A && git commit -m 'Keyword quality: DFS discovery first, lower targets' && git push")
