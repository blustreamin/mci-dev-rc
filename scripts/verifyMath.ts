
import assert from 'assert';

declare const process: any;

// --- Constants ---
const K_SOAP = 6900000;

// Configured Weights (Used for Demand Index)
const WEIGHTS = {
    Buy: 1.0,
    Research: 0.6,
    Browse: 0.2
};

// --- Logic Implementation ---

interface MetricsResult {
    demandIndex: number;
    readiness: number;
    spread: number;
}

/**
 * Pure function to calculate metrics based on intent bucket volumes.
 * Implements the "Standard Candle" logic.
 */
function calculateMetrics(buyVol: number, researchVol: number, browseVol: number): MetricsResult {
    const totalRaw = buyVol + researchVol + browseVol;

    // 1. Demand Index Calculation
    // Uses the global WEIGHTS constant: (Buy*1.0 + Research*0.6 + Browse*0.2)
    const weightedVol = (buyVol * WEIGHTS.Buy) + (researchVol * WEIGHTS.Research) + (browseVol * WEIGHTS.Browse);
    // Formula: (TotalWeightedVolume / K_SOAP) * 100
    const demandIndex = (weightedVol / K_SOAP) * 100;

    // 2. Readiness Calculation
    // Uses specific coefficients defined in the spec (1.0, 0.5, 0.1)
    // Formula: 10 * ((Buy*1 + Research*0.5 + Browse*0.1) / TotalRaw)
    let readiness = 0;
    if (totalRaw > 0) {
        const weightedShare = (buyVol * 1.0 + researchVol * 0.5 + browseVol * 0.1) / totalRaw;
        readiness = 10 * weightedShare;
    }

    // 3. Spread Calculation
    // Formula: 10 * (1 - HHI)
    // HHI = sum of squared shares
    let spread = 0;
    if (totalRaw > 0) {
        const s1 = buyVol / totalRaw;
        const s2 = researchVol / totalRaw;
        const s3 = browseVol / totalRaw;
        const hhi = (s1 * s1) + (s2 * s2) + (s3 * s3);
        spread = 10 * (1 - hhi);
    }

    return {
        demandIndex: parseFloat(demandIndex.toFixed(4)), // Formatting for clean assertion
        readiness: parseFloat(readiness.toFixed(4)),
        spread: parseFloat(spread.toFixed(4))
    };
}

// --- Test Suite ---

console.log("Running Deterministic Math Verification...");

try {
    // TEST 1: Standard Candle Check
    // Scenario: Pure 'Buy' volume equal to the benchmark anchor (Soap)
    // Expectation: Demand Index should be exactly 100.0
    const t1 = calculateMetrics(6900000, 0, 0);
    assert.strictEqual(t1.demandIndex, 100.0, "FAILED: Standard Candle Demand Index");
    console.log("✅ Standard Candle Check Passed");

    // TEST 2: Monopoly Check (Spread)
    // Scenario: Volume exists only in one bucket
    // Expectation: HHI = 1.0, Spread = 10 * (1 - 1) = 0.0
    const t2 = calculateMetrics(100, 0, 0);
    assert.strictEqual(t2.spread, 0.0, "FAILED: Monopoly Spread Check");
    console.log("✅ Monopoly Spread Check Passed");

    // TEST 3: Max Readiness Check
    // Scenario: 100% Buy Intent
    // Expectation: Readiness = 10 * (1.0) = 10.0
    const t3 = calculateMetrics(500, 0, 0);
    assert.strictEqual(t3.readiness, 10.0, "FAILED: Max Readiness Check");
    console.log("✅ Max Readiness Check Passed");

    // TEST 4: Perfect Split (Spread)
    // Scenario: Equal volume in all 3 buckets
    // Expectation: Shares = 0.333... HHI = 3 * (1/9) = 1/3. Spread = 10 * (2/3) ≈ 6.666
    const t4 = calculateMetrics(100, 100, 100);
    const expectedSpread = parseFloat((10 * (1 - (1/3))).toFixed(4)); // 6.6667
    assert.strictEqual(t4.spread, expectedSpread, `FAILED: Perfect Split Spread (Got ${t4.spread}, Expected ${expectedSpread})`);
    console.log("✅ Perfect Split Spread Check Passed");

    // TEST 5: Low Quality Traffic
    // Scenario: 100% Browse Intent
    // Expectation: Readiness = 10 * 0.1 = 1.0
    const t5 = calculateMetrics(0, 0, 1000);
    assert.strictEqual(t5.readiness, 1.0, "FAILED: Min Readiness Check");
    console.log("✅ Min Readiness Check Passed");

    // TEST 6: Complex Mix (Realistic)
    // Buy: 500, Research: 1000, Browse: 5000
    // Total = 6500
    // Index Weighted Vol = (500*1) + (1000*0.6) + (5000*0.2) = 500 + 600 + 1000 = 2100
    // Index = (2100 / 6900000) * 100 = 0.0304
    const t6 = calculateMetrics(500, 1000, 5000);
    assert.strictEqual(t6.demandIndex, 0.0304, "FAILED: Complex Mix Demand Index");
    console.log("✅ Complex Mix Check Passed");

    console.log("\nAll Mathematical Contracts Verified.");

} catch (e: any) {
    console.error("\n❌ VERIFICATION FAILED");
    console.error(e.message);
    process.exit(1);
}
