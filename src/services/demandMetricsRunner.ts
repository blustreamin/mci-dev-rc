
import { DemandSnapshotResolver, isValidCertifiedDemandSnapshot, DEMAND_OUTPUT_VERSION } from './deepDiveSnapshotResolvers';
import { SnapshotResolver } from './snapshotResolver';
import { loadSnapshotRowsLiteChunked } from './snapshotChunkReader';
import { MetricsCalculatorV3 } from './metricsCalculatorV3';
import { MetricsCalculatorV4 } from './metricsCalculatorV4';
import { getDeterministicTrend5y } from './googleTrendsService';
import { HeartbeatController } from './jobHeartbeat';
import { SnapshotKeywordRow, SweepResult } from '../types';
import { DemandSetBuilder, isDemandEligible } from './demandSetBuilder';
import { OutputSnapshotStore } from './outputSnapshotStore';
import { DemandProvenanceAudit } from './demandProvenanceAudit';
import { DemandInsightsService } from './demandInsightsService';

export const DemandMetricsRunner = {
  async runDemandMetrics(
    categoryId: string,
    month: string,
    opts?: { dryRun?: boolean; jobId?: string; forceRecalculate?: boolean }
  ): Promise<{ ok: boolean; metrics?: any; error?: string; debug?: any }> {

    const hb = opts?.jobId ? new HeartbeatController(opts.jobId) : null;
    if (hb) hb.start('DEMAND_RESOLVE');

    try {
      // 1. Resolve existing output (Deterministic Priority)
      const demandRes = await DemandSnapshotResolver.resolveV3OrUpgradeLegacy(categoryId, month);
      
      const cachedResult = demandRes.data;
      const forceRecalc = opts?.forceRecalculate === true;

      // Strict validity check
      const versionMatch = demandRes.metricsVersion === DEMAND_OUTPUT_VERSION;
      const validMetrics = cachedResult
        ? isValidCertifiedDemandSnapshot(
            { ...cachedResult, metricsVersion: demandRes.metricsVersion }, 
            demandRes.lifecycle || 'CERTIFIED',
            demandRes.corpusSnapshotId
          )
        : false;

      // CACHE HIT LOGIC
      if (!forceRecalc && validMetrics && versionMatch && demandRes.mode === 'EXACT_V3') {
        console.log(`[DEMAND_OUTPUT][SERVE_DETERMINISTIC] doc=${demandRes.snapshotId} version=${demandRes.metricsVersion} demand_index_mn=${cachedResult?.demand_index_mn}`);
        if (hb) await hb.stop('COMPLETED', 'Serving Cached Certified Metrics');
        return { ok: true, metrics: cachedResult };
      }
      
      // 2. Resolve Base Corpus Snapshot
      let corpusSnapshotId = demandRes.corpusSnapshotId;
      if (!validMetrics || corpusSnapshotId === 'LEGACY_UNKNOWN') corpusSnapshotId = undefined;

      if (!corpusSnapshotId || forceRecalc) {
        const corpusRes = await SnapshotResolver.resolveActiveSnapshot(categoryId, 'IN', 'en');
        if (corpusRes.ok && corpusRes.snapshot) corpusSnapshotId = corpusRes.snapshot.snapshot_id;
      }

      if (!corpusSnapshotId) {
        return { ok: false, error: 'EMPTY_CORPUS_OR_ZERO_VOLUME: No corpus snapshot found.' };
      }

      if (hb) await hb.tick('LOADING_ROWS');

      // 3. Load Rows
      const { chunks } = await loadSnapshotRowsLiteChunked(
        categoryId,
        corpusSnapshotId,
        { chunkSize: 500, maxChunks: 20, seed: `${categoryId}-${month}` },
        { onlyValid: false }
      );

      const allLiteRows = chunks.flat();
      const rowsForCalc: SnapshotKeywordRow[] = allLiteRows.map((r, i) => ({
        keyword_id: r.keyword_id || `gen_${i}`,
        keyword_text: r.keyword,
        volume: Number.isFinite(r.volume as any) ? Number(r.volume) : 0,
        amazonVolume: r.amazonVolume,
        anchor_id: r.anchor_id || 'Unknown',
        intent_bucket: r.intent_bucket || 'Discovery',
        status: (r.status as any) || 'UNVERIFIED',
        active: r.active !== false,
        language_code: 'en',
        country_code: 'IN',
        category_id: categoryId,
        created_at_iso: new Date().toISOString(),
      }));

      const eligibleCount = rowsForCalc.filter(isDemandEligible).length;
      console.log(`[DEMAND_VALIDITY][SUMMARY] category=${categoryId} rows=${rowsForCalc.length} eligible=${eligibleCount}`);
      // Telemetry as requested
      console.log(`[DEMAND_INPUT] snapshotIdUsed=${corpusSnapshotId} keywordValidCount=${eligibleCount}`);

      // Calculate Fingerprint for Sync Check
      const corpusFingerprint = DemandProvenanceAudit.computeFingerprint(rowsForCalc, categoryId, month);
      console.log(`[CORPUS_DEMAND_FINGERPRINT] category=${categoryId} month=${month} fingerprint=${corpusFingerprint}`);

      // 4. Calculate Metrics
      const demandSet = DemandSetBuilder.buildDemandSet(rowsForCalc, 0.05);
      const trendLock = await getDeterministicTrend5y(categoryId);
      
      const trendsForCalc = {
        fiveYearTrendPct: trendLock.value_percent,
        trendStatus: (trendLock.trend_label || 'UNKNOWN') as any,
        trendError: trendLock.error,
      };

      const calcResult = MetricsCalculatorV3.calculate(
        categoryId,
        corpusSnapshotId,
        demandSet.rowsUsed,
        trendsForCalc
      );

      const sweepResult: SweepResult = {
        category: categoryId,
        demand_index_mn: calcResult.demand_index_mn || 0,
        metric_scores: calcResult.metric_scores || { readiness: 0, spread: 0 },
        trend_5y: { ...(calcResult.trend_5y || ({} as any)), source: 'LOCKED' },
        runId: opts?.jobId || `CALC_${Date.now()}`,
        totalKeywordsInput: rowsForCalc.length,
        totalKeywordsUsedInMetrics: demandSet.rowsUsed.length,
        metricsVersion: DEMAND_OUTPUT_VERSION, 
        corpusFingerprint, // Inject fingerprint
        ...calcResult,
      } as SweepResult;

      try {
        sweepResult.metrics_v4 = MetricsCalculatorV4.calculate(categoryId, demandSet.rowsUsed, sweepResult);
      } catch (e) {
        console.error('[DEMAND][V4_FAIL]', e);
      }

      // 5. Deterministic Persistence
      const docId = OutputSnapshotStore.buildDocId(categoryId, month);
      console.log(`[DEMAND_OUTPUT][WRITE_START] doc=${docId}`);
      // Mandatory Proof Log
      console.log(`[DEMAND_SWEEP] category=${categoryId} month=${month} snapshot=${corpusSnapshotId} computed demandMn=${sweepResult.demand_index_mn.toFixed(2)}`);

      const saveRes = await OutputSnapshotStore.createOutputSnapshot(
        corpusSnapshotId,
        categoryId,
        'IN',
        'en',
        month,
        {}, // Empty strategy
        sweepResult,
        DEMAND_OUTPUT_VERSION,
        corpusFingerprint
      );

      if (saveRes.ok) {
        console.log(
          `[DEMAND_OUTPUT][WRITE_OK] doc=${docId} version=${DEMAND_OUTPUT_VERSION} demand_index_mn=${sweepResult.demand_index_mn.toFixed(2)} Mn`
        );
        console.log(`[DEMAND_OUTPUT_WRITE_OK] ${docId} linkedCorpus=true`);
        
        // --- NEW: Generate Demand Insights (Non-Blocking) ---
        if (hb) await hb.tick('GENERATING_INSIGHTS');
        try {
             const insights = await DemandInsightsService.generate(categoryId, sweepResult, month);
             if (insights) {
                 sweepResult.demand_insights = insights;
                 // Update the doc with insights
                 await OutputSnapshotStore.writeDeterministic({
                    country: 'IN', 
                    language: 'en', 
                    docId,
                    payload: { demand: sweepResult } // Merge update into demand field structure
                 });
                 console.log(`[DEMAND_INSIGHTS_OK] categoryId=${categoryId}`);
             } else {
                 console.warn(`[DEMAND_INSIGHTS_EMPTY] categoryId=${categoryId}`);
             }
        } catch (e: any) {
             console.warn(`[DEMAND_INSIGHTS_SKIP] categoryId=${categoryId}`, e);
        }
        // ----------------------------------------------------

        // IMMEDIATE RE-READ to guarantee consistency
        const fresh = await OutputSnapshotStore.readDeterministic({ country: 'IN', language: 'en', docId });
        if (fresh.ok && fresh.data) {
             const data = fresh.data;
             // Return the re-read data structure to ensuring DTO matching
             const finalSweep: SweepResult = {
                ...(data.demand || data),
                demand_index_mn: data.demand_index_mn,
                metric_scores: data.metric_scores,
                trend_5y: data.trend_5y,
                metricsVersion: data.metricsVersion,
                corpusFingerprint: data.corpusFingerprint
             };
             if (hb) await hb.stop('COMPLETED');
             return { ok: true, metrics: finalSweep };
        }
      } else {
        console.error(`[DEMAND_OUTPUT][WRITE_FAIL] doc=${docId} error=${saveRes.error}`);
      }

      if (hb) await hb.stop('COMPLETED');

      return { ok: true, metrics: sweepResult };
    } catch (e: any) {
      if (hb) await hb.stop('FAILED', e.message);
      return { ok: false, error: e.message };
    }
  },
};
