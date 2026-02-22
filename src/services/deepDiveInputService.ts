
import { DemandSnapshotResolver } from './deepDiveSnapshotResolvers';
import { SignalCorpusReader } from './signalCorpusReader';
import { SignalHarvesterClient, SignalDTO } from './signalHarvesterClient';
import { safeText } from '../utils/safety';
import { ENABLE_SIGNAL_CORPUS, DEEPDIVE_SIGNAL_LIMIT } from '../config/featureFlags';
import { DeepDiveInputBundleV2 } from '../types';
import { SnapshotResolver } from './snapshotResolver';
import { CategorySnapshotStore } from './categorySnapshotStore';
import { CERTIFIED_BENCHMARK } from '../certifiedBenchmark';

// --- Coverage Computer ---
function computeSignalCoverage(
    signals: DeepDiveInputBundleV2['signals']['items'],
    demandOk: boolean,
    keywordsOk: boolean,
    targetMonth: string,
    mode: string,
    anchorsCount: number,
    keywordRows: number
): DeepDiveInputBundleV2['coverage'] {
    const total = signals.length;
    let trusted = 0;
    let enrichedOk = 0;
    const platformCounts: Record<string, number> = {};
    const provenanceCounts: Record<string, number> = {};

    signals.forEach(s => {
        if (s.trusted) trusted++;
        if (s.enrichmentStatus === 'OK') enrichedOk++;
        
        const p = (s.platform || 'unknown').toLowerCase();
        platformCounts[p] = (platformCounts[p] || 0) + 1;
        
        const prov = s.provenance || 'unknown';
        provenanceCounts[prov] = (provenanceCounts[prov] || 0) + 1;
    });

    const platformMix = Object.entries(platformCounts)
        .map(([platform, count]) => ({ platform, count, pct: total > 0 ? (count / total) * 100 : 0 }))
        .sort((a, b) => b.count - a.count);

    const topProvenance = Object.entries(provenanceCounts)
        .map(([provenance, count]) => ({ provenance, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

    let dataCoverage: "OK" | "PARTIAL" | "BACKFILL" = "OK";
    if (total === 0) dataCoverage = "BACKFILL";
    else if (!demandOk || !keywordsOk) dataCoverage = "PARTIAL";
    else if (total < 20) dataCoverage = "PARTIAL";

    // Evidence Density: Do we have enough signals AND enough structure?
    const evidenceDensityReady = total >= 20 && (anchorsCount >= 6 || keywordRows >= 500);

    // Window logic inference
    const windowUsed = mode.includes('GLOBAL') ? 'GLOBAL_BACKFILL' : 'EXACT_MONTH';

    return {
        window: { monthKey: targetMonth, windowUsed },
        counts: {
            signalsTotal: total,
            signalsTrusted: trusted,
            signalsEnrichedOk: enrichedOk,
            signalsUsed: total,
            demandRows: null,
            keywordRows: keywordRows
        },
        ratios: {
            trustedPct: total > 0 ? (trusted / total) * 100 : 0,
            enrichedOkPct: total > 0 ? (enrichedOk / total) * 100 : 0
        },
        platformMix,
        topProvenance,
        gates: {
            dataCoverage,
            evidenceDensityReady
        },
        notes: [`Mode: ${mode}`, `Dropped: ${(total - trusted)} untrusted`]
    };
}

export const DeepDiveInputService = {

    async resolveAndBindInputs(categoryId: string, monthKey: string): Promise<DeepDiveInputBundleV2> {
        console.log(`[DEEPDIVE_INPUT] START category=${categoryId} month=${monthKey}`);
        
        const bundle: DeepDiveInputBundleV2 = {
            categoryId,
            monthKey,
            generatedAtIso: new Date().toISOString(),
            demand: { ok: false, snapshotId: null, lifecycle: null, metrics: null, reasonIfMissing: null },
            keywords: { ok: false, snapshotId: null, lifecycle: null, anchors: null, clusters: null, rowCount: null, reasonIfMissing: null },
            signals: { mode: 'NO_DATA', corpusSnapshotId: null, harvesterCollection: SignalHarvesterClient.getCollectionName(), items: [], reasonIfEmpty: null },
            coverage: {} as any // populated at end
        };

        // 1. Demand Resolution (with Benchmark Fallback)
        try {
            const demandRes = await DemandSnapshotResolver.resolve(categoryId, monthKey);
            let metricsSource: "sweep" | "benchmark" | "unresolved" | "corpus_only" = "unresolved";

            if (demandRes.ok && demandRes.data) {
                const sweep = demandRes.data;
                // Only consider it a sweep source if metrics are non-zero/valid
                if (sweep.demand_index_mn > 0) {
                     bundle.demand.metrics = {
                        demandIndex: sweep.demand_index_mn,
                        readiness: sweep.metric_scores?.readiness || 0,
                        spread: sweep.metric_scores?.spread || 0,
                        trend: sweep.trend_5y?.value_percent || null,
                        trendLabel: sweep.trend_5y?.trend_label || 'Unknown',
                        source: "sweep"
                    };
                    metricsSource = "sweep";
                }
                bundle.demand.snapshotId = demandRes.snapshotId || null;
                bundle.demand.lifecycle = demandRes.lifecycle || null;
            } 
            
            // Fallback: If metrics are still missing/zero, try Benchmark
            if (metricsSource === "unresolved") {
                // Try to find benchmark by ID first, then fallback to name mapping (rare)
                const bench = CERTIFIED_BENCHMARK.categories[categoryId]; 
                
                if (bench && bench.median.demandIndexMn > 0) {
                    console.log(`[DEEPDIVE_INPUT] Demand metrics missing in Sweep, using Benchmark fallback for ${categoryId}`);
                    bundle.demand.metrics = {
                        demandIndex: bench.median.demandIndexMn,
                        readiness: bench.median.readinessScore,
                        spread: bench.median.spreadScore,
                        trend: 10.0, // Benchmark default positive trend if unknown
                        trendLabel: 'Growing (Benchmark)',
                        source: "benchmark"
                    };
                    metricsSource = "benchmark";
                } else {
                    // CORPUS-FIRST FALLBACK
                    // If no demand source, we inject placeholders to allow qualitative analysis
                    console.log(`[DEEPDIVE_INPUT] Demand unresolved. Using Qualitative Placeholder.`);
                    bundle.demand.metrics = {
                        demandIndex: 0,
                        readiness: 0,
                        spread: 0,
                        trend: null,
                        trendLabel: 'Unknown',
                        source: "qualitative_corpus_scan"
                    };
                    metricsSource = "corpus_only";
                }
            }

            bundle.demand.ok = true; // Always OK now, but source differs
            if (metricsSource === "corpus_only") {
                 bundle.demand.reasonIfMissing = "Demand metrics missing. Running Qualitative Mode.";
            }

        } catch (e: any) {
            bundle.demand.reasonIfMissing = e.message;
            // Ensure we don't crash if resolve failed completely
            if (!bundle.demand.metrics) {
                 bundle.demand.metrics = {
                    demandIndex: 0,
                    readiness: 0,
                    spread: 0,
                    trend: null,
                    trendLabel: 'Unknown',
                    source: "qualitative_corpus_scan_error_fallback"
                };
                bundle.demand.ok = true;
            }
        }

        // 2. Keyword/Corpus Resolution
        try {
            const snapRes = await SnapshotResolver.resolveActiveSnapshot(categoryId, 'IN', 'en');
            if (snapRes.ok && snapRes.snapshot) {
                bundle.keywords.ok = true;
                bundle.keywords.snapshotId = snapRes.snapshot.snapshot_id;
                bundle.keywords.lifecycle = snapRes.snapshot.lifecycle;
                bundle.keywords.rowCount = snapRes.snapshot.stats.keywords_total;
                
                bundle.keywords.anchors = snapRes.snapshot.anchors.map(a => ({
                    id: a.anchor_id,
                    title: a.anchor_id,
                    keywords: [] 
                }));
            } else {
                bundle.keywords.reasonIfMissing = snapRes.reason || "No active keyword snapshot";
            }
        } catch (e: any) {
            bundle.keywords.reasonIfMissing = e.message;
        }

        // 3. Signals Resolution (Prioritize Corpus)
        let rawSignals: any[] = [];
        let usedCorpusId: string | null = null;
        
        // Priority A: Signal Corpus Snapshot
        try {
            const corpusRes = await SignalCorpusReader.loadSnapshot(categoryId, monthKey);
            if (corpusRes.ok && corpusRes.snapshot && corpusRes.snapshot.signalCount > 0) {
                bundle.signals.mode = 'CORPUS_SNAPSHOT';
                usedCorpusId = corpusRes.snapshot.id;
                bundle.signals.corpusSnapshotId = usedCorpusId;
                
                // Read chunks up to limit
                const chunksToRead = Math.ceil(DEEPDIVE_SIGNAL_LIMIT / 15);
                const maxChunks = corpusRes.snapshot.chunkCount || 0;
                const iterationLimit = Math.min(chunksToRead + 1, maxChunks); // +1 safety
                
                for (let i = 0; i < iterationLimit; i++) {
                    if (rawSignals.length >= DEEPDIVE_SIGNAL_LIMIT) break;
                    const chunk = await SignalCorpusReader.readChunk(corpusRes.snapshot.id, i);
                    if (chunk && chunk.signals) {
                        rawSignals.push(...chunk.signals);
                    }
                }
                console.log(`[DEEPDIVE_INPUT] Loaded ${rawSignals.length} from Corpus Snapshot ${usedCorpusId}.`);
            }
        } catch (e) {
            console.warn("[DEEPDIVE_INPUT] Corpus read failed", e);
        }
        

        // Priority B: Harvester Direct (Fallback if Corpus Empty)
        if (rawSignals.length === 0) {
            console.log("[DEEPDIVE_INPUT] Corpus empty, trying Harvester Direct...");
            try {
                const fetchRes = await SignalHarvesterClient.fetchHarvesterSignalsBounded({
                    categoryId,
                    monthKey, // Try exact month first inside fetcher
                    limit: DEEPDIVE_SIGNAL_LIMIT,
                    minTrustScore: 60,
                    maxPool: 200
                });
                
                if (fetchRes.signals.length > 0) {
                    bundle.signals.mode = 'HARVESTER_DIRECT';
                    rawSignals = fetchRes.signals;
                    
                    if (fetchRes.metadata.mode === 'INDEX_FAIL') {
                        bundle.coverage.notes = bundle.coverage.notes || [];
                        bundle.coverage.notes.push("INDEX_DEGRADED=true");
                    }
                } else {
                    bundle.signals.reasonIfEmpty = `Harvester returned 0. Mode: ${fetchRes.metadata.mode}`;
                }
            } catch (e: any) {
                bundle.signals.reasonIfEmpty = e.message;
            }
        }

        // Map Signals to V2 Item
        bundle.signals.items = rawSignals.slice(0, DEEPDIVE_SIGNAL_LIMIT).map(s => ({
            id: s.id || `sig_${Math.random()}`,
            title: safeText(s.title || "Untitled"),
            snippet: safeText(s.snippet || "").slice(0, 300),
            url: safeText(s.url || "#"),
            categoryId: s.categoryId || categoryId,
            platform: s.platform ? safeText(s.platform) : null,
            source: s.source || null,
            trustScore: s.trustScore || 0,
            confidence: s.confidence || 0,
            provenance: s.provenance || (usedCorpusId ? 'CORPUS' : 'HARVESTER'),
            firstSeenAt: s.firstSeenAt || null,
            lastSeenAt: s.lastSeenAt || null,
            collectedAt: s.collectedAt || null,
            enrichmentStatus: (s.enrichmentStatus || 'UNKNOWN') as any,
            trusted: !!s.trustScore && s.trustScore >= 50,
            signalType: 'generic' // Default for now
        }));

        // 4. Compute Coverage
        bundle.coverage = computeSignalCoverage(
            bundle.signals.items,
            bundle.demand.ok,
            bundle.keywords.ok,
            monthKey,
            bundle.signals.mode,
            bundle.keywords.anchors?.length || 0,
            bundle.keywords.rowCount || 0
        );

        return bundle;
    }
};
