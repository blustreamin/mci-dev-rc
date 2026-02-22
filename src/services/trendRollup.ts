
import { VolumeTruthStore } from './volumeTruthStore';
import { TrendLabel, Trend5yOutput } from '../../types';

export const TrendRollupService = {
    
    async rollupTrend5y(
        windowId: string,
        keywordKeys: string[],
        resolvedVolumes: Map<string, { volume: number }>
    ): Promise<Trend5yOutput> {
        
        let weightedSum = 0;
        let volumeSum = 0;
        let countWithTrend = 0;
        
        // 1. Fetch Truth for all keywords to access trend metrics
        // We do this individually to ensure we are getting the exact record for the window.
        
        const trendData = await Promise.all(keywordKeys.map(async (key) => {
            const truth = await VolumeTruthStore.getTruthVolume(key, windowId);
            return {
                key,
                truth
            };
        }));

        // 2. Aggregate
        for (const { key, truth } of trendData) {
            // Check if trend5y exists in derived metrics
            const trendVal = truth?.derivedMetrics?.trend5y;
            
            // "If the store doesn’t have 5y but has only 6m, DO NOT substitute"
            if (typeof trendVal === 'number') {
                countWithTrend++;
                
                const vol = resolvedVolumes.get(key)?.volume || 0;
                if (vol > 0) {
                    weightedSum += trendVal * vol;
                    volumeSum += vol;
                }
            }
        }

        // 3. Compute Metrics
        const totalKeys = keywordKeys.length;
        const coverage = totalKeys > 0 ? countWithTrend / totalKeys : 0;
        
        // "WeightedAvg = sum(trendPercent_i * truthVolume_i) / sum(truthVolume_i)"
        let finalValue: number | null = null;
        if (volumeSum > 0) {
            finalValue = parseFloat((weightedSum / volumeSum).toFixed(1));
        }

        // 4. Labeling
        // "If value_percent is null OR coverage < 0.6 => trend_label = 'Unknown'"
        let label: TrendLabel = 'Unknown';
        
        if (finalValue !== null && coverage >= 0.6) {
            if (finalValue >= 25.0) label = 'Strong Up';
            else if (finalValue >= 10.0) label = 'Growing';
            else if (finalValue > -10.0) label = 'Stable'; // -9.9 to +9.9
            else if (finalValue > -25.0) label = 'Declining';   // -10.0 to -24.9
            else label = 'Strong Down';                    // <= -25.0
        } else {
            // Force null if conditions not met for validity
            finalValue = null; 
            label = 'Unknown';
        }

        return {
            value_percent: finalValue,
            trend_label: label,
            source: 'TruthStore:trend5y_percent',
            coverage: parseFloat(coverage.toFixed(2)),
            windowId,
            keywordCountTotal: totalKeys,
            keywordCountWithTrend: countWithTrend,
            method: finalValue !== null ? 'VOL_WEIGHTED_AVG' : 'UNKNOWN',
            period: '5 Year',
            timestamp: new Date().toISOString()
        };
    }
};