
// BENCHMARK DATA (Audit: backtest_upload_1769418899090)
// Format: { d: DemandMn, r: Readiness, s: Spread }
export const BENCHMARK_TARGETS_1769418899090: Record<string, { d: number, r: number, s: number }> = {
    'shaving': { d: 4.28, r: 7.5, s: 6.3 },
    'beard': { d: 2.82, r: 6.9, s: 5.2 },
    'hair-styling': { d: 3.48, r: 7.2, s: 5.9 },
    'sexual-wellness': { d: 3.22, r: 9.0, s: 4.3 },
    'intimate-hygiene': { d: 1.82, r: 6.3, s: 5.6 },
    'hair-colour': { d: 5.18, r: 5.6, s: 7.1 },
    'face-care': { d: 6.05, r: 8.2, s: 7.9 },
    'deodorants': { d: 7.45, r: 7.9, s: 8.3 },
    'hair-oil': { d: 4.58, r: 6.5, s: 6.9 },
    'fragrance-premium': { d: 2.48, r: 8.3, s: 5.3 },
    'skincare-spec': { d: 1.88, r: 8.6, s: 4.9 },
    'shampoo': { d: 5.55, r: 6.1, s: 7.6 },
    'soap': { d: 6.85, r: 5.9, s: 7.3 },
    'body-lotion': { d: 3.25, r: 6.6, s: 6.1 },
    'talcum': { d: 2.12, r: 5.3, s: 5.9 },
    'oral-care': { d: 6.15, r: 6.0, s: 8.0 }
};

export const BenchmarkUploadStore = {
    // Legacy support for simple demand lookup
    getDemandMedians(auditId: string): Record<string, number> {
        if (auditId === "backtest_upload_1769418899090") {
            const out: Record<string, number> = {};
            for (const [k, v] of Object.entries(BENCHMARK_TARGETS_1769418899090)) {
                out[k] = v.d;
            }
            return out;
        }
        return {};
    },

    // Full targets accessor
    getBenchmarkTargets(auditId: string): Record<string, { d: number, r: number, s: number }> {
        if (auditId === "backtest_upload_1769418899090") {
            console.log(`[CALIB][BENCH_LOADED] auditId=${auditId} categories=${Object.keys(BENCHMARK_TARGETS_1769418899090).length}`);
            return BENCHMARK_TARGETS_1769418899090;
        }
        return {};
    }
};
