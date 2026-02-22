
import { SeedStore } from './seedStore';
import { Derivations } from './csvIngestion/derivations';
import { KeywordValidator } from './csvIngestion/keywordValidator';
import { SeedMeta, IngestionReport, IngestionProgress, IngestionDiagnostics } from './csvIngestion/types';
import { CsvAiMapping } from './csvAiMapping';
// Fixed: src/services/csvIngestionService.ts should import from ../../types (root) not ../types
import { StrategyArtifact } from '../../types';
import { StorageAdapter } from './storageAdapter';
import { Normalization } from './normalization';
import { MasterCsvStore, MasterCsvRecord } from './masterCsvStore';
import { StrategyPackService } from './strategyPack';
import { computeSHA256 } from './volumeTruthStore';

const MIN_ACCEPTED_COUNT = 50; 

export const CsvIngestionService = {

    async ingest(
        fileContent: string, 
        categoryId: string, 
        targetMonthWindowId: string, 
        fileName: string,
        onProgress?: (progress: IngestionProgress) => void
    ): Promise<IngestionReport> {
        
        const startTime = Date.now();
        
        const reportProgress = (stage: IngestionProgress['stage'], percent: number, msg: string, details?: any) => {
            if (onProgress) onProgress({ stage, percent, message: msg, details });
        };

        console.log(`[Ingestion] Starting for ${categoryId} into Master Store: ${targetMonthWindowId}`);

        const report: IngestionReport = {
            categoryId,
            monthWindowId: targetMonthWindowId,
            status: 'FAILED',
            message: 'Initialization...',
            durationMs: 0,
            stats: {
                totalRowsRead: 0,
                rowsAccepted: 0,
                duplicatesRemoved: 0,
                collapsedVariants: 0,
                invalidRows: 0,
                missingVolumeRows: 0,
                resolvedCoveragePct: 0,
                zeroVolumePct: 0, 
                trendCoveragePct: 0,
                anchorsIdentified: 0,
                snapshotWindowId: `MASTER-${targetMonthWindowId}`,
                blockingStatus: false,
                acceptedRate: 0
            },
            mappingUsed: [],
            errors: [],
            debug: {
                rejectionHistogram: {},
                rejectedSamples: [],
                parsedRowSamples: [],
                timeSeriesDebug: { detected: false, columns: 0, avgPoints: 0 }
            }
        };

        const diagnostics: IngestionDiagnostics = {
            volumeParseSuccessCount: 0,
            volumeParseFailCount: 0,
            volumeRawSample: [],
            volumeParsedSample: [],
            keywordBlankRejectedCount: 0,
            volumeBlankRejectedCount: 0,
            volumeNullRejectedCount: 0,
            volumeZeroRejectedCount: 0,
            volumeNaNRejectedCount: 0,
            acceptedCount: 0,
            acceptedSamples: [],
            rejectedSamples: []
        };

        try {
            reportProgress('FILE_READ', 5, 'Mapping structure...');

            // 1. SCHEMA INFERENCE
            const schema = await CsvAiMapping.inferSchema(fileName, fileContent);
            if (schema.keyword.index === -1) throw new Error("MISSING_REQUIRED_COLUMN:Keyword.");
            if (schema.volume.index === -1) throw new Error("CRITICAL: Missing required volume column.");

            // Populate Report Mapping Info
            report.mappingUsed = [
                `Keyword: Column ${schema.keyword.index}`,
                `Volume: Column ${schema.volume.index} (${schema.volume.source})`
            ];
            
            diagnostics.volumeColumnIndex = schema.volume.index;
            diagnostics.volumeColumnHeader = schema.volume.source;

            const cleanContent = fileContent.replace(/^\uFEFF/, '');
            const lines = cleanContent.split(/\r?\n/).filter(l => l.trim().length > 0);
            
            // Helper to parse CSV row
            const parseRow = (rowStr: string, delimiter: string): string[] => {
                const result: string[] = [];
                let current = '';
                let inQuotes = false;
                for (let i = 0; i < rowStr.length; i++) {
                    const char = rowStr[i];
                    if (char === '"') { inQuotes = !inQuotes; }
                    else if (char === delimiter && !inQuotes) { result.push(current.trim().replace(/^"|"$/g, '')); current = ''; }
                    else { current += char; }
                }
                result.push(current.trim().replace(/^"|"$/g, ''));
                return result;
            };

            reportProgress('PARSE_ROWS', 15, `Processing ${lines.length} rows...`);
            const records: MasterCsvRecord[] = [];
            const validator = KeywordValidator.createValidator(categoryId);
            
            // Dedup Map to handle raw-file duplicates immediately
            const dedupMap = new Map<string, MasterCsvRecord>();

            for (let i = 1; i < lines.length; i++) {
                const cols = parseRow(lines[i], schema.delimiter);
                if (cols.length < 2) continue;

                // 1. Keyword Check
                const rawKw = cols[schema.keyword.index] || '';
                const validation = validator(rawKw);
                
                if (!validation.isValid) {
                    diagnostics.keywordBlankRejectedCount++;
                    if (diagnostics.rejectedSamples.length < 5) diagnostics.rejectedSamples.push({ k: rawKw, v: 'N/A', reason: `Invalid Keyword: ${validation.rejectionReason}` });
                    continue; 
                }

                // 2. Volume Parse (STRICT)
                const rawVolStr = cols[schema.volume.index];
                const vol = Derivations.parseVolume(rawVolStr);

                if (i <= 11) {
                    diagnostics.volumeRawSample.push(rawVolStr || '(empty)');
                    diagnostics.volumeParsedSample.push(vol);
                }

                // 3. STRICT Rejection Rules (Must match Definition of Done: "Reject 0/null/blank/NaN")
                if (rawVolStr === undefined || rawVolStr === null || String(rawVolStr).trim() === '') {
                    diagnostics.volumeBlankRejectedCount++;
                    continue;
                }

                if (vol === null) {
                    // Derivations.parseVolume returns null for NaN or <= 0
                    // Check raw to distinguish NaN from 0 for cleaner reporting
                    const numVal = Number(String(rawVolStr).replace(/[^0-9.]/g,''));
                    if (Number.isFinite(numVal) && numVal <= 0) {
                         diagnostics.volumeZeroRejectedCount++;
                         if (diagnostics.rejectedSamples.length < 5) diagnostics.rejectedSamples.push({ k: rawKw, v: rawVolStr, reason: 'Volume Zero' });
                    } else {
                         diagnostics.volumeNaNRejectedCount++;
                         if (diagnostics.rejectedSamples.length < 5) diagnostics.rejectedSamples.push({ k: rawKw, v: rawVolStr, reason: 'Volume Invalid (NaN)' });
                    }
                    continue;
                }

                // Vol is guaranteed > 0 by Derivations.parseVolume logic
                diagnostics.acceptedCount++;
                if (diagnostics.acceptedSamples.length < 5) {
                    diagnostics.acceptedSamples.push({ k: validation.normalizedText, v: vol });
                }

                // Series (Optional, stored if present)
                const series: { date: string, volume: number }[] = [];
                if (schema.monthlySeries.present) {
                    schema.monthlySeries.monthColumns.forEach(mc => {
                        const rawM = cols[mc.index];
                        // Loose parse for series history, fallback to 0 is okay for history but NOT for base volume
                        const val = Derivations.parseVolumeStrict(rawM);
                        if (val !== null) series.push({ date: mc.month, volume: val });
                    });
                }

                const normKey = Normalization.normalize(validation.normalizedText);
                
                const record: MasterCsvRecord = {
                    operatingMonth: targetMonthWindowId,
                    categoryId,
                    keywordNormalized: normKey,
                    rawKeyword: rawKw,
                    volume: vol,
                    timeSeries: series,
                    ingestedAt: new Date().toISOString()
                };

                // Dedupe Logic: Keep Highest Volume
                if (dedupMap.has(normKey)) {
                    const existing = dedupMap.get(normKey)!;
                    if (vol > existing.volume) {
                        dedupMap.set(normKey, record);
                    }
                    report.stats.duplicatesRemoved++;
                } else {
                    dedupMap.set(normKey, record);
                }
            }
            
            records.push(...dedupMap.values());

            report.stats.totalRowsRead = lines.length - 1;
            report.stats.rowsAccepted = records.length;
            report.diagnostics = diagnostics;
            
            const acceptedRate = report.stats.totalRowsRead > 0 ? diagnostics.acceptedCount / report.stats.totalRowsRead : 0;
            report.stats.acceptedRate = acceptedRate;

            // CONTRACT CHECK: Ingestion
            if (records.length === 0) {
                // Determine why
                let reason = "Unknown";
                if (diagnostics.volumeZeroRejectedCount > 0) reason = "All rows had 0 volume.";
                else if (diagnostics.volumeNaNRejectedCount > 0) reason = "Volume column parsing failed (check format).";
                else if (diagnostics.keywordBlankRejectedCount > 0) reason = "Keyword validation failed.";
                
                throw new Error(`INGESTION FAILURE: 0 valid records found. ${reason}`);
            }

            if (records.length < MIN_ACCEPTED_COUNT) {
                report.stats.blockingStatus = true;
                report.stats.blockingReason = `Insufficient valid data: Accepted ${records.length}.`;
            }

            if (report.stats.blockingStatus) {
                report.status = 'FAILED';
                report.message = `DATA_QUALITY_FAILURE: ${report.stats.blockingReason}`;
                report.durationMs = Date.now() - startTime;
                reportProgress('FAILED', 100, report.message);
                return report;
            }

            // 4. WRITE TO MASTER CSV STORE
            reportProgress('WRITE_MASTER', 50, `Saving ${records.length} records to Master Store...`);
            await MasterCsvStore.clearCategory(categoryId, targetMonthWindowId); // Clean slate for this month
            await MasterCsvStore.saveRecords(records);

            // 5. BUILD STRATEGY PACK (Refinement Layer)
            reportProgress('DERIVE_TRENDS', 75, 'Building Strategy Pack...');
            
            const seedRows = records.map(r => ({
                categoryId: r.categoryId,
                monthWindowId: r.operatingMonth,
                keywordKey: r.keywordNormalized,
                keywordText: r.rawKeyword,
                baseVolume: r.volume,
                intentBucket: 'UNKNOWN' as any, // Pack builder handles intent
                anchorId: 'TBD',
                source: 'MANGOOLS_SNAPSHOT' as const,
                sourceFileName: fileName,
                ingestedAt: r.ingestedAt,
                // Add trend label if we can compute it from series
                trend_label: (r.timeSeries && r.timeSeries.length > 2) 
                    ? Derivations.computeTrend5y(r.timeSeries.map(s => s.volume)).label 
                    : 'Unknown'
            }));

            const pack = StrategyPackService.buildStrategyPack(categoryId, seedRows, targetMonthWindowId);
            const seedHash = await computeSHA256(JSON.stringify(records.map(r => r.keywordNormalized).sort()));

            // Save Strategy Artifact
            const artifactId = `${categoryId}-${targetMonthWindowId}`; 
            const artifact: StrategyArtifact = {
                id: artifactId,
                categoryId,
                windowId: targetMonthWindowId,
                createdAt: new Date().toISOString(),
                corpusMeta: {
                    corpusRowsRead: report.stats.totalRowsRead,
                    acceptedCount: report.stats.rowsAccepted,
                    dedupedCount: report.stats.duplicatesRemoved,
                    zeroVolumeCount: diagnostics.volumeZeroRejectedCount, 
                    volumeCoveragePercent: 100,
                    trendCoveragePercent: 0
                },
                refinementMeta: {
                    conceptCount: records.length,
                    collapsedVariantsCount: 0,
                    refinementVersion: 'v2.5-master-csv',
                    seedHash
                },
                strategyPack: pack, // Direct assignment since StrategyPack interface now matches
                derivedSignals: { ngramTop20: pack.stats.topBigrams, brandTokensTop20: [] }
            };

            await StorageAdapter.set(artifactId, artifact, StorageAdapter.STORES.STRATEGY_ARTIFACT);

            // Save Metadata
            const seedMeta: SeedMeta = {
                categoryId,
                monthWindowId: targetMonthWindowId,
                truthWindowId: `MASTER-${targetMonthWindowId}`,
                seedHash,
                rowCount: records.length,
                collapsedCount: 0,
                resolvedVolumePct: 100,
                trendCoveragePct: 0,
                zeroVolumePct: 0,
                lastIngestedAt: new Date().toISOString(),
                status: 'PROCESSED',
                sourceFileName: fileName,
                mappingUsed: report.mappingUsed,
                blockingStatus: false,
                acceptedCount: diagnostics.acceptedCount,
                acceptedRate: acceptedRate
            };
            await SeedStore.saveSeedMeta(seedMeta);

            report.status = 'SUCCESS';
            report.message = `Imported ${records.length} valid keywords into Master Store.`;
            report.durationMs = Date.now() - startTime;
            reportProgress('COMPLETE', 100, 'Done');
            
            return report;

        } catch (e: any) {
            console.error("Ingest Error", e);
            report.status = 'FAILED';
            report.message = e.message;
            report.durationMs = Date.now() - startTime;
            reportProgress('FAILED', 0, e.message);
            return report;
        }
    }
};
