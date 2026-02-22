
import { SnapshotKeywordRow } from '../types';
import { CorpusValidity } from './corpusValidity';

export type CorpusCounts = {
    totalKeywords: number;
    unverifiedKeywords: number;
    verifiedKeywords: number;
    zeroVolumeKeywords: number;
    activeKeywords: number;
    verifiedActiveKeywords: number;
    validKeywords: number;
    amazonBoostedValidKeywords: number;
};

/**
 * Single Source of Truth for Corpus Counts.
 * NO MATH / NO WRITES.
 */
export function computeCorpusCounts(rows: SnapshotKeywordRow[]): CorpusCounts {
    let totalKeywords = 0;
    let unverifiedKeywords = 0;
    let verifiedKeywords = 0;
    let zeroVolumeKeywords = 0;
    let activeKeywords = 0;
    let verifiedActiveKeywords = 0;
    let validKeywords = 0;
    let amazonBoostedValidKeywords = 0;

    for (const row of rows) {
        totalKeywords++;

        // Definition 2 & 3: Verified vs Unverified (Google Volume existence)
        const isVerified = (row.volume !== null && row.volume !== undefined);
        
        if (!isVerified) {
            unverifiedKeywords++;
        } else {
            verifiedKeywords++;
            // Definition 4: Zero Volume (Verified 0)
            if (row.volume === 0) {
                zeroVolumeKeywords++;
            }
        }

        // Definition 5: Active
        const isActive = row.active === true;
        if (isActive) {
            activeKeywords++;
            // Definition 6: Verified Active
            if (isVerified) {
                verifiedActiveKeywords++;
            }
        }

        // Definition 7: Valid (Google-Valid) - Delegate to Authority
        if (CorpusValidity.isGoogleValidRow(row)) {
            validKeywords++;
        }

        // Definition 8: Amazon Boosted Valid
        // active=true AND amazonVolume > 0 AND volume === 0
        if (isActive && (row.amazonVolume || 0) > 0 && (row.volume || 0) === 0) {
            amazonBoostedValidKeywords++;
        }
    }

    return {
        totalKeywords,
        unverifiedKeywords,
        verifiedKeywords,
        zeroVolumeKeywords,
        activeKeywords,
        verifiedActiveKeywords,
        validKeywords,
        amazonBoostedValidKeywords
    };
}

export function logCountsConsistency(surface: string, categoryId: string, counts: CorpusCounts) {
    console.log(`[COUNTS_VOCAB] surface=${surface} category=${categoryId} total=${counts.totalKeywords} verified=${counts.verifiedKeywords} verifiedActive=${counts.verifiedActiveKeywords} valid=${counts.validKeywords} zero=${counts.zeroVolumeKeywords} unverified=${counts.unverifiedKeywords}`);
}
