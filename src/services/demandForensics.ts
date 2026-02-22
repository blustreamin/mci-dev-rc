
import { SweepResult, CertifiedBenchmarkV3, DemandForensicReport, DemandContractStatus, CategoryBenchmarkStats } from '../../types';

async function computeSHA256(msg: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(msg);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export const DemandForensics = {
    async validate(result: SweepResult, benchmark?: CertifiedBenchmarkV3 | null): Promise<DemandForensicReport> {
        const violations: DemandForensicReport['violations'] = [];
        let status: DemandContractStatus = 'VALID';

        // 1. Structure Check
        if (!result.category) {
            violations.push({ code: 'MISSING_KEY', path: 'category', message: 'Category key missing', severity: 'WARN' });
            status = 'INVALID';
        }

        // 2. Numeric Sanity
        if (!Number.isFinite(result.demand_index_mn)) {
            violations.push({ code: 'NAN_METRIC', path: 'demand_index_mn', message: 'Demand Index is not finite', severity: 'WARN' });
            status = 'INVALID';
        }
        if (!Number.isFinite(result.metric_scores?.readiness)) {
            violations.push({ code: 'NAN_METRIC', path: 'metric_scores.readiness', message: 'Readiness score is not finite', severity: 'WARN' });
            status = 'INVALID';
        }
        if (!Number.isFinite(result.metric_scores?.spread)) {
            violations.push({ code: 'NAN_METRIC', path: 'metric_scores.spread', message: 'Spread score is not finite', severity: 'WARN' });
            status = 'INVALID';
        }

        // 3. Trend Label Check
        const validTrends = ['Growing', 'Stable', 'Declining', 'Unknown', 'n/a'];
        const label = result.trend_5y?.trend_label || 'n/a';
        let normalizedLabel: any = label;
        
        if (!validTrends.includes(label as string)) {
            violations.push({ 
                code: 'INVALID_ENUM', 
                path: 'trend_5y.trend_label', 
                message: `Value '${label}' not in allowed set: ${validTrends.join(', ')}`, 
                severity: 'WARN' 
            });
            status = 'INVALID';
            normalizedLabel = 'n/a';
        }

        // 4. STRICT STANDARD CANDLE CHECK (Soap)
        const isSoapCategory = result.category.includes('Soap') && result.category.includes('Body Wash');
        
        if (isSoapCategory) {
            const index = result.demand_index_mn;
            if (index < 99.0 || index > 101.0) {
                violations.push({
                    code: 'STANDARD_CANDLE_DRIFT',
                    path: 'demand_index_mn',
                    message: `Standard Candle Drift: Soap Index is ${index.toFixed(2)}, expected 100.0`,
                    severity: 'WARN'
                });
                status = 'INVALID';
            }
        }

        // 5. Hash Computation
        const canonical = {
            version: "demand_contract_v1",
            category_key: result.category || 'unknown',
            demand_index_mn: result.demand_index_mn,
            engagement_readiness: result.metric_scores?.readiness,
            demand_spread: result.metric_scores?.spread,
            trend_label: label
        };
        
        const hash = await computeSHA256(JSON.stringify(canonical));

        // 6. Benchmark Deltas
        let benchData: DemandForensicReport['benchmark'] = undefined;
        
        if (benchmark) {
            const bCat = Object.values(benchmark.categories).find((c: CategoryBenchmarkStats) => 
                c.categoryId.toLowerCase() === result.category.toLowerCase()
            ) as CategoryBenchmarkStats | undefined;

            if (bCat) {
                const d = result.demand_index_mn;
                const r = result.metric_scores.readiness;
                const s = result.metric_scores.spread;
                
                // Fixed: Explicit cast to satisfy bCat metrics existence
                const bd = bCat.median.demandIndexMn;
                const br = bCat.median.readinessScore;
                const bs = bCat.median.spreadScore;

                benchData = {
                    benchmark_id: benchmark.id || 'unknown',
                    certified_at_iso: benchmark.certifiedAtISO || new Date().toISOString(),
                    runs: bCat.iterations,
                    deltas: {
                        demand_index_pct: bd ? ((d - bd) / bd) * 100 : null,
                        engagement_pct: br ? ((r - br) / br) * 100 : null,
                        spread_pct: bs ? ((s - bs) / bs) * 100 : null,
                    }
                };
            }
        }

        return {
            version: "demand_contract_v1",
            category_key: result.category,
            run_id: result.runId,
            created_at_iso: new Date().toISOString(),
            contract_hash: hash,
            contract_status: status,
            violations,
            raw_metrics: {
                demand_index_mn: result.demand_index_mn,
                engagement_readiness: result.metric_scores?.readiness,
                demand_spread: result.metric_scores?.spread,
                trend_label: label
            },
            normalized_display: {
                trend_label: normalizedLabel
            },
            benchmark: benchData,
            notes: ["Soft contract: non-blocking", "No gating enforced"]
        };
    }
};
