
import { DemandOutputStore, DEMAND_OUTPUT_VERSION, DemandDoc } from './demandOutputStore';
import { SnapshotResolver } from './snapshotResolver';
import { loadSnapshotRowsLiteChunked } from './snapshotChunkReader';
import { MetricsCalculatorV3 } from './metricsCalculatorV3';
import { MetricsCalculatorV4 } from './metricsCalculatorV4';
import { getDeterministicTrend5y } from './googleTrendsService';
import { SnapshotKeywordRow } from '../types';
import { DemandProvenanceAudit } from './demandProvenanceAudit';
import { DEMAND_BASELINE_MODE } from '../constants/runtimeFlags';

export interface RunDemandOptions {
    categoryId: string;
    month: string;
    country?: string;
    language?: string;
    force?: boolean;
    jobId?: string;
    baselineMode?: boolean; // P0: Deterministic / Offline
    skipPersistence?: boolean; // P0: Audit Only
}

export interface DemandRunResult {
    ok: boolean;
    categoryId: string;
    month: string;
    docId: string;
    demand_index_mn: number;
    metricsVersion: string;
    computedAt: string;
    source: "DETERMINISTIC_DOC" | "POST_WRITE_READ" | "MEMORY_ONLY";
    data: DemandDoc;
    error?: string;
}

// 1. Eligibility Rule (Single Source of Truth)
function isDemandEligible(row: SnapshotKeywordRow): boolean {
    const vol = Number(row.volume);
    return row.active !== false && Number.isFinite(vol) && vol > 0;
}

export const DemandRunner = {
    async runDemand(opts: RunDemandOptions): Promise<DemandRunResult> {
        const { categoryId, month, country = "IN", language = "en", force } = opts;
        const runtimeTargetVersion = DEMAND_OUTPUT_VERSION;
        
        // Resolve Baseline Mode: Global Flag OR Per-Run Override
        const isBaselineMode = DEMAND_BASELINE_MODE || opts.baselineMode;

        // [DEMAND_ENGINE][INPUT]
        console.log(`[DEMAND_ENGINE][INPUT] category=${categoryId} month=${month} force=${force} baseline=${isBaselineMode}`);

        // 1. Try Deterministic Read (Skip if forcing recalc)
        if (!force) {
            const readRes = await DemandOutputStore.readDemandDoc({
                categoryId, month, country, language, runtimeTargetVersion
            });
            
            if (readRes.ok && readRes.data) {
                console.log(`[DEMAND_OUTPUT][SERVE_DETERMINISTIC] doc=${readRes.data.docId} version=${readRes.data.metricsVersion} demand_index_mn=${readRes.data.demand_index_mn}`);
                return {
                    ok: true,
                    categoryId,
                    month,
                    docId: readRes.data.docId,
                    demand_index_mn: readRes.data.demand_index_mn,
                    metricsVersion: readRes.data.metricsVersion,
                    computedAt: readRes.data.computedAt,
                    source: "DETERMINISTIC_DOC",
                    data: readRes.data
                };
            }
        }

        // 2. Compute Fresh
        try {
            // A. Resolve Corpus
            const corpusRes = await SnapshotResolver.resolveActiveSnapshot(categoryId, country, language);
            if (!corpusRes.ok || !corpusRes.snapshot) {
                throw new Error(`Corpus snapshot not found for ${categoryId}`);
            }
            const corpusSnapshotId = corpusRes.snapshot.snapshot_id;
            
            console.log(`[DEMAND_ENGINE][SNAP_RESOLVE] snapshotId=${corpusSnapshotId} lifecycle=${corpusRes.snapshot.lifecycle}`);

            // B. Load Rows
            // We load ALL rows (onlyValid: false) then filter strictly ourselves
            const { chunks, totalRows } = await loadSnapshotRowsLiteChunked(
                categoryId, 
                corpusSnapshotId, 
                { chunkSize: 1000, maxChunks: 50, seed: `DEMAND_${month}` },
                { onlyValid: false } 
            );
            const allRows = chunks.flat();
            
            console.log(`[DEMAND_ENGINE][ROWS_LOADED] count=${allRows.length} (metaTotal=${totalRows})`);

            // C. Filter
            // Map to strict shape for calculator
            const eligibleRows: SnapshotKeywordRow[] = [];
            const processedRows = allRows.map((r: any) => {
                const row: SnapshotKeywordRow = {
                    keyword_id: r.keyword_id || r.keyword,
                    keyword_text: r.keyword,
                    volume: Number(r.volume),
                    amazonVolume: r.amazonVolume,
                    anchor_id: r.anchor_id || 'Unknown',
                    intent_bucket: r.intent_bucket || 'Discovery',
                    status: r.status,
                    active: r.active !== false,
                    language_code: language,
                    country_code: country,
                    category_id: categoryId,
                    created_at_iso: new Date().toISOString()
                };
                
                if (isDemandEligible(row)) {
                    eligibleRows.push(row);
                }
                return row;
            });
            
            // Explicit Deterministic Sort (P0)
            eligibleRows.sort((a, b) => a.keyword_id.localeCompare(b.keyword_id));

            // Missing Inputs Check (Baseline Mode)
            if (isBaselineMode && eligibleRows.length === 0 && totalRows > 0) {
                 // If we have rows but none eligible, it might be MISSING_INPUTS (no volumes)
                 const hasVolumes = allRows.some(r => (r.volume || 0) > 0);
                 if (!hasVolumes) {
                     console.warn(`[DEMAND_ENGINE] MISSING_INPUTS: No positive volumes found in snapshot.`);
                     // We proceed, but result will be 0. 
                     // The Benchmark Runner handles the "MISSING_INPUTS" verdict based on 0 result + >0 rows.
                 }
            }

            // D. Compute Metrics
            // In Baseline Mode, skip remote fetch for trends.
            const trendLock = await getDeterministicTrend5y(categoryId, isBaselineMode);
            const trendsForCalc = {
                fiveYearTrendPct: trendLock.value_percent,
                trendStatus: (trendLock.trend_label || 'UNKNOWN') as any,
                trendError: trendLock.error,
            };

            const v3Metrics = MetricsCalculatorV3.calculate(categoryId, corpusSnapshotId, eligibleRows, trendsForCalc);
            
            // Optional V4
            let v4Metrics = null;
            try {
                v4Metrics = MetricsCalculatorV4.calculate(categoryId, processedRows, v3Metrics as any);
            } catch (e) { console.warn("V4 Calc failed", e); }

            // E. Construct Payload
            const now = new Date().toISOString();
            const docId = DemandOutputStore.buildDocId(categoryId, month);

            // COMPUTE FINGERPRINT (Critical Fix)
            let corpusFingerprint = "UNKNOWN";
            try {
                corpusFingerprint = DemandProvenanceAudit.computeFingerprint(processedRows, categoryId, month);
            } catch (e) {
                corpusFingerprint = `FALLBACK:${corpusSnapshotId}:${processedRows.length}`;
            }
            
            console.log(`[DEMAND_ENGINE][FINGERPRINT] computed=${corpusFingerprint} source=processedRows`);

            const payload: DemandDoc = {
                docId,
                categoryId,
                month,
                country,
                language,
                corpusSnapshotId,
                corpusFingerprint: corpusFingerprint,
                computedAt: now,
                metricsVersion: runtimeTargetVersion,
                version: runtimeTargetVersion,
                
                demand_index_mn: v3Metrics.demand_index_mn || 0,
                metric_scores: { 
                    readiness: v3Metrics.metric_scores?.readiness || 0, 
                    spread: v3Metrics.metric_scores?.spread || 0 
                },
                trend_5y: v3Metrics.trend_5y,
                
                totalKeywordsInput: processedRows.length,
                totalKeywordsUsedInMetrics: eligibleRows.length,
                eligibleCount: eligibleRows.length,

                result: {
                    ...v3Metrics,
                    metrics_v4: v4Metrics
                }
            };

            // F. Write or Return
            if (opts.skipPersistence) {
                 console.log(`[DEMAND_ENGINE][MEMORY_ONLY] computed demand=${payload.demand_index_mn}`);
                 return {
                    ok: true,
                    categoryId,
                    month,
                    docId,
                    demand_index_mn: payload.demand_index_mn,
                    metricsVersion: payload.metricsVersion,
                    computedAt: payload.computedAt,
                    source: "MEMORY_ONLY",
                    data: payload
                 };
            }

            const savedDoc = await DemandOutputStore.writeDemandDoc({
                country, language, categoryId, month, payload, runtimeTargetVersion
            });
            
            console.log(`[DEMAND_ENGINE][WRITE_OK] doc=${savedDoc.docId} fingerprint=${savedDoc.corpusFingerprint}`);

            return {
                ok: true,
                categoryId,
                month,
                docId: savedDoc.docId,
                demand_index_mn: savedDoc.demand_index_mn,
                metricsVersion: savedDoc.metricsVersion,
                computedAt: savedDoc.computedAt,
                source: "POST_WRITE_READ",
                data: savedDoc
            };

        } catch (e: any) {
            console.error(`[DEMAND_RUNNER] Failed: ${e.message}`);
            return {
                ok: false,
                categoryId,
                month,
                docId: "",
                demand_index_mn: 0,
                metricsVersion: "",
                computedAt: "",
                source: "POST_WRITE_READ",
                data: {} as any,
                error: e.message
            };
        }
    }
};
