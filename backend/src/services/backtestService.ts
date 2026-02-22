
import { Pool } from 'pg';

// In a real repo, we would import this. Redefining for isolation/context here.
const DEMAND_SWEEP_CONTRACT = {
  intentWeights: {
    'Decision': 1.00, 'Need': 0.85, 'Problem': 0.75, 
    'Habit': 0.70, 'Aspirational': 0.60, 'Discovery': 0.55
  }
} as const;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

interface MetricSet {
    canonical_keyword: string;
    avg_monthly_volume: number;
    anchor: string;
    intent_bucket: string;
}

interface RollupResult {
    demandIndex: number;
    readinessScore: number;
    spreadScore: number;
}

export const BacktestService = {
    
    // PURE FUNCTION: Core Logic
    compute(metrics: MetricSet[]): RollupResult {
        let totalVol = 0;
        const anchorVols: Record<string, number> = {};
        let weightedIntentSum = 0;

        for (const m of metrics) {
            const vol = m.avg_monthly_volume;
            totalVol += vol;

            anchorVols[m.anchor] = (anchorVols[m.anchor] || 0) + vol;

            const intentKey = m.intent_bucket as keyof typeof DEMAND_SWEEP_CONTRACT.intentWeights;
            const weight = DEMAND_SWEEP_CONTRACT.intentWeights[intentKey] || 0.55;
            weightedIntentSum += vol * weight;
        }

        const demandIndex = totalVol / 1000000;

        const rawReadiness = totalVol > 0 ? weightedIntentSum / totalVol : 0.55;
        const readinessScore = Math.min(10, Math.max(1, 1 + ((rawReadiness - 0.55) / 0.45) * 9));

        let hhi = 0;
        Object.values(anchorVols).forEach(v => {
            const share = totalVol > 0 ? v / totalVol : 0;
            hhi += share * share;
        });
        const spreadScore = (1 - hhi) * 10;

        return { demandIndex, readinessScore, spreadScore };
    },

    async runDeterministicReplay(datasetId: number, iterations: number) {
        // 1. Fetch Immutable Evidence
        const rawRes = await pool.query(`
            SELECT m.canonical_keyword, m.avg_monthly_volume, r.anchor, r.intent_bucket
            FROM metric_volumes m
            JOIN dataset_versions d ON m.dataset_id = d.id
            JOIN registry_entries r ON d.registry_id = r.registry_id AND m.canonical_keyword = r.canonical_keyword
            WHERE d.id = $1
        `, [datasetId]);

        if (rawRes.rows.length === 0) throw new Error(`Dataset ${datasetId} not found or empty.`);
        const inputData: MetricSet[] = rawRes.rows;

        // 2. Fetch Stored Baseline
        const storedRes = await pool.query('SELECT * FROM category_rollups WHERE dataset_id = $1', [datasetId]);
        if (storedRes.rows.length === 0) throw new Error(`No rollups found for ${datasetId}`);
        const baseline = storedRes.rows[0];

        // 3. Execution Loop
        const results: RollupResult[] = [];
        
        for (let i = 0; i < iterations; i++) {
            results.push(this.compute(inputData));
        }

        // 4. Analysis
        // We use a small epsilon for float comparison safety, though they should be identical
        const EPSILON = 0.0000001;
        const variances = results.map(r => ({
            demand: Math.abs(r.demandIndex - parseFloat(baseline.demand_index_mn)),
            readiness: Math.abs(r.readinessScore - parseFloat(baseline.readiness_score)),
            spread: Math.abs(r.spreadScore - parseFloat(baseline.spread_score))
        }));

        const maxVariance = Math.max(
            ...variances.map(v => Math.max(v.demand, v.readiness, v.spread))
        );

        const passed = maxVariance < EPSILON;

        return {
            testType: 'DETERMINISTIC_REPLAY',
            datasetId,
            iterations,
            status: passed ? 'PASS' : 'FAIL',
            stats: {
                maxVarianceAbs: maxVariance,
            },
            baseline: {
                demand: parseFloat(baseline.demand_index_mn),
                readiness: parseFloat(baseline.readiness_score),
                spread: parseFloat(baseline.spread_score)
            },
            sampleReplay: results[0]
        };
    },

    async verifyComparability(idA: number, idB: number) {
        const query = `
            SELECT d.id, d.methodology_version, d.geo_target, r.version_hash
            FROM dataset_versions d
            JOIN registry_versions r ON d.registry_id = r.id
            WHERE d.id IN ($1, $2)
        `;
        const res = await pool.query(query, [idA, idB]);
        const dsA = res.rows.find(r => r.id === idA);
        const dsB = res.rows.find(r => r.id === idB);

        if (!dsA || !dsB) throw new Error("Dataset not found");

        const checks = {
            registryMatch: dsA.version_hash === dsB.version_hash,
            methodologyMatch: dsA.methodology_version === dsB.methodology_version,
            geoMatch: dsA.geo_target === dsB.geo_target
        };

        const isComparable = Object.values(checks).every(Boolean);

        return {
            testType: 'COMPARABILITY_CHECK',
            datasets: [idA, idB],
            checks,
            verdict: isComparable ? 'COMPARABLE' : 'NOT_COMPARABLE'
        };
    }
};
