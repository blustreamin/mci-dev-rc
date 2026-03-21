/**
 * ProjectCorpusBuilder — Hydrates a project's keyword corpus with real DFS volumes
 * 
 * Flow:
 * 1. Takes AI-generated category keywords from ProjectDefinition
 * 2. Batches them into DFS search_volume/live calls
 * 3. Optionally discovers related keywords via keywords_for_keywords/live
 * 4. Converts results to SnapshotKeywordRow[] format
 * 5. Saves to PlatformDB corpus store
 * 
 * This is the bridge between ScopeDefinitionV2 (AI generation) and CorpusInspector (real data).
 */

import { ProjectDefinition, AiGeneratedCategory } from '../config/projectContext';
import { DataForSeoClient, DataForSeoRow } from './demand_vNext/dataforseoClient';
import { CredsStore } from './demand_vNext/credsStore';
import { PlatformDB } from './platformDB';
import { SnapshotKeywordRow } from '../types';

// --- CONFIG ---
const DFS_BATCH_SIZE = 50;          // DFS accepts up to ~700 keywords per call, but 50 is safer for latency
const DISCOVERY_SEED_COUNT = 10;    // Number of seed keywords for expansion
const DISCOVERY_MAX_NEW = 100;      // Cap on discovered keywords to add
const MIN_VOLUME_THRESHOLD = 0;     // Include zero-volume rows (mark them as ZERO status)

export type CorpusBuildPhase = 'IDLE' | 'RESOLVING_CREDS' | 'FETCHING_SEED_VOLUMES' | 'DISCOVERING_KEYWORDS' | 'FETCHING_DISCOVERY_VOLUMES' | 'BUILDING_ROWS' | 'SAVING' | 'DONE' | 'FAILED';

export interface CorpusBuildProgress {
    phase: CorpusBuildPhase;
    message: string;
    totalKeywords: number;
    processedKeywords: number;
    validKeywords: number;
    zeroKeywords: number;
    errorKeywords: number;
    discoveredKeywords: number;
    elapsedMs: number;
}

export interface CorpusBuildResult {
    ok: boolean;
    categoryId: string;
    totalRows: number;
    validRows: number;
    zeroRows: number;
    discoveredCount: number;
    elapsedMs: number;
    error?: string;
}

type ProgressCallback = (progress: CorpusBuildProgress) => void;

// --- HELPERS ---

function slugifyKeywordId(keyword: string, categoryId: string): string {
    const clean = keyword.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '_').substring(0, 60);
    return `${categoryId}__${clean}`;
}

function assignAnchor(keyword: string, category: AiGeneratedCategory, index?: number): string {
    const subs = category.subCategories || [];
    if (subs.length === 0) return 'general';
    
    // Try keyword-based matching first
    const kwLower = keyword.toLowerCase();
    for (const sub of subs) {
        const subNameLower = sub.name.toLowerCase();
        // Check if any word in sub-category name appears in keyword
        const subWords = subNameLower.split(/\s+/).filter(w => w.length > 3);
        for (const word of subWords) {
            if (kwLower.includes(word)) {
                return subNameLower.replace(/[^a-z0-9]+/g, '_').substring(0, 30);
            }
        }
    }
    
    // Round-robin fallback using index
    const idx = index ?? Math.floor(Math.random() * subs.length);
    const sub = subs[idx % subs.length];
    return sub.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').substring(0, 30);
}

function classifyIntent(keyword: string): string {
    const kw = keyword.toLowerCase();
    if (/\b(buy|price|cost|cheap|affordable|deal|offer|discount|coupon|shop|order|where to buy|near me|online|delivery|rate|rs|rupees|amazon|flipkart|bigbasket|blinkit|swiggy|zepto)\b/.test(kw)) return 'TRANSACTIONAL';
    if (/\b(best|top|vs|versus|compare|comparison|review|rating|recommend|which|better|worth)\b/.test(kw)) return 'COMMERCIAL';
    if (/\b(how|what|why|when|guide|tutorial|tips|does|can|should|is it|benefits|difference|calories|nutrition|protein|healthy|good for|bad for|side effect|making|recipe|homemade)\b/.test(kw)) return 'INFORMATIONAL';
    return 'NAVIGATIONAL';
}

function dfsRowToSnapshotRow(
    dfsRow: DataForSeoRow,
    categoryId: string,
    category: AiGeneratedCategory,
    countryCode: string,
    language: string,
    source: 'SEED' | 'DISCOVERED',
    index: number = 0
): SnapshotKeywordRow {
    const volume = dfsRow.search_volume ?? null;
    const isZero = volume === null || volume === 0;

    return {
        keyword_id: slugifyKeywordId(dfsRow.keyword, categoryId),
        keyword_text: dfsRow.keyword,
        volume: volume,
        cpc: dfsRow.cpc ?? undefined,
        competition: dfsRow.competition_index ?? dfsRow.competition ?? undefined,
        anchor_id: assignAnchor(dfsRow.keyword, category, index),
        intent_bucket: classifyIntent(dfsRow.keyword),
        status: isZero ? 'ZERO' : 'VALID',
        active: !isZero, // Zero-volume keywords are inactive by default
        language_code: language,
        country_code: countryCode,
        category_id: categoryId,
        created_at_iso: new Date().toISOString(),
        validated_at_iso: new Date().toISOString(),
        validation_tier: source === 'SEED' ? 'AI_GENERATED' : 'DFS_DISCOVERED',
    };
}

// --- MAIN SERVICE ---

export const ProjectCorpusBuilder = {

    /**
     * Build a full keyword corpus for a project.
     * 
     * @param project - The ProjectDefinition from ScopeDefinitionV2
     * @param options - Configuration overrides
     * @param onProgress - Callback for UI progress updates
     * @returns CorpusBuildResult
     */
    async buildCorpus(
        project: ProjectDefinition,
        options: {
            skipDiscovery?: boolean;     // Skip keyword expansion (faster, fewer API calls)
            forceRebuild?: boolean;      // Ignore existing corpus
            jobId?: string;
        } = {},
        onProgress?: ProgressCallback
    ): Promise<CorpusBuildResult> {
        const startTime = Date.now();
        const gen = project.generatedCategory;

        if (!gen) {
            return { ok: false, categoryId: '', totalRows: 0, validRows: 0, zeroRows: 0, discoveredCount: 0, elapsedMs: 0, error: 'No generated category in project' };
        }

        const categoryId = gen.id;
        const countryCode = project.geo.country;
        const language = project.geo.language;
        const locationCode = project.geo.locationCode;

        const progress: CorpusBuildProgress = {
            phase: 'IDLE',
            message: 'Starting corpus build...',
            totalKeywords: gen.defaultKeywords.length,
            processedKeywords: 0,
            validKeywords: 0,
            zeroKeywords: 0,
            errorKeywords: 0,
            discoveredKeywords: 0,
            elapsedMs: 0,
        };

        const emit = (phase: CorpusBuildPhase, message: string, updates?: Partial<CorpusBuildProgress>) => {
            progress.phase = phase;
            progress.message = message;
            progress.elapsedMs = Date.now() - startTime;
            if (updates) Object.assign(progress, updates);
            onProgress?.({ ...progress });
            console.log(`[CorpusBuilder][${phase}] ${message}`);
        };

        try {
            // --- 1. CHECK EXISTING CORPUS ---
            if (!options.forceRebuild) {
                const existing = await PlatformDB.getCorpus(categoryId);
                if (existing && existing.rowCount > 0) {
                    emit('DONE', `Corpus already exists: ${existing.rowCount} rows. Use forceRebuild to overwrite.`);
                    return { ok: true, categoryId, totalRows: existing.rowCount, validRows: 0, zeroRows: 0, discoveredCount: 0, elapsedMs: Date.now() - startTime };
                }
            }

            // --- 2. RESOLVE DFS CREDENTIALS ---
            emit('RESOLVING_CREDS', 'Resolving DataForSEO credentials...');
            const creds = await CredsStore.get();
            if (!creds || !creds.login || !creds.password) {
                emit('FAILED', 'DataForSEO credentials not configured. Go to Settings → DFS Credentials.');
                return { ok: false, categoryId, totalRows: 0, validRows: 0, zeroRows: 0, discoveredCount: 0, elapsedMs: Date.now() - startTime, error: 'DFS_CREDS_MISSING' };
            }

            const dfsAuth = { login: creds.login, password: creds.password };

            // --- 3. FETCH VOLUMES FOR AI-GENERATED SEED KEYWORDS ---
            emit('FETCHING_SEED_VOLUMES', `Fetching volumes for ${gen.defaultKeywords.length} seed keywords...`);

            const allDfsRows: DataForSeoRow[] = [];
            const seedKeywords = [...gen.defaultKeywords];

            // Batch the keywords
            for (let i = 0; i < seedKeywords.length; i += DFS_BATCH_SIZE) {
                const batch = seedKeywords.slice(i, i + DFS_BATCH_SIZE);
                const batchNum = Math.floor(i / DFS_BATCH_SIZE) + 1;
                const totalBatches = Math.ceil(seedKeywords.length / DFS_BATCH_SIZE);

                emit('FETCHING_SEED_VOLUMES', `Batch ${batchNum}/${totalBatches}: ${batch.length} keywords...`, {
                    processedKeywords: i,
                });

                const result = await DataForSeoClient.fetchGoogleVolumes_DFS({
                    keywords: batch,
                    location: locationCode,
                    language: language,
                    creds: dfsAuth,
                    categoryId,
                    jobId: options.jobId,
                });

                if (result.ok && result.parsedRows) {
                    allDfsRows.push(...result.parsedRows);
                } else {
                    console.warn(`[CorpusBuilder] Batch ${batchNum} failed: ${result.error}`);
                    // Continue with remaining batches — partial data is better than none
                    progress.errorKeywords += batch.length;
                }

                // Small delay between batches to respect rate limits
                if (i + DFS_BATCH_SIZE < seedKeywords.length) {
                    await new Promise(r => setTimeout(r, 300));
                }
            }

            emit('FETCHING_SEED_VOLUMES', `Seed volumes fetched: ${allDfsRows.length} rows from ${seedKeywords.length} keywords`, {
                processedKeywords: seedKeywords.length,
            });

            // --- 4. OPTIONAL: DISCOVER RELATED KEYWORDS ---
            let discoveredRows: DataForSeoRow[] = [];

            if (!options.skipDiscovery && allDfsRows.length > 0) {
                emit('DISCOVERING_KEYWORDS', 'Discovering related keywords...');

                // Pick top-volume seeds for expansion
                const sortedSeeds = [...allDfsRows]
                    .filter(r => (r.search_volume || 0) > 0)
                    .sort((a, b) => (b.search_volume || 0) - (a.search_volume || 0))
                    .slice(0, DISCOVERY_SEED_COUNT)
                    .map(r => r.keyword);

                if (sortedSeeds.length >= 3) {
                    try {
                        const discovered = await DataForSeoClient.discoverKeywordsWithVolume({
                            keywords: sortedSeeds,
                            location: locationCode,
                            language: language,
                            creds: dfsAuth,
                            jobId: options.jobId,
                        });

                        // Deduplicate against existing seeds
                        const existingKeywords = new Set(allDfsRows.map(r => r.keyword.toLowerCase()));
                        discoveredRows = discovered
                            .filter(r => !existingKeywords.has(r.keyword.toLowerCase()))
                            .slice(0, DISCOVERY_MAX_NEW);

                        emit('DISCOVERING_KEYWORDS', `Discovered ${discoveredRows.length} new keywords`, {
                            discoveredKeywords: discoveredRows.length,
                        });
                    } catch (e: any) {
                        console.warn(`[CorpusBuilder] Keyword discovery failed: ${e.message}`);
                        // Non-fatal — continue with seed keywords only
                    }
                } else {
                    emit('DISCOVERING_KEYWORDS', 'Skipping discovery: not enough high-volume seeds');
                }
            }

            // --- 5. BUILD SNAPSHOT ROWS ---
            emit('BUILDING_ROWS', 'Converting to corpus format...');

            const snapshotRows: SnapshotKeywordRow[] = [];
            const seenKeywords = new Set<string>();
            let rowIndex = 0;

            // Process seed keywords
            for (const dfsRow of allDfsRows) {
                const key = dfsRow.keyword.toLowerCase();
                if (seenKeywords.has(key)) continue;
                seenKeywords.add(key);

                const row = dfsRowToSnapshotRow(dfsRow, categoryId, gen, countryCode, language, 'SEED', rowIndex);
                snapshotRows.push(row);
                rowIndex++;

                if (row.status === 'VALID') progress.validKeywords++;
                else progress.zeroKeywords++;
            }

            // Process discovered keywords
            for (const dfsRow of discoveredRows) {
                const key = dfsRow.keyword.toLowerCase();
                if (seenKeywords.has(key)) continue;
                seenKeywords.add(key);

                const row = dfsRowToSnapshotRow(dfsRow, categoryId, gen, countryCode, language, 'DISCOVERED', rowIndex);
                snapshotRows.push(row);
                rowIndex++;

                if (row.status === 'VALID') progress.validKeywords++;
                else progress.zeroKeywords++;
            }

            // Also add any seed keywords that didn't come back from DFS (mark as UNVERIFIED)
            for (const kw of seedKeywords) {
                const key = kw.toLowerCase();
                if (seenKeywords.has(key)) continue;
                seenKeywords.add(key);

                snapshotRows.push({
                    keyword_id: slugifyKeywordId(kw, categoryId),
                    keyword_text: kw,
                    volume: null,
                    anchor_id: assignAnchor(kw, gen, rowIndex),
                    intent_bucket: classifyIntent(kw),
                    status: 'UNVERIFIED',
                    active: false,
                    language_code: language,
                    country_code: countryCode,
                    category_id: categoryId,
                    created_at_iso: new Date().toISOString(),
                    validation_tier: 'AI_GENERATED_NO_DFS',
                });
                rowIndex++;
            }

            emit('BUILDING_ROWS', `Built ${snapshotRows.length} corpus rows (${progress.validKeywords} valid, ${progress.zeroKeywords} zero)`, {
                totalKeywords: snapshotRows.length,
                processedKeywords: snapshotRows.length,
            });

            // --- 6. SAVE TO PLATFORMDB ---
            emit('SAVING', `Saving ${snapshotRows.length} rows to IndexedDB...`);

            const saved = await PlatformDB.saveCorpus(categoryId, snapshotRows);
            if (!saved) {
                emit('FAILED', 'Failed to save corpus to IndexedDB');
                return { ok: false, categoryId, totalRows: snapshotRows.length, validRows: progress.validKeywords, zeroRows: progress.zeroKeywords, discoveredCount: discoveredRows.length, elapsedMs: Date.now() - startTime, error: 'SAVE_FAILED' };
            }

            // Also save the project + category to PlatformDB for persistence
            await PlatformDB.saveProject(project);
            await PlatformDB.saveCategory(categoryId, gen);

            const elapsed = Date.now() - startTime;
            emit('DONE', `Corpus built: ${snapshotRows.length} keywords (${progress.validKeywords} valid) in ${(elapsed / 1000).toFixed(1)}s`);

            return {
                ok: true,
                categoryId,
                totalRows: snapshotRows.length,
                validRows: progress.validKeywords,
                zeroRows: progress.zeroKeywords,
                discoveredCount: discoveredRows.length,
                elapsedMs: elapsed,
            };

        } catch (e: any) {
            const elapsed = Date.now() - startTime;
            emit('FAILED', `Corpus build failed: ${e.message}`);
            return { ok: false, categoryId, totalRows: 0, validRows: 0, zeroRows: 0, discoveredCount: 0, elapsedMs: elapsed, error: e.message };
        }
    },

    /**
     * Quick build: seed volumes only, no discovery. Fast for testing.
     */
    async buildCorpusQuick(
        project: ProjectDefinition,
        onProgress?: ProgressCallback
    ): Promise<CorpusBuildResult> {
        return this.buildCorpus(project, { skipDiscovery: true, forceRebuild: true }, onProgress);
    },

    /**
     * Check if a corpus already exists for a category.
     */
    async hasCorpus(categoryId: string): Promise<{ exists: boolean; rowCount: number }> {
        const corpus = await PlatformDB.getCorpus(categoryId);
        return { exists: !!(corpus && corpus.rowCount > 0), rowCount: corpus?.rowCount || 0 };
    },

    /**
     * Get corpus rows for a category (for CorpusInspector compatibility).
     */
    async getCorpusRows(categoryId: string): Promise<SnapshotKeywordRow[]> {
        const corpus = await PlatformDB.getCorpus(categoryId);
        return corpus?.rows || [];
    },

    /**
     * Get corpus stats for quick display.
     */
    async getCorpusStats(categoryId: string): Promise<{
        total: number;
        valid: number;
        zero: number;
        unverified: number;
        byAnchor: Record<string, number>;
        byIntent: Record<string, number>;
        topKeywords: { keyword: string; volume: number }[];
    }> {
        const rows = await this.getCorpusRows(categoryId);
        
        const byAnchor: Record<string, number> = {};
        const byIntent: Record<string, number> = {};
        let valid = 0, zero = 0, unverified = 0;

        for (const r of rows) {
            byAnchor[r.anchor_id] = (byAnchor[r.anchor_id] || 0) + 1;
            byIntent[r.intent_bucket] = (byIntent[r.intent_bucket] || 0) + 1;
            if (r.status === 'VALID') valid++;
            else if (r.status === 'ZERO') zero++;
            else unverified++;
        }

        const topKeywords = rows
            .filter(r => (r.volume || 0) > 0)
            .sort((a, b) => (b.volume || 0) - (a.volume || 0))
            .slice(0, 20)
            .map(r => ({ keyword: r.keyword_text, volume: r.volume || 0 }));

        return { total: rows.length, valid, zero, unverified, byAnchor, byIntent, topKeywords };
    },
};
