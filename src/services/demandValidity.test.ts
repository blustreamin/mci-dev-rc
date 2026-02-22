
import { isDemandEligible } from './demandSetBuilder';
import { SnapshotKeywordRow } from '../types';

/**
 * UNIT TEST: Demand Eligibility Logic
 * Verifies that demand metrics use volume>0 regardless of status string.
 */
export function runDemandValidityTests() {
    console.group("Testing Demand Eligibility Predicate");

    const baseRow: Partial<SnapshotKeywordRow> = {
        active: true,
        volume: 100,
        status: 'VALID'
    };

    // 1. Standard Success
    console.assert(isDemandEligible(baseRow as SnapshotKeywordRow) === true, "Should include standard valid row");

    // 2. UNVERIFIED with volume
    console.assert(isDemandEligible({ ...baseRow, status: 'UNVERIFIED' } as SnapshotKeywordRow) === true, "Should include UNVERIFIED rows if volume exists");

    // 3. ZERO status with volume (Thebelievable drift scenario)
    console.assert(isDemandEligible({ ...baseRow, status: 'ZERO' } as SnapshotKeywordRow) === true, "Should include status=ZERO rows if volume actually > 0");

    // 4. VALID status with zero volume
    console.assert(isDemandEligible({ ...baseRow, status: 'VALID', volume: 0 } as SnapshotKeywordRow) === false, "Should exclude status=VALID if volume is 0");

    // 5. Inactive row
    console.assert(isDemandEligible({ ...baseRow, active: false } as SnapshotKeywordRow) === false, "Should exclude inactive rows even if volume > 0");

    // 6. Missing volume
    console.assert(isDemandEligible({ ...baseRow, volume: undefined } as SnapshotKeywordRow) === false, "Should exclude rows with undefined volume");

    console.log("All Demand Validity Tests Passed.");
    console.groupEnd();
}

// Auto-run in dev if requested
if (typeof window !== 'undefined') {
    (window as any).__runDemandTests = runDemandValidityTests;
}
