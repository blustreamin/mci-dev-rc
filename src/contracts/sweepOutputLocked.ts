
import { SweepResult } from '../types';

/**
 * LOCKED CONTRACT V1
 * This object defines the EXACT structural requirement for a valid Sweep Output.
 * Values are placeholders (type indicators), but the KEYS and HIERARCHY are the contract.
 */
export const LOCKED_SWEEP_V1_SAMPLE: SweepResult = {
    category: "string",
    demand_index_mn: 0,
    metric_scores: { readiness: 0, spread: 0 },
    engagement_readiness: "string",
    demand_spread: "string",
    trend_5y: {
        value_percent: 0,
        trend_label: "Stable", // Literal type match
        source: "string",
        coverage: 0,
        windowId: "string",
        keywordCountTotal: 0,
        keywordCountWithTrend: 0,
        method: "VOL_WEIGHTED_AVG",
        period: "string",
        timestamp: "string"
    },
    anchors: [
        {
            id: "string",
            term: "string",
            total_volume: 0,
            cluster_count: 0,
            clusters: [
                {
                    cluster_name: "string",
                    cluster_volume: 0,
                    est_monthly_impressions: 0,
                    avg_ctr: 0,
                    intent_profile: {},
                    keywords: [
                        {
                            term: "string",
                            avg_monthly_volume: 0,
                            est_monthly_impressions: 0,
                            est_ctr: 0,
                            intent_bucket: "string",
                            is_winner: false,
                            volume_used_for_index: 0,
                            anchor: "string",
                            status: "string"
                        }
                    ]
                }
            ],
            dominant_intent_mix: {}
        }
    ],
    synthesis: {
        key_takeaway: "string",
        summary_statement: "string",
        early_outlook: "string"
    },
    analyst_insight: ["string"],
    runId: "string",
    // cacheKey: "string", // Removed to match SweepResult interface
    methodologyVersion: "string",
    indexSource: "string",
    resolvedCoverage: 0,
    unresolvedPercent: 0,
    zeroVolumePercent: 0,
    totalKeywordsInput: 0,
    totalKeywordsResolved: 0,
    totalKeywordsUsedInMetrics: 0,
    resolvedKeywordCount: 0,
    activeAnchorsCount: 0,
    zeroVolumeAnchorsCount: 0,
    isFailedDataQuality: false,
    liveAlignment: {
        status: "ALIGNED",
        deltas: {
            demandIndexPct: 0,
            readinessDiff: 0,
            spreadDiff: 0
        },
        benchmarkId: "string"
    },
    demandAudit: {
        totalKeywordsInput: 0,
        resolvedKeywordCount: 0,
        zeroVolumeCount: 0,
        anchorVolumes: [{
            anchorName: "string",
            totalVolume: 0,
            keywordCount: 0,
            resolvedCount: 0
        }],
        strategyHashUsed: "string"
    }
} as any; // Cast as any to allow liveAlignment structure

export const LOCKED_CONTRACT_VERSION = "LOCKED_SWEEP_V1";
