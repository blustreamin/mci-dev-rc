
import { SnapshotKeywordRow, SweepResult, DemandMetricsV4 } from '../types';

export const MetricsCalculatorV4 = {
    /**
     * Compute Normalized Demand Metrics (V4).
     * Strictly Google-volume only.
     * Deterministic output.
     */
    calculate(
        categoryId: string, 
        rows: SnapshotKeywordRow[], 
        v3Context: SweepResult
    ): DemandMetricsV4 {
        
        // 1. FILTERING & INPUTS
        // strict filter: active=true AND volume>0 (Google Volume)
        const validRows = rows.filter(r => r.active && (r.volume || 0) > 0);
        
        const inputs = {
            volumeFieldUsed: "google_volume" as const,
            keywordCountTotal: rows.length,
            keywordCountNonZero: validRows.length,
            anchorCountTotal: v3Context.anchors ? v3Context.anchors.length : 0,
            anchorCountActive: new Set(validRows.map(r => r.anchor_id)).size
        };

        const warnings: string[] = [];
        if (validRows.length < 20) warnings.push("Low data density (<20 valid keywords)");

        // 2. NORMALIZED DEMAND INDEX (0-100)
        // Method: Log-10 transform with Winsorized bounds
        const totalVol = validRows.reduce((sum, r) => sum + (r.volume || 0), 0);
        const absMn = totalVol / 1_000_000;
        
        // Config for Normalization
        // Using static bounds for stability across runs/categories without needing a global pass
        // p05 = 0.01 Mn (10k vol), p95 = 10.0 Mn
        const floor = 0.001; 
        const p05 = -2; // log10(0.01)
        const p95 = 1;  // log10(10)

        // Safe log calc: if volume is 0, demand score is 0
        let demandScore = 0;
        if (totalVol > 0) {
            const val = Math.max(absMn, floor);
            const logVal = Math.log10(val);
            // Normalize 0-1
            let normDemand = (logVal - p05) / (p95 - p05);
            normDemand = Math.max(0, Math.min(1, normDemand));
            demandScore = parseFloat((normDemand * 100).toFixed(1));
        }

        // 3. ENGAGEMENT READINESS (0-5)
        // Components: NonZero Rate, Action Intent, Premium Signals
        
        // A. NonZero Rate
        // Bounded to 1.0 max even if subset logic is weird (though filter ensures validRows is subset)
        const nonZeroRate = rows.length > 0 ? (validRows.length / rows.length) : 0;
        
        let actionShare = 0;
        let premiumShare = 0;

        if (validRows.length > 0) {
            // B. Action Intent Share
            // Buckets: Decision, Consideration, Need, Problem -> ACTION
            const actionBuckets = new Set(['Decision', 'Consideration', 'Need', 'Problem', 'Transaction', 'Local']);
            const actionCount = validRows.filter(r => actionBuckets.has(r.intent_bucket || 'Discovery')).length;
            actionShare = actionCount / validRows.length;

            // C. Premium Signal Share
            const premiumRegex = /\b(price|review|best|top|near me|buy|cost|vs|compare|shop|store)\b/i;
            const premiumCount = validRows.filter(r => premiumRegex.test(r.keyword_text)).length;
            premiumShare = premiumCount / validRows.length;
        }

        // Weighted Sum
        // Weights: 0.45 Density + 0.40 Action + 0.15 Premium
        // Even if validRows=0, readinessScore becomes 0 which is safe.
        const rawReadiness = (0.45 * nonZeroRate) + (0.40 * actionShare) + (0.15 * premiumShare);
        const readinessScore = parseFloat(Math.max(0, Math.min(5, rawReadiness * 5)).toFixed(1));

        let readinessLabel: DemandMetricsV4['readiness']['label'] = "Low";
        if (readinessScore >= 4.3) readinessLabel = "Very High";
        else if (readinessScore >= 3.1) readinessLabel = "High";
        else if (readinessScore >= 1.6) readinessLabel = "Medium";

        // 4. DEMAND SPREAD (0-5)
        // Components: HHI, Entropy, Coverage
        
        let hhi = 0;
        let entropy = 0;
        let coverage = 0;

        // Group volumes by anchor
        const anchorVols: Record<string, number> = {};
        validRows.forEach(r => {
            const a = r.anchor_id || "Unknown";
            anchorVols[a] = (anchorVols[a] || 0) + (r.volume || 0);
        });
        
        const anchorKeys = Object.keys(anchorVols);
        const nAnchors = Math.max(1, anchorKeys.length); // Avoid div/0
        const totalSnapshotAnchors = v3Context.anchors ? v3Context.anchors.length : nAnchors;

        if (totalVol > 0) {
            const shares = anchorKeys.map(k => anchorVols[k] / totalVol); 

            // A. HHI (Concentration) -> Invert for Spread
            hhi = shares.reduce((sum, s) => sum + (s*s), 0);
            
            // B. Entropy (Randomness)
            // Normalized Entropy: -sum(p ln p) / ln(N)
            if (nAnchors > 1) {
                const rawEntropy = -shares.reduce((sum, s) => sum + (s > 0 ? s * Math.log(s) : 0), 0);
                entropy = rawEntropy / Math.log(nAnchors);
            }

            // C. Anchor Coverage (completeness relative to total known anchors in snapshot)
            coverage = nAnchors / Math.max(1, totalSnapshotAnchors);
        } else {
             warnings.push("V4_SPREAD_TOTALVOL_ZERO: defaulting spread metrics to 0 (Concentrated).");
        }

        // Weighted Sum
        // High Spread = Low HHI, High Entropy, High Coverage
        // Weights: 0.55 * (1-HHI) + 0.35 * Entropy + 0.10 * Coverage
        // If volume 0, HHI=0, Entropy=0, Coverage=0 -> Raw=0.55.
        // Wait, if no volume, HHI is undefined conceptually (100% concentrated or 0?).
        // If totalVol=0, spread should ideally be 0 (Concentrated).
        // Let's force rawSpread to 0 if totalVol is 0 to reflect "No Spread".
        
        let rawSpread = 0;
        if (totalVol > 0) {
             rawSpread = (0.55 * (1 - hhi)) + (0.35 * entropy) + (0.10 * coverage);
        }
        const spreadScore = parseFloat(Math.max(0, Math.min(5, rawSpread * 5)).toFixed(1));

        let spreadLabel: DemandMetricsV4['spread']['label'] = "Concentrated";
        if (spreadScore >= 3.4) spreadLabel = "Fragmented";
        else if (spreadScore >= 1.8) spreadLabel = "Balanced";

        // 5. ASSEMBLE
        return {
            version: "v4.0-normalized",
            computedAt: new Date().toISOString(),
            inputs,
            demand: {
                absolute_mn: parseFloat(absMn.toFixed(4)),
                normalized_index_0_100: demandScore,
                normalization: {
                    method: "winsor_log_minmax",
                    p05, p95, logBase: 10, floor
                }
            },
            readiness: {
                score_0_5: readinessScore,
                label: readinessLabel,
                method: "intent_weighted_nonzero",
                components: {
                    nonZeroRate_0_1: parseFloat(nonZeroRate.toFixed(3)),
                    actionIntentShare_0_1: parseFloat(actionShare.toFixed(3)),
                    premiumSignalShare_0_1: parseFloat(premiumShare.toFixed(3))
                }
            },
            spread: {
                score_0_5: spreadScore,
                label: spreadLabel,
                method: "hhI_entropy_blend",
                components: {
                    hhi_0_1: parseFloat(hhi.toFixed(3)),
                    entropy_0_1: parseFloat(entropy.toFixed(3)),
                    anchorCoverage_0_1: parseFloat(coverage.toFixed(3))
                }
            },
            diagnostics: {
                warnings
            }
        };
    }
};
