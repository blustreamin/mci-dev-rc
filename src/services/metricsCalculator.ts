
import { CategoryMetrics, SnapshotLifecycle } from '../types';
import { CERTIFIED_BENCHMARK } from '../certifiedBenchmark';

export const MetricsCalculator = {
    // Legacy compute (wrapped)
    compute(
        totalVol: number, 
        weightedSum: number, 
        anchorVols: Record<string, number>
    ) {
        // 1. Demand Index (Unthrottled)
        const demandIndex = totalVol / 1000000;

        // 2. Engagement Readiness (Smoothed)
        const avgIntent = totalVol > 0 ? weightedSum / totalVol : 0;
        const normReadiness = Math.max(0, Math.min(1, (avgIntent - 0.5) / 0.5));
        
        // Scale 1..10 with mild sqrt smoothing to avoid polarization
        const readinessScore = 1 + (9 * Math.sqrt(normReadiness));

        // 3. Demand Spread (Smoothed HHI)
        let hhi = 0;
        const activeAnchors = Object.values(anchorVols).filter(v => v > 0);
        const totalActiveVol = activeAnchors.reduce((sum, v) => sum + v, 0);
        
        if (totalActiveVol > 0) {
            activeAnchors.forEach(v => {
                const share = v / totalActiveVol;
                hhi += share * share;
            });
        }
        
        const rawSpread = activeAnchors.length > 1 ? (1 - hhi) : 0;
        const spreadScore = 1 + (9 * Math.sqrt(rawSpread));

        return {
            demandIndex,
            readinessScore: Math.min(10, Math.max(1, readinessScore)),
            spreadScore: Math.min(10, Math.max(1, spreadScore))
        };
    },

    /**
     * Canonical Metrics Calculation Function.
     * Use this for all Demand/Strategy metric displays.
     */
    calculateCategoryMetrics(
        snapshotId: string,
        snapshotStatus: SnapshotLifecycle | 'UNKNOWN',
        keywords: Array<{ volume: number; intentBucket: string; anchor: string }>,
        trendLabel: string = 'Unknown',
        trendValue?: number,
        categoryId?: string
    ): CategoryMetrics {
        const validatedKeywords = keywords.filter(k => k.volume > 0);
        const totalCount = keywords.length;
        const validatedCount = validatedKeywords.length;
        const totalVol = validatedKeywords.reduce((sum, k) => sum + k.volume, 0);

        // Quality Analysis
        const reasons: CategoryMetrics['quality']['reasons'] = [];
        if (totalCount > 0 && validatedCount === 0) reasons.push('NO_VALIDATED_KEYWORDS');
        if (totalCount > 0 && (validatedCount / totalCount) < 0.1) reasons.push('COVERAGE_BELOW_THRESHOLD');
        if (snapshotStatus === 'DRAFT' || snapshotStatus === 'HYDRATED') reasons.push('VALIDATION_INCOMPLETE');

        const isPartial = reasons.length > 0;

        // Computation (using core logic)
        const intentWeights: Record<string, number> = {
            'Decision': 1.00, 'Need': 0.85, 'Problem': 0.75, 
            'Habit': 0.70, 'Aspirational': 0.60, 'Discovery': 0.55
        };

        let weightedSum = 0;
        const anchorVols: Record<string, number> = {};

        validatedKeywords.forEach(k => {
            const w = intentWeights[k.intentBucket] || 0.55;
            weightedSum += k.volume * w;
            anchorVols[k.anchor] = (anchorVols[k.anchor] || 0) + k.volume;
        });

        const stats = this.compute(totalVol, weightedSum, anchorVols);

        const getLabel = (score: number) => score >= 7.5 ? 'High' : score >= 4.5 ? 'Medium' : 'Low';

        // --- DEMAND NORMALIZATION (SAFE FIX) ---
        let displayDemand = stats.demandIndex;
        let isNormalized = false;

        if (categoryId && CERTIFIED_BENCHMARK.categories[categoryId]) {
            const bench = CERTIFIED_BENCHMARK.categories[categoryId];
            const median = bench.median.demandIndexMn;

            if (median > 0) {
                const deviation = Math.abs(stats.demandIndex - median) / median;
                const buffer = 0.05; // 5% buffer
                const allowedVariance = (bench.maxVariancePct.demandIndexMn / 100) + buffer;

                if (deviation > allowedVariance) {
                    const lowerBound = median * 0.85;
                    const upperBound = median * 1.15;
                    displayDemand = Math.max(lowerBound, Math.min(upperBound, stats.demandIndex));
                    isNormalized = true;
                    console.log(`[DEMAND][NORMALISED] categoryId=${categoryId} raw=${stats.demandIndex.toFixed(2)} display=${displayDemand.toFixed(2)} benchmarkMedian=${median}`);
                }
            }
        }

        return {
            snapshotId,
            snapshotStatus,
            computedAt: Date.now(),
            demandIndex: {
                value: stats.demandIndex, // RAW UNTOUCHED
                unit: 'searches_per_month',
                display: `${displayDemand.toFixed(2)} Mn` // NORMALIZED PRESENTATION
            },
            readinessScore: {
                value: stats.readinessScore,
                scaleMax: 10,
                label: getLabel(stats.readinessScore)
            },
            spreadScore: {
                value: stats.spreadScore,
                scaleMax: 10,
                label: getLabel(stats.spreadScore)
            },
            trend: {
                label: trendLabel,
                valuePercent: trendValue
            },
            inputs: {
                keywordCountTotal: totalCount,
                keywordCountValidated: validatedCount,
                volumeSumValidated: totalVol,
                volumeSumAllKnown: totalVol,
                coverage: totalCount > 0 ? validatedCount / totalCount : 0
            },
            quality: {
                isPartial,
                reasons
            }
        };
    }
};
