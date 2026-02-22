
import { CategorySnapshotDoc, SnapshotKeywordRow, ValidationJob, CertificationReadiness as ReadinessReport, ReadinessBlocker, ReadinessStatus } from '../types';

export const CertificationReadiness = {
    
    calculate(
        snapshot: CategorySnapshotDoc, 
        rows: SnapshotKeywordRow[], 
        job: ValidationJob | null
    ): ReadinessReport {
        const blockers: ReadinessBlocker[] = [];
        let score = 100;

        // --- 1. Aggregations ---
        let totalValid = 0;
        let highIntentCount = 0; // Volume >= 100
        const anchorStats: Record<string, { total: number, valid: number }> = {};

        // Initialize from snapshot anchors to catch 0-row anchors
        snapshot.anchors.forEach(a => {
            anchorStats[a.anchor_id] = { total: 0, valid: 0 };
        });

        rows.forEach(r => {
            if (!anchorStats[r.anchor_id]) anchorStats[r.anchor_id] = { total: 0, valid: 0 };
            
            anchorStats[r.anchor_id].total++;
            
            if (r.status === 'VALID' || r.status === 'LOW') { // Assuming LOW is valid but low volume
                // Strictly, certification usually cares about 'VALID' (vol > 0)
                if (r.volume && r.volume > 0) {
                    totalValid++;
                    anchorStats[r.anchor_id].valid++;
                    if (r.volume >= 100) highIntentCount++;
                }
            }
        });

        // --- 2. Thresholds ---
        const MIN_GLOBAL_VALID = Math.max(1200, snapshot.anchors.length * 300);
        const MIN_ANCHOR_VALID = 100; // WEAK threshold
        const MIN_HIGH_INTENT_PCT = 0.30; // 30%

        // --- 3. Checks ---

        // A. Lifecycle
        const isLifecycleReady = snapshot.lifecycle === 'VALIDATED'; // Must be validated to certify
        if (snapshot.lifecycle === 'DRAFT' || snapshot.lifecycle === 'HYDRATED') {
            blockers.push({
                id: 'lifecycle',
                title: 'Snapshot Lifecycle',
                message: `Current status is ${snapshot.lifecycle}. Must be VALIDATED.`,
                severity: 'BLOCKER',
                actionType: 'VALIDATE',
                actionLabel: 'Run Validation'
            });
            score -= 50;
        }

        // B. Global Volume
        const isGlobalReady = totalValid >= MIN_GLOBAL_VALID;
        if (!isGlobalReady) {
            blockers.push({
                id: 'global_vol',
                title: 'Global Validated Count',
                message: `Found ${totalValid} valid keywords. Need ${MIN_GLOBAL_VALID}.`,
                severity: 'BLOCKER',
                actionType: 'GROW', // Or Validate if many unverified
                actionLabel: 'Grow / Validate'
            });
            score -= 20;
        }

        // C. Anchor Coverage
        const weakAnchors: string[] = [];
        const anchorDetails: ReadinessReport['anchorDetails'] = {};
        
        Object.entries(anchorStats).forEach(([id, stats]) => {
            let status: 'GOOD' | 'OK' | 'WEAK' = 'GOOD';
            if (stats.valid < MIN_ANCHOR_VALID) {
                status = 'WEAK';
                weakAnchors.push(id);
            } else if (stats.valid < 200) {
                status = 'OK';
            }
            anchorDetails[id] = { ...stats, status };
        });

        if (weakAnchors.length > 0) {
            blockers.push({
                id: 'anchor_weak',
                title: 'Weak Anchors',
                message: `${weakAnchors.length} anchors have <${MIN_ANCHOR_VALID} valid keywords.`,
                severity: 'BLOCKER',
                actionType: 'GROW',
                actionLabel: 'Grow Anchors'
            });
            score -= (weakAnchors.length * 5);
        }

        // D. Demand Quality
        const highIntentPct = totalValid > 0 ? (highIntentCount / totalValid) : 0;
        if (highIntentPct < MIN_HIGH_INTENT_PCT && totalValid > 500) {
            // Only block on quality if we have enough data to judge
            blockers.push({
                id: 'quality',
                title: 'Low High-Intent Volume',
                message: `Only ${(highIntentPct*100).toFixed(1)}% keywords > 100 vol. Need ${MIN_HIGH_INTENT_PCT*100}%.`,
                severity: 'WARNING', // Warning for now, V1 flexibility
                actionType: 'GROW',
                actionLabel: 'Grow Head Terms'
            });
            score -= 10;
        }

        // E. Job Health
        let jobOk = true;
        if (job) {
            const now = Date.now();
            const lastHeartbeat = job.timings.lastProgressAt || 0;
            const isStale = (now - lastHeartbeat) > 120000; // 2 mins

            if (job.status === 'RUNNING' && isStale) {
                jobOk = false;
                blockers.push({
                    id: 'job_stuck',
                    title: 'Validation Stuck',
                    message: 'Job heartbeat is stale (>2m).',
                    severity: 'BLOCKER',
                    actionType: 'RESUME',
                    actionLabel: 'Resume Job'
                });
            } else if (job.status === 'FAILED') {
                jobOk = false;
                blockers.push({
                    id: 'job_failed',
                    title: 'Validation Failed',
                    message: job.lastError?.message || 'Unknown failure',
                    severity: 'BLOCKER',
                    actionType: 'RESUME', // Retry
                    actionLabel: 'Retry Validation'
                });
            } else if (job.status === 'PAUSED') {
                jobOk = false;
                blockers.push({
                    id: 'job_paused',
                    title: 'Validation Paused',
                    message: 'Job was paused.',
                    severity: 'BLOCKER',
                    actionType: 'RESUME',
                    actionLabel: 'Resume'
                });
            }
        }

        // --- 4. Synthesis & Next Steps ---
        
        let status: ReadinessStatus = 'READY';
        if (blockers.some(b => b.severity === 'BLOCKER')) status = 'BLOCKED';
        else if (blockers.length > 0) status = 'WARNING';

        let primaryAction: ReadinessReport['nextStep']['primaryAction'] = 'NONE';
        let actionDesc = "Ready for certification.";
        let outcome = "Category will be marked CERTIFIED and locked.";

        if (status !== 'READY') {
            // Priority logic for next action
            if (blockers.some(b => b.id === 'job_stuck' || b.id === 'job_paused' || b.id === 'job_failed')) {
                primaryAction = 'RESUME';
                actionDesc = "Resume the validation job to process remaining rows.";
                outcome = "Completion of validation data.";
            } else if (weakAnchors.length > 0) {
                primaryAction = 'GROW';
                actionDesc = `Grow the ${weakAnchors.length} weak anchors (need >${MIN_ANCHOR_VALID} valid each).`;
                outcome = "Balanced coverage across strategic pillars.";
            } else if (!isGlobalReady) {
                // If not ready but no weak anchors, we generally need more volume or just validation
                const unverifiedCount = rows.filter(r => r.status === 'UNVERIFIED').length;
                if (unverifiedCount > 500) {
                    primaryAction = 'VALIDATE';
                    actionDesc = `Validate ${unverifiedCount} pending rows to find volume.`;
                    outcome = "Increased valid keyword count.";
                } else {
                    primaryAction = 'GROW';
                    actionDesc = "Generate more keywords to reach global minimum.";
                    outcome = `Reach ${MIN_GLOBAL_VALID} valid keywords.`;
                }
            } else if (!isLifecycleReady) {
                primaryAction = 'VALIDATE'; // Usually means we need to finish a validation run to transition state
                actionDesc = "Run validation to transition snapshot state.";
                outcome = "Snapshot moves to VALIDATED.";
            }
        } else {
            primaryAction = 'CERTIFY';
        }

        // Fill Lite/Full with dummy/defaults as this file seems to calculate "General" readiness
        // Ideally this should use evaluateTier like the Service, but this file was likely a prototype.
        // We'll return empty tier reports here as this function seems redundant with Service
        // but needs to satisfy the type.
        
        return {
            category_id: snapshot.category_id,
            snapshot_id: snapshot.snapshot_id,
            lifecycle: snapshot.lifecycle,
            anchors_total: snapshot.anchors.length,
            target_per_anchor: snapshot.targets.per_anchor,
            validation_min_vol: snapshot.targets.validation_min_vol,
            totals: {
                keywords_total: snapshot.stats.keywords_total,
                validated_total: snapshot.stats.validated_total,
                valid_total: snapshot.stats.valid_total,
                low_total: snapshot.stats.low_total,
                zero_total: snapshot.stats.zero_total,
                error_total: snapshot.stats.error_total
            },
            per_anchor: anchorStats as any,
            
            lite: { pass: false, reasons: [], missing: { min_valid_per_anchor: {}, global_valid_needed: 0, global_validated_needed: 0 } },
            full: { pass: false, reasons: [], missing: { min_valid_per_anchor: {}, global_valid_needed: 0, global_validated_needed: 0 } },

            status,
            score: Math.max(0, score),
            summary: status === 'READY' ? 'Snapshot meets all criteria for certification.' : `Blocked by ${blockers.length} issues.`,
            checks: {
                lifecycle: { ok: isLifecycleReady, current: snapshot.lifecycle, expected: 'VALIDATED' },
                globalVolume: { ok: isGlobalReady, current: totalValid, required: MIN_GLOBAL_VALID },
                anchorCoverage: { ok: weakAnchors.length === 0, weakCount: weakAnchors.length, weakAnchors },
                demandQuality: { ok: highIntentPct >= MIN_HIGH_INTENT_PCT, highIntentPct, requiredPct: MIN_HIGH_INTENT_PCT },
                jobHealth: { ok: jobOk, status: job?.status || 'IDLE' }
            },
            blockers,
            nextStep: {
                primaryAction,
                description: actionDesc,
                expectedOutcome: outcome
            },
            anchorDetails
        };
    }
};
