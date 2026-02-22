
import { SweepResult } from '../types';
import { safeNum } from '../utils/safety';

export const DemandMetricsAdapter = {
    /**
     * Extracts the canonical Demand Index (Mn) for display and plotting.
     * Prioritizes Normalized Metrics V2 (Display Value) if available to match Cards/Tables.
     * Falls back to Raw Value (Legacy) if V2 is missing.
     */
    getDemandIndexMn(result: SweepResult): number {
        // Priority 0: ABS_V3 Absolute Metrics
        // Fixed: result type now contains ABS_V3 properties
        if (result.metricsVersion === "ABS_V3" && typeof result.demandIndexMn === 'number') {
            return result.demandIndexMn;
        }

        // Priority 1: Normalized Display Value (V3/V2 Logic) from metrics_v2
        if (result.metrics_v2?.demandIndex?.display) {
            const parts = result.metrics_v2.demandIndex.display.split(' ');
            const val = parseFloat(parts[0]);
            if (!isNaN(val)) return val;
        }
        
        // Priority 2: Raw Value (Legacy)
        return safeNum(result.demand_index_mn);
    },

    /**
     * Formats the number back to the standard display string.
     */
    formatMn(n: number): string {
        const val = safeNum(n);
        return `${val.toFixed(2)} Mn`;
    }
};
