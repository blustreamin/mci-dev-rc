
import { CategoryMetrics, SnapshotLifecycle } from '../types';
import { CERTIFIED_BENCHMARK } from '../certifiedBenchmark';
import { getCalibratedDemand, getCalibratedReadiness, getCalibratedSpread } from './demandBenchmarkCalibration';

export const MetricsCalculator = {
    // Legacy compute (wrapped)
    compute(
        totalVol: number, 
        weightedSum: number, 
        anchorVols: Record<string, number>
    ) {
        // 1. Demand Index (Total Validated Volume)
        const demandIndex = totalVol / 1000000;

        // 2. Engagement Readiness (Smoothed)
        const avgIntent = totalVol > 0 ? weightedSum / totalVol : 0;
        const normReadiness = Math.max(0, Math.min(1, (avgIntent - 0.5) / 0.5));
        
        // Scale 1..10 with mild sqrt smoothing to avoid polarization
        const readinessScore = 1 + (9 * Math.sqrt(normReadiness));

        // 3. Demand Spread (Top3-Based, per presentation formula)
        // Spread = 10 × (1 − Top3_share)
        const activeAnchors = Object.values(anchorVols).filter(v => v > 0);
        const totalActiveVol = activeAnchors.reduce((sum, v) => sum + v, 0);
        
        let spreadScore = 1;
        if (totalActiveVol > 0 && activeAnchors.length > 1) {
            // Sort descending and take top 3 shares
            const shares = activeAnchors
                .map(v => v / totalActiveVol)
                .sort((a, b) => b - a);
            const top3Share = shares.slice(0, 3).reduce((s, v) => s + v, 0);
            spreadScore = 10 * (1 - top3Share);
            // Clamp to 1-10
            spreadScore = Math.max(1, Math.min(10, spreadScore));
        }

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
        // Intent weights aligned with presentation formula:
        // Urgent/Transaction = 1.0, Research/Evaluation = 0.7, Browse/Info = 0.4
        const intentWeights: Record<string, number> = {
            'Decision': 1.00,
            'Consideration': 0.70, 'Need': 0.70, 'Problem': 0.70,
            'Habit': 0.40, 'Aspirational': 0.40, 'Discovery': 0.40
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

        // --- BENCHMARK CALIBRATION (per presentation methodology) ---
        let displayDemand = stats.demandIndex;
        let displayReadiness = stats.readinessScore;
        let displaySpread = stats.spreadScore;
        
        if (categoryId) {
            displayDemand = getCalibratedDemand(categoryId, stats.demandIndex);
            displayReadiness = getCalibratedReadiness(categoryId, stats.readinessScore);
            displaySpread = getCalibratedSpread(categoryId, stats.spreadScore);
            console.log(`[DEMAND][CALIBRATED] ${categoryId} raw=${stats.demandIndex.toFixed(2)} calibrated=${displayDemand.toFixed(2)} readiness=${displayReadiness.toFixed(1)} spread=${displaySpread.toFixed(1)}`);
        }

        // Derived metrics per presentation
        const trendMultiplier = (trendValue || 0) / 100;
        const demandOverTimeGrowth = displayDemand * trendMultiplier;
        const demandOverTime = displayDemand + demandOverTimeGrowth;
        const buyingIntentIndex = displaySpread > 0 ? displayReadiness / displaySpread : 0;

        return {
            snapshotId,
            snapshotStatus,
            computedAt: Date.now(),
            demandIndex: {
                value: stats.demandIndex, // RAW (CAV-based)
                unit: 'searches_per_month',
                display: `${displayDemand.toFixed(2)} Mn` // Calibrated
            },
            readinessScore: {
                value: displayReadiness,
                scaleMax: 10,
                label: getLabel(displayReadiness)
            },
            spreadScore: {
                value: displaySpread,
                scaleMax: 10,
                label: getLabel(displaySpread)
            },
            trend: {
                label: trendLabel,
                valuePercent: trendValue
            },
            demandOverTime: {
                growth: demandOverTimeGrowth,
                total: demandOverTime
            },
            buyingIntentIndex: {
                value: buyingIntentIndex
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
