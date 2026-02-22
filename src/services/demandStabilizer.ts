
// Demand Stabilization Engine v2.2
// "Safe Mode" Overrides Removed.
// Now acts as a pass-through normalization layer for Real-Time Deterministic Math.

export const SOAP_ANCHOR_DEMAND = 6.90;

// Deprecated Hardcoded Map (Kept for archival/rollback references if needed)
const _DEPRECATED_CATEGORY_METRICS_MAP: Record<string, { baseline: number, readinessTier: 'A'|'B'|'C'|'D', spreadBand: 'HIGH'|'MEDIUM'|'LOW', trend: 'Growing'|'Stable'|'Declining' }> = {
    'shaving': { baseline: 4.35, readinessTier: 'B', spreadBand: 'MEDIUM', trend: 'Stable' },
    'beard': { baseline: 2.90, readinessTier: 'B', spreadBand: 'MEDIUM', trend: 'Growing' },
    'hair-styling': { baseline: 3.55, readinessTier: 'B', spreadBand: 'MEDIUM', trend: 'Growing' },
    'sexual-wellness': { baseline: 3.30, readinessTier: 'A', spreadBand: 'MEDIUM', trend: 'Growing' },
    'intimate-hygiene': { baseline: 1.90, readinessTier: 'B', spreadBand: 'MEDIUM', trend: 'Growing' },
    'hair-colour': { baseline: 5.25, readinessTier: 'C', spreadBand: 'MEDIUM', trend: 'Stable' },
    'face-care': { baseline: 6.15, readinessTier: 'A', spreadBand: 'HIGH', trend: 'Growing' },
    'deodorants': { baseline: 7.55, readinessTier: 'C', spreadBand: 'HIGH', trend: 'Growing' },
    'hair-oil': { baseline: 4.65, readinessTier: 'C', spreadBand: 'HIGH', trend: 'Stable' },
    'fragrance-premium': { baseline: 2.55, readinessTier: 'B', spreadBand: 'MEDIUM', trend: 'Growing' },
    'skincare-spec': { baseline: 1.95, readinessTier: 'A', spreadBand: 'HIGH', trend: 'Growing' },
    'shampoo': { baseline: 5.65, readinessTier: 'C', spreadBand: 'LOW', trend: 'Stable' },
    'soap': { baseline: 6.95, readinessTier: 'C', spreadBand: 'LOW', trend: 'Stable' },
    'body-lotion': { baseline: 3.35, readinessTier: 'C', spreadBand: 'MEDIUM', trend: 'Stable' },
    'talcum': { baseline: 2.20, readinessTier: 'C', spreadBand: 'LOW', trend: 'Declining' },
    'oral-care': { baseline: 6.25, readinessTier: 'C', spreadBand: 'LOW', trend: 'Stable' }
};

export interface StableMetrics {
    demandIndexMn: number;
    anchor_ratio_vs_soap: number;
    readinessScore: number; // 0-10 scale
    readinessTier: string;
    spreadScore: number; // 0-10 scale
    trend5yLabel: 'Growing' | 'Stable' | 'Declining' | 'Unknown';
    engagementReadinessLabel: string;
    demandSpreadLabel: string;
}

export interface InputMetrics {
    demandIndex: number;
    readiness: number;
    spread: number;
    trendLabel: string;
}

export function computeStableDemandMetrics(categoryId: string, inputs: InputMetrics): StableMetrics {
    // PASS-THROUGH LOGIC (Real-Time Mode)
    // We strictly use the calculated inputs provided by the deterministic engine.
    // No lookups to _DEPRECATED_CATEGORY_METRICS_MAP.

    const { demandIndex, readiness, spread, trendLabel } = inputs;

    // Normalize Labels dynamically based on real-time scores
    const readinessLabel = readiness >= 7.8 ? 'High' : readiness >= 6.5 ? 'Medium' : 'Low';
    const spreadLabel = spread >= 6.2 ? 'High' : 'Low';
    
    // Calculate Ratio vs Soap Standard Candle dynamically
    // (Assuming inputs.demandIndex is correctly scaled to Mn)
    const ratio = demandIndex / SOAP_ANCHOR_DEMAND;

    return {
        demandIndexMn: demandIndex,
        anchor_ratio_vs_soap: ratio,
        readinessScore: readiness,
        readinessTier: 'Dynamic', // Legacy field placeholder
        spreadScore: spread,
        trend5yLabel: (trendLabel as any) || 'Unknown',
        engagementReadinessLabel: readinessLabel,
        demandSpreadLabel: spreadLabel
    };
}
