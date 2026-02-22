
export interface DfsTelemetry {
    httpStatus: number;
    rowsParsed: number;
    matchedPath: string;
    latencyMs: number;
    keywordsSent: number;
    error?: string;
}

export interface RowCounts {
    rowsTotal: number;
    rowsWithVolumeDefined: number; // volume !== undefined && volume !== null
    valid: number;
    zero: number;
    unverified: number;
}

/**
 * Enforces that a Grow/Validation operation actually performed real work.
 * Throws an error if the operation was a "phantom" success.
 */
export function assertDfsValidationOccurred(opts: {
    categoryId: string;
    jobId: string;
    snapshotId: string;
    beforeCounts: RowCounts;
    afterCounts: RowCounts;
    dfsTelemetry: DfsTelemetry;
}) {
    const { categoryId, jobId, snapshotId, beforeCounts, afterCounts, dfsTelemetry } = opts;
    const context = `[DFS_PROOF_GATE] ${categoryId} / ${snapshotId}`;

    // 1. HTTP 200 Requirement
    if (dfsTelemetry.httpStatus !== 200) {
        console.error(`${context} FAIL: HTTP Status ${dfsTelemetry.httpStatus}`);
        throw new Error(`DFS_PROOF_GATE_FAIL: HTTP ${dfsTelemetry.httpStatus} (Expected 200)`);
    }

    // 2. Rows Parsed Requirement
    if (dfsTelemetry.rowsParsed <= 0) {
        console.error(`${context} FAIL: Zero rows parsed from DFS response.`);
        throw new Error(`DFS_PROOF_GATE_FAIL: No rows parsed from API response`);
    }

    // 3. Persistence Progress Requirement (Must defined new volumes)
    // We check that the number of rows with defined volume has INCREASED.
    // Exception: If we just re-validated existing valid rows (rare in Grow flow, but possible in Revalidate).
    // But for Grow/Backfill, we expect progress on UNVERIFIED rows.
    if (afterCounts.rowsWithVolumeDefined <= beforeCounts.rowsWithVolumeDefined) {
        // Check if we at least converted UNVERIFIED to ZERO or VALID
        // If unverified decreased, we made progress even if volume defined count didn't change (e.g. if zero volume counts as defined)
        // In our model, volume=0 IS defined. volume=undefined is not.
        // So rowsWithVolumeDefined SHOULD increase if we processed unverified rows.
        
        console.error(`${context} FAIL: No new volume data persisted. Before=${beforeCounts.rowsWithVolumeDefined}, After=${afterCounts.rowsWithVolumeDefined}`);
        throw new Error(`DFS_PROOF_GATE_FAIL: Persistence check failed (No new volumes recorded)`);
    }

    // 4. Non-Destructive Requirement
    const beforeGood = beforeCounts.valid + beforeCounts.zero;
    const afterGood = afterCounts.valid + afterCounts.zero;
    
    // Allow equal if we only added new rows that failed to validate? No, if we added rows they are valid or zero.
    // Basically we shouldn't LOSE valid data.
    if (afterGood < beforeGood) {
        console.error(`${context} FAIL: Regression detected. Valid+Zero dropped from ${beforeGood} to ${afterGood}`);
        throw new Error(`DFS_PROOF_GATE_FAIL: Data regression (lost valid/zero rows)`);
    }

    console.log(`${context} PASS. Parsed=${dfsTelemetry.rowsParsed}, NewVol=${afterCounts.rowsWithVolumeDefined - beforeCounts.rowsWithVolumeDefined}`);
}

export function getRowCounts(rows: any[]): RowCounts {
    return {
        rowsTotal: rows.length,
        rowsWithVolumeDefined: rows.filter(r => r.volume !== undefined && r.volume !== null).length,
        valid: rows.filter(r => r.status === 'VALID').length,
        zero: rows.filter(r => r.status === 'ZERO').length,
        unverified: rows.filter(r => r.status === 'UNVERIFIED').length
    };
}
