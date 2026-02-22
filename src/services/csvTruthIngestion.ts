
import { VolumeTruthStore, TruthVolume, computeSHA256, DerivedDemandMetrics, TruthHistoryPoint } from './volumeTruthStore';
import { normalizeKeywordString, computeKeywordBaseHash } from '../driftHash';
import { WindowingService } from './windowing';
import { StorageAdapter } from './storageAdapter';
import { StrategyOverrideStore } from './strategyOverrideStore';
// Fixed: src/services/csvTruthIngestion.ts should import from ../../types (root) not ../types
import { CsvMappingProfile, StrategyOverride } from '../../types';

// --- SYNONYMS (Deterministic Mapping) ---
const HEADER_SYNONYMS = {
    KEYWORD: ["Keyword", "keyword", "query", "search term", "kw", "term", "Search query", "Phases"],
    VOLUME: ["Volume", "Search Volume", "Avg. monthly searches", "Monthly Searches", "Searches", "SV", "volume_monthly", "Avg Searches", "Values"],
    TREND_PCT: ["Trend", "Trend %", "YoY", "Growth %", "Change %", "5Y Trend", "trend_percent"]
};

// Date Regex for Monthly Columns (e.g. "2018-01", "Jan 2020", "4/2015")
const DATE_COL_REGEX = /^((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s-]?\d{2,4}|\d{1,2}[/-]\d{4}|\d{4}-\d{2})$/i;

export interface IngestionLog {
    summary: {
        totalRowsParsed: number;
        rowsInserted: number;
        duplicatesSkipped: number;
        conflictsDetected: number;
        invalidRowsCount: number;
        snapshotId?: string;
        volumeSource: 'DIRECT' | 'DERIVED_FROM_HISTORY' | 'MISSING';
        trendDataAvailable: boolean;
    };
    invalidRows: { row: number; content: string; reason: string }[];
    status: 'SUCCESS' | 'FAILED' | 'PARTIAL' | 'PENDING';
    message: string;
}

export const CsvTruthIngestion = {

    // 1. Parsing & Detection
    parseStructure(rawCsv: string): { headers: string[], rows: string[][] } {
        const lines = rawCsv.split(/\r?\n/).filter(l => l.trim().length > 0);
        if (lines.length < 2) throw new Error("CSV is empty or lacks header");
        
        // Robust CSV splitter handling quoted values
        const splitRow = (row: string) => {
            const matches = row.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || row.split(',');
            return matches.map(m => m.replace(/^"|"$/g, '').trim());
        };

        const headers = splitRow(lines[0]);
        const rows = lines.slice(1).map(splitRow);
        return { headers, rows };
    },

    detectMapping(headers: string[], categoryId: string): CsvMappingProfile {
        const lowerHeaders = headers.map(h => h.toLowerCase().trim());
        const rawHeaders = headers.map(h => h.trim());
        
        const findIndex = (synonyms: string[]) => lowerHeaders.findIndex(h => synonyms.map(s => s.toLowerCase()).includes(h));
        
        const keywordIndex = findIndex(HEADER_SYNONYMS.KEYWORD);
        let volumeIndex = findIndex(HEADER_SYNONYMS.VOLUME);
        const trendPercentIndex = findIndex(HEADER_SYNONYMS.TREND_PCT);
        
        // Date Series Detection
        const trendSeriesIndices: number[] = [];
        const dateMap: { idx: number, date: number }[] = [];

        rawHeaders.forEach((h, idx) => {
            if (DATE_COL_REGEX.test(h)) {
                // Try to parse date to sort correctly
                const d = new Date(h);
                if (!isNaN(d.getTime())) {
                    dateMap.push({ idx, date: d.getTime() });
                } else if (/\d{4}-\d{2}/.test(h)) {
                     // Fallback for YYYY-MM
                     dateMap.push({ idx, date: Date.parse(h + "-01") });
                }
            }
        });

        // Sort indices chronologically
        dateMap.sort((a, b) => a.date - b.date);
        dateMap.forEach(d => trendSeriesIndices.push(d.idx));

        if (keywordIndex === -1) {
             throw new Error(`Could not detect Keyword column. Headers found: ${headers.join(', ')}`);
        }

        return {
            id: `map-${Date.now()}`,
            categoryId,
            detectedHeaders: headers,
            mapping: { 
                keywordIndex, 
                volumeIndex, // Can be -1 if deriving
                trendPercentIndex: trendPercentIndex === -1 ? undefined : trendPercentIndex, 
                trendSeriesIndices 
            },
            createdAt: new Date().toISOString()
        };
    },

    // 2. Ingestion & Override Creation
    async ingest(
        rawCsv: string, 
        categoryId: string = 'SYSTEM', 
        mapping?: CsvMappingProfile
    ): Promise<IngestionLog> {
        
        const log: IngestionLog = {
            summary: {
                totalRowsParsed: 0,
                rowsInserted: 0,
                duplicatesSkipped: 0,
                conflictsDetected: 0,
                invalidRowsCount: 0,
                snapshotId: undefined,
                volumeSource: 'MISSING',
                trendDataAvailable: false
            },
            invalidRows: [],
            status: 'PENDING',
            message: ''
        };

        try {
            const { headers, rows } = this.parseStructure(rawCsv);
            log.summary.totalRowsParsed = rows.length;
            
            const profile = mapping || this.detectMapping(headers, categoryId);
            
            // Determine Volume Source for Log
            if (profile.mapping.volumeIndex !== -1) {
                log.summary.volumeSource = 'DIRECT';
            } else if (profile.mapping.trendSeriesIndices && profile.mapping.trendSeriesIndices.length > 0) {
                log.summary.volumeSource = 'DERIVED_FROM_HISTORY';
            } else {
                log.summary.volumeSource = 'MISSING';
            }

            if ((profile.mapping.trendPercentIndex !== undefined) || (profile.mapping.trendSeriesIndices && profile.mapping.trendSeriesIndices.length > 1)) {
                log.summary.trendDataAvailable = true;
            }

            // A. Create Sealed CSV Window
            const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
            const WINDOW_ID = `CSV-${categoryId}-${dateStr}`;
            
            // B. Persist Mapping
            await StorageAdapter.set(profile.id, profile, StorageAdapter.STORES.MAPPING);

            let importedCount = 0;
            let dupes = 0;
            const keywordsForOverride: StrategyOverride['selected_keywords'] = [];
            const dedupMap = new Map<string, number>();

            // C. Process Rows
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                if (row.length < headers.length * 0.5) continue; // Skip malformed/empty lines

                const rawKw = row[profile.mapping.keywordIndex];
                if (!rawKw || !rawKw.trim()) continue;

                // --- VOLUME LOGIC ---
                let vol = 0;
                let trend5yVal: number | undefined = undefined;

                // 1. Direct Volume
                if (profile.mapping.volumeIndex !== -1) {
                    const vRaw = row[profile.mapping.volumeIndex];
                    vol = parseInt((vRaw || '0').replace(/[^0-9]/g, ''), 10) || 0;
                }
                
                // 2. History Series (Derivation / Trend)
                if (profile.mapping.trendSeriesIndices && profile.mapping.trendSeriesIndices.length > 0) {
                    // Extract values
                    const values = profile.mapping.trendSeriesIndices.map(idx => {
                        const valStr = row[idx];
                        const v = parseInt((valStr || '0').replace(/[^0-9]/g, ''), 10);
                        return isNaN(v) ? 0 : v;
                    });

                    // If Direct Volume Missing, Derive it (Median of last 12 available)
                    if (profile.mapping.volumeIndex === -1) {
                        const last12 = values.slice(-12);
                        if (last12.length > 0) {
                            const sorted = [...last12].sort((a,b) => a - b);
                            const mid = Math.floor(sorted.length / 2);
                            vol = sorted.length % 2 !== 0 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
                        }
                    }

                    // Compute Trend (Simple Growth if >= 2 points)
                    if (values.length >= 2) {
                        const first = values[0];
                        const last = values[values.length - 1];
                        if (first > 0) {
                            trend5yVal = parseFloat((((last - first) / first) * 100).toFixed(1));
                        }
                    }
                }

                // 3. Explicit Trend Override
                if (trend5yVal === undefined && profile.mapping.trendPercentIndex !== undefined) {
                     const tRaw = row[profile.mapping.trendPercentIndex];
                     if (tRaw) trend5yVal = parseFloat(tRaw.replace(/[^0-9.-]/g, ''));
                }

                // Normalization
                const key = normalizeKeywordString(rawKw);
                if (dedupMap.has(key)) {
                    // Tie-break: Max volume
                    if (vol > dedupMap.get(key)!) dedupMap.set(key, vol);
                    dupes++;
                    continue; 
                }
                dedupMap.set(key, vol);

                // Derived Metrics
                const derived: DerivedDemandMetrics = {
                    demandBase: vol, demandNow: vol, momentum: 1, trend6m: 0, trend12m: 0,
                    seasonality: { peakMonth: 0, strength: 0 }, volatility: 0, recencyCoverage: 1, demandScore: 50,
                    trend5y: trend5yVal
                };

                const truthRecord: TruthVolume = {
                    keywordKey: key,
                    windowId: WINDOW_ID,
                    estimator: 'MANGOOLS_LOCKED',
                    truthVolume: vol,
                    observationCount: 1,
                    lastUpdatedAt: new Date().toISOString(),
                    truthHash: await computeSHA256(key + vol + WINDOW_ID), 
                    derivedMetrics: derived
                };

                await VolumeTruthStore.saveTruth(truthRecord);
                
                keywordsForOverride.push({
                    keyword: rawKw, // Keep original casing
                    anchor: 'CSV Imported',
                    subCategory: 'General',
                    intentBucket: 'Discovery'
                });
                
                importedCount++;
            }

            // D. Create Strategy Override
            const override: StrategyOverride = {
                categoryId,
                strategySource: 'CSV_OVERRIDE',
                targetWindowId: WINDOW_ID,
                selected_keywords: keywordsForOverride,
                keywordBaseHash: await computeKeywordBaseHash(keywordsForOverride.map(k => ({
                    keywordCanonical: k.keyword, anchor: k.anchor, cluster: null, intent: k.intentBucket, language: 'en', canonicalFamilyId: 'csv', originalTerm: k.keyword
                }))),
                createdAt: new Date().toISOString(),
                mappingProfileId: profile.id
            };
            
            await StrategyOverrideStore.setOverride(override);

            // E. Seal Window
            await WindowingService.sealWindow(WINDOW_ID, {
                keywordsSeeded: importedCount,
                injectionSource: 'MANGOOLS_CSV_IMPORT',
                coveragePercent: 100
            } as any);

            log.status = 'SUCCESS';
            log.message = `Imported ${importedCount} keywords.`;
            log.summary.rowsInserted = importedCount;
            log.summary.duplicatesSkipped = dupes;
            log.summary.snapshotId = WINDOW_ID;
            
            // Required Confirmation Signal
            console.log(`CSV INGESTED — category=${categoryId}, rows=${importedCount}, source=${log.summary.volumeSource}, window=${WINDOW_ID}`);

            return log;

        } catch (e: any) {
            console.error("CSV Ingest Failed", e);
            log.status = 'FAILED';
            log.message = e.message;
            return log;
        }
    }
};
