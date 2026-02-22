
import { CategorySnapshotDoc, CertificationReadiness, SnapshotKeywordRow } from '../types';
import { CertificationReadinessService } from '../services/certificationReadinessService';

/**
 * UI-Safe types that guarantee arrays are present, preventing WSOD.
 */
export interface SafeReadinessTier {
    pass: boolean;
    reasons: string[];
    missing: {
        global_valid_needed: number;
        global_validated_needed: number;
        min_valid_per_anchor: Record<string, number>;
    };
}

export interface SafeCertificationReadiness {
    status: string; // READY | WARNING | BLOCKED
    score: number;
    summary: string;
    lite: SafeReadinessTier;
    full: SafeReadinessTier;
    blockers: any[];
    per_anchor: Record<string, { total: number; valid: number; low: number; zero: number; error: number }>;
    totals: {
        keywords_total: number;
        valid_total: number;
        validated_total: number;
        zero_total: number;
    };
}

export interface SnapshotUiModel {
    snapshotId: string;
    status: string;
    lifecycle: string;
    totals: {
        total: number;
        valid: number;
        zero: number;
        validated: number;
    };
    readiness: SafeCertificationReadiness;
    rawSnapshot: CategorySnapshotDoc | null;
}

const EMPTY_TIER: SafeReadinessTier = {
    pass: false,
    reasons: [],
    missing: { global_valid_needed: 0, global_validated_needed: 0, min_valid_per_anchor: {} }
};

export function toSnapshotUiModel(snapshot: CategorySnapshotDoc | null, rows?: SnapshotKeywordRow[]): SnapshotUiModel {
    const defaults: SnapshotUiModel = {
        snapshotId: 'UNKNOWN',
        status: 'UNKNOWN',
        lifecycle: 'UNKNOWN',
        totals: { total: 0, valid: 0, zero: 0, validated: 0 },
        readiness: {
            status: 'UNKNOWN',
            score: 0,
            summary: 'No data',
            lite: { ...EMPTY_TIER },
            full: { ...EMPTY_TIER },
            blockers: [],
            per_anchor: {},
            totals: { keywords_total: 0, valid_total: 0, validated_total: 0, zero_total: 0 }
        },
        rawSnapshot: snapshot
    };

    if (!snapshot) return defaults;

    let computed: CertificationReadiness;
    try {
        computed = CertificationReadinessService.computeReadiness(snapshot, rows);
    } catch (e) {
        console.error("Readiness Compute Failed", e);
        // Fallback with minimal safe data from snapshot stats
        return {
            ...defaults,
            snapshotId: snapshot.snapshot_id,
            status: snapshot.lifecycle,
            lifecycle: snapshot.lifecycle,
            totals: {
                total: snapshot.stats?.keywords_total || 0,
                valid: snapshot.stats?.valid_total || 0,
                zero: snapshot.stats?.zero_total || 0,
                validated: snapshot.stats?.validated_total || 0
            }
        };
    }

    const safeTier = (t: any): SafeReadinessTier => ({
        pass: !!t?.pass,
        reasons: Array.isArray(t?.reasons) ? t.reasons : [],
        missing: {
            global_valid_needed: t?.missing?.global_valid_needed || 0,
            global_validated_needed: t?.missing?.global_validated_needed || 0,
            min_valid_per_anchor: t?.missing?.min_valid_per_anchor || {}
        }
    });

    const safePerAnchor: Record<string, { total: number; valid: number; low: number; zero: number; error: number }> = {};
    if (computed.per_anchor) {
        Object.entries(computed.per_anchor).forEach(([k, v]) => {
            safePerAnchor[k] = { 
                total: v.total, 
                valid: v.valid, 
                low: 0, 
                zero: 0, 
                error: 0 
            };
        });
    }

    return {
        snapshotId: snapshot.snapshot_id || 'UNKNOWN',
        status: snapshot.lifecycle || 'UNKNOWN',
        lifecycle: snapshot.lifecycle || 'UNKNOWN',
        totals: {
            total: snapshot.stats?.keywords_total || 0,
            valid: snapshot.stats?.valid_total || 0,
            zero: snapshot.stats?.zero_total || 0,
            validated: snapshot.stats?.validated_total || 0
        },
        readiness: {
            status: computed.status || 'UNKNOWN',
            score: computed.score || 0,
            summary: computed.summary || '',
            lite: safeTier(computed.lite),
            full: safeTier(computed.full),
            blockers: Array.isArray(computed.blockers) ? computed.blockers : [],
            per_anchor: safePerAnchor,
            totals: computed.totals
        },
        rawSnapshot: snapshot
    };
}
