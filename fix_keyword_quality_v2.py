#!/usr/bin/env python3
"""
DEFINITIVE KEYWORD QUALITY FIX v2

Core insight: DFS keywords_for_keywords ALREADY returns volumes.
We're throwing them away and re-validating, which returns different/zero values.

Fix: When DFS discovery returns keywords with volumes, mark them as VALID immediately.
"""
import os

def read_file(path):
    with open(path, 'r') as f:
        return f.read()

def write_file(path, content):
    with open(path, 'w') as f:
        f.write(content)

# ============================================================
# FIX 1: fetchKeywordsForKeywords should return keyword + volume
# Currently only returns keyword strings, discarding the volume data
# ============================================================
print("\n=== FIX 1: Return volumes from DFS discovery ===")
dfs_path = 'src/services/demand_vNext/dataforseoClient.ts'
content = read_file(dfs_path)

old = """    async fetchKeywordsForKeywords(params: {
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
    },"""

new = """    async fetchKeywordsForKeywords(params: {
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

    async discoverKeywordsWithVolume(params: {
        keywords: string[],
        location: number,
        language: string,
        creds: { login: string; password: string },
        jobId?: string
    }): Promise<DataForSeoRow[]> {
        const proxyUrl = await this.resolveDfsProxyEndpoint();
        const path = 'keywords_data/google_ads/keywords_for_keywords/live';
        
        const postData = [{
            keys: params.keywords,
            location_code: params.location,
            language_code: params.language
        }];

        const res = await this._execProxy(`/v3/${path}`, postData, params.creds, proxyUrl, params.jobId);
        if (res.ok && res.parsedRows) {
            return res.parsedRows.filter(r => (r.search_volume || 0) > 0);
        }
        return [];
    },"""

if old in content:
    content = content.replace(old, new)
    write_file(dfs_path, content)
    print("  OK: Added discoverKeywordsWithVolume method")
else:
    print("  SKIP: Method signature not found (may already be modified)")

# ============================================================
# FIX 2: Growth service - use discoverKeywordsWithVolume
# Mark discovered keywords as VALID immediately with their volumes
# instead of marking UNVERIFIED and re-validating
# ============================================================
print("\n=== FIX 2: Use DFS volumes directly in growth service ===")
growth_path = 'src/services/categoryKeywordGrowthService.ts'
content = read_file(growth_path)

# Find the DFS discovery section and replace it
old_discovery = """                // A1. PRIMARY: DFS Keywords-for-Keywords Discovery
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
                await sleep(300); // Rate limit between DFS calls"""

new_discovery = """                // A1. PRIMARY: DFS Keywords-for-Keywords Discovery WITH VOLUMES
                // DFS returns keywords with real volumes - use them directly
                let dfsDiscoveredRows: any[] = [];
                try {
                    const discoverySeeds = BootstrapServiceV3.generateDiscoverySeeds(categoryId);
                    const seedsPerBatch = 15;
                    const offset = ((attempt - 1) * seedsPerBatch) % discoverySeeds.length;
                    const seedBatch = discoverySeeds.slice(offset, offset + seedsPerBatch);
                    
                    if (seedBatch.length > 0) {
                        console.log(`[GROW_UNIVERSAL][DFS_DISCOVER] Pass ${attempt}: ${seedBatch.length} seeds -> DFS`);
                        const discoveredWithVol = await DataForSeoClient.discoverKeywordsWithVolume({
                            keywords: seedBatch,
                            location: 2356,
                            language: 'en',
                            creds,
                            jobId
                        });
                        
                        // Filter through guard and dedupe - these already have volume > 0
                        for (const dfsRow of discoveredWithVol) {
                            const kw = dfsRow.keyword;
                            const guard = CategoryKeywordGuard.isSpecific(kw, categoryId);
                            if (guard.ok && !existingSet.has(normalizeKeywordString(kw))) {
                                candidates.push(kw);
                                // Store volume data for direct use
                                dfsDiscoveredRows.push(dfsRow);
                            }
                        }
                        console.log(`[GROW_UNIVERSAL][DFS_DISCOVER] total=${discoveredWithVol.length} passedGuard=${dfsDiscoveredRows.length}`);
                    }
                } catch (e: any) {
                    console.warn(`[GROW_UNIVERSAL][DFS_DISCOVER] Failed: ${e.message}`);
                }
                await sleep(300);"""

if old_discovery in content:
    content = content.replace(old_discovery, new_discovery)
    print("  OK: Replaced discovery to use discoverKeywordsWithVolume")
else:
    print("  SKIP: Discovery section not found")

# Now fix the part where new rows are created - use DFS volumes directly
old_persist = """                // B. Persist Unverified
                const newRowObjs: SnapshotKeywordRow[] = [];
                for (const kw of candidates) {
                     const id = await computeSHA256(`${kw}|${categoryId}|univ`);
                     newRowObjs.push({
                        keyword_id: id,
                        keyword_text: kw,
                        language_code: 'en', country_code: 'IN', category_id: categoryId,
                        anchor_id: this.inferAnchor(kw, categoryId, snapshot.anchors),
                        intent_bucket: BootstrapService.inferIntent(kw),
                        status: 'UNVERIFIED',
                        active: true,
                        created_at_iso: new Date().toISOString(),
                        volume: null
                     });
                }"""

new_persist = """                // B. Persist - use DFS volumes directly for discovered keywords
                const dfsVolumeMap = new Map(dfsDiscoveredRows.map(r => [normalizeKeywordString(r.keyword), r]));
                const newRowObjs: SnapshotKeywordRow[] = [];
                for (const kw of candidates) {
                     const id = await computeSHA256(`${kw}|${categoryId}|univ`);
                     const dfsHit = dfsVolumeMap.get(normalizeKeywordString(kw));
                     newRowObjs.push({
                        keyword_id: id,
                        keyword_text: kw,
                        language_code: 'en', country_code: 'IN', category_id: categoryId,
                        anchor_id: this.inferAnchor(kw, categoryId, snapshot.anchors),
                        intent_bucket: BootstrapService.inferIntent(kw),
                        status: dfsHit ? 'VALID' : 'UNVERIFIED',
                        active: true,
                        created_at_iso: new Date().toISOString(),
                        volume: dfsHit?.search_volume || null,
                        cpc: dfsHit?.cpc || undefined,
                        competition: dfsHit?.competition_index || undefined
                     });
                }
                const preValidated = newRowObjs.filter(r => r.status === 'VALID').length;
                console.log(`[GROW_UNIVERSAL][PERSIST] ${newRowObjs.length} new rows, ${preValidated} pre-validated with DFS volume`);"""

if old_persist in content:
    content = content.replace(old_persist, new_persist)
    print("  OK: Replaced persist to use DFS volumes directly")
else:
    print("  SKIP: Persist section not found")

write_file(growth_path, content)

# ============================================================
# FIX 3: Mark rows with volume > 0 as VALID in the validation loop
# Currently rows stay UNVERIFIED even after getting volume data
# ============================================================
print("\n=== FIX 3: Properly mark validated rows ===")
content = read_file(growth_path)

old_validate = """                    batch.forEach(r => {
                        const hit = map.get(normalizeKeywordString(r.keyword_text));
                        if (hit) {
                            r.volume = hit.search_volume || 0;
                            r.cpc = hit.cpc;
                            r.competition = hit.competition_index;
                        }
                    });"""

new_validate = """                    batch.forEach(r => {
                        const hit = map.get(normalizeKeywordString(r.keyword_text));
                        if (hit) {
                            r.volume = hit.search_volume || 0;
                            r.cpc = hit.cpc;
                            r.competition = hit.competition_index;
                            // Mark as VALID if volume > 0, ZERO otherwise
                            r.status = (r.volume && r.volume > 0) ? 'VALID' : 'ZERO';
                        } else {
                            // DFS returned no data for this keyword
                            r.status = 'ZERO';
                            r.volume = 0;
                        }
                    });"""

if old_validate in content:
    content = content.replace(old_validate, new_validate)
    print("  OK: Validation now properly marks VALID/ZERO status")
else:
    print("  SKIP: Validation section not found")

write_file(growth_path, content)

# ============================================================
# FIX 4: Update computeStats to count VALID status correctly
# ============================================================
print("\n=== FIX 4: computeStats alignment ===")
content = read_file(growth_path)

old_stats = """    computeStats(rows: SnapshotKeywordRow[]) {
        let valid = 0, zero = 0, unverified = 0;
        rows.forEach(r => {
            if (r.status === 'UNVERIFIED' || r.volume === null) unverified++;
            else if (r.active && (r.volume || 0) > 0) valid++;
            else if (r.active && (r.amazonVolume || 0) > 0) valid++;
            else zero++;
        });
        return { valid, zero, unverified, total: rows.length };
    },"""

new_stats = """    computeStats(rows: SnapshotKeywordRow[]) {
        let valid = 0, zero = 0, unverified = 0;
        rows.forEach(r => {
            if (r.status === 'UNVERIFIED' || r.volume === null || r.volume === undefined) unverified++;
            else if (r.status === 'VALID' || (r.active && (r.volume || 0) > 0)) valid++;
            else if (r.active && (r.amazonVolume || 0) > 0) valid++;
            else zero++;
        });
        return { valid, zero, unverified, total: rows.length };
    },"""

if old_stats in content:
    content = content.replace(old_stats, new_stats)
    print("  OK: computeStats now recognizes VALID status")
else:
    print("  SKIP: computeStats not found")

write_file(growth_path, content)

# ============================================================
# FIX 5: Skip re-validation for already-VALID rows
# ============================================================
print("\n=== FIX 5: Skip re-validation for pre-validated rows ===")
content = read_file(growth_path)

old_revalidate = """                // C. Validate (Batched)
                const unverifiedRows = rows.filter(r => r.status === 'UNVERIFIED');"""

new_revalidate = """                // C. Validate (Batched) — skip rows already validated by DFS discovery
                const unverifiedRows = rows.filter(r => r.status === 'UNVERIFIED' && r.volume === null);"""

if old_revalidate in content:
    content = content.replace(old_revalidate, new_revalidate)
    print("  OK: Validation now skips pre-validated DFS rows")
else:
    print("  SKIP: Validation filter not found")

write_file(growth_path, content)

print("\n=== ALL FIXES APPLIED ===")
print("Run: git add -A && git commit -m 'DFS volumes preserved, skip re-validation' && git push")
