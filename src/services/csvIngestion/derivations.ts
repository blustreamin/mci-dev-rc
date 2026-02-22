
export const Derivations = {
    
    /**
     * Parses volume string to number or null.
     * Rules:
     * - null/undefined/empty -> null
     * - "-" / "N/A" / "null" -> null
     * - Strip quotes, commas, spaces
     * - Non-finite -> null
     * - Less than or equal to 0 -> null (Strict Requirement)
     * - Otherwise positive integer
     */
    parseVolume(raw: any): number | null {
        if (raw === null || raw === undefined) return null;
        
        const str = String(raw).trim();
        if (str === '' || str === '-' || str.toLowerCase() === 'n/a' || str.toLowerCase() === 'null') {
            return null;
        }

        // Fix: Remove commas and quotes explicitly before casting
        const clean = str.replace(/["',]/g, '');
        
        const val = Number(clean);
        
        if (!Number.isFinite(val)) return null;
        
        // Strict Gate: Must be positive. 0 is not a valid demand signal for our Strategy.
        if (val <= 0) return null;
        
        return Math.round(val);
    },

    parseVolumeStrict(raw: any): number | null {
        return this.parseVolume(raw);
    },

    computeBaseVolume(monthlyValues: number[]): number {
        if (monthlyValues.length === 0) return 0;
        // Last 12 months average for stability
        const window = monthlyValues.slice(-12);
        const sum = window.reduce((a, b) => a + b, 0);
        return Math.round(sum / window.length);
    },

    computeTrend5y(monthlyValues: number[]): { value_percent: number | null; label: string } {
        // Need at least 24 months to call it a meaningful trend, but we calculate what we can.
        if (monthlyValues.length < 24) return { value_percent: null, label: 'Unknown' };
        
        // Use up to 60 months (5 years)
        const endIndex = monthlyValues.length - 1;
        const startIndex = Math.max(0, endIndex - 60);
        
        const getSmoothed = (idx: number) => {
            const s = Math.max(0, idx - 2); // 3-month smoothing
            const e = Math.min(monthlyValues.length, idx + 1);
            const slice = monthlyValues.slice(s, e);
            if (slice.length === 0) return 0;
            return slice.reduce((a, b) => a + b, 0) / slice.length;
        };

        const startVal = getSmoothed(startIndex);
        const endVal = getSmoothed(endIndex);
        
        // Edge Case: Start Zero
        if (startVal <= 0.1) { // Floating point safety
            if (endVal > 0.1) {
                return { value_percent: null, label: 'Growing' }; // Infinite growth
            }
            // Both zero
            return { value_percent: 0, label: 'Stable' };
        }

        // Edge Case: End Zero (while start > 0)
        if (endVal <= 0.1) {
            return { value_percent: -100, label: 'Declining' };
        }

        const growthPct = ((endVal / startVal) - 1) * 100;
        const finalVal = parseFloat(growthPct.toFixed(1));

        let label = 'Stable';
        if (finalVal >= 10) label = 'Growing';
        if (finalVal <= -10) label = 'Declining';

        return { value_percent: finalVal, label };
    }
};
