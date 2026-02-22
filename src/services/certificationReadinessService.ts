
import { CategorySnapshotDoc, CertificationReadiness, SnapshotLifecycle, ReadinessBlocker, ReadinessStatus, SnapshotKeywordRow } from '../types';
import { CERT_THRESHOLDS, CERT_THRESHOLDS_V2 } from '../contracts/certificationThresholds';
import { computeCorpusCounts } from './corpusCounts';

export const CertificationReadinessService = {
    
    computeReadiness(snapshot: CategorySnapshotDoc, rows?: SnapshotKeywordRow[]): CertificationReadiness {
        const stats = snapshot.stats;
        const anchorsTotal = snapshot.anchors.length;
        
        // Use provided rows for recalculation if available, otherwise fallback to snapshot stats (less precise for detailed buckets)
        // But for Certification, we rely on the canonical counts.
        
        let counts;
        let perAnchorValid: Record<string, number> = stats.per_anchor_valid_counts || {};
        let perAnchorTotal: Record<string, number> = stats.per_anchor_total_counts || {};

        if (rows) {
            counts = computeCorpusCounts(rows);
            // Recompute per-anchor stats from rows if available
            perAnchorValid = {};
            perAnchorTotal = {};
            snapshot.anchors.forEach(a => {
                perAnchorValid[a.anchor_id] = 0;
                perAnchorTotal[a.anchor_id] = 0;
            });
            rows.forEach(r => {
                perAnchorTotal[r.anchor_id] = (perAnchorTotal[r.anchor_id] || 0) + 1;
                // Reuse logic: active && volume>0
                if (r.active !== false && (r.volume || 0) > 0) {
                     perAnchorValid[r.anchor_id] = (perAnchorValid[r.anchor_id] || 0) + 1;
                }
            });
        } else {
            // Fallback mapping if rows missing (shouldn't happen in full view)
            counts = {
                totalKeywords: stats.keywords_total,
                unverifiedKeywords: stats.keywords_total - stats.validated_total,
                verifiedKeywords: stats.validated_total,
                zeroVolumeKeywords: stats.zero_total,
                activeKeywords: stats.keywords_total, // Approximation
                verifiedActiveKeywords: stats.validated_total, // Approximation
                validKeywords: stats.valid_total,
                amazonBoostedValidKeywords: 0 
            };
        }

        // --- Calculate Score & Blockers ---
        const blockers: ReadinessBlocker[] = [];
        let score = 100;
        
        // 1. Lifecycle
        const isLifecycleReady = snapshot.lifecycle === 'VALIDATED' || snapshot.lifecycle === 'VALIDATED_LITE' || snapshot.lifecycle === 'CERTIFIED' || snapshot.lifecycle === 'CERTIFIED_LITE' || snapshot.lifecycle === 'CERTIFIED_FULL';
        if (snapshot.lifecycle === 'DRAFT' || snapshot.lifecycle === 'HYDRATED') {
            blockers.push({
                id: 'lifecycle',
                title: 'Snapshot Lifecycle',
                message: `Current status is ${snapshot.lifecycle}. Must be VALIDATED or VALIDATED_LITE.`,
                severity: 'BLOCKER',
                actionType: 'VALIDATE',
                actionLabel: 'Run Validation'
            });
            score -= 50;
        }

        // 2. Weak Anchors (Using Full Threshold as ideal)
        const MIN_ANCHOR_VALID = CERT_THRESHOLDS_V2.DEFINITION.MIN_KEYWORDS_PER_ANCHOR_MEANINGFUL;
        const weakAnchors: string[] = [];
        snapshot.anchors.forEach(a => {
            const valid = perAnchorValid[a.anchor_id] || 0;
            if (valid < MIN_ANCHOR_VALID) weakAnchors.push(a.anchor_id);
        });

        if (weakAnchors.length > 0) {
            blockers.push({
                id: 'anchor_weak',
                title: 'Weak Anchors',
                message: `${weakAnchors.length} anchors have <${MIN_ANCHOR_VALID} valid google keywords.`,
                severity: 'WARNING', // Warning because Lite might pass
                actionType: 'GROW',
                actionLabel: 'Grow Anchors'
            });
            score -= (weakAnchors.length * 5);
        }

        // 3. Status
        let status: ReadinessStatus = 'READY';
        if (blockers.some(b => b.severity === 'BLOCKER')) status = 'BLOCKED';
        else if (blockers.length > 0) status = 'WARNING';

        // 4. Next Step
        let primaryAction: 'NONE' | 'GROW' | 'VALIDATE' | 'CERTIFY' | 'RESUME' = 'CERTIFY';
        let actionDesc = "Ready for certification.";
        let outcome = "Category will be marked CERTIFIED.";

        // Thresholds
        const MIN_GLOBAL_VALID = Math.max(1200, snapshot.anchors.length * 300);
        const isGlobalReady = counts.validKeywords >= MIN_GLOBAL_VALID;
        const MIN_HIGH_INTENT_PCT = 0.30;
        
        // Quality check (approximate if rows missing)
        let highIntentPct = 0;
        if (rows) {
             const highIntentCount = rows.filter(r => r.active && (r.volume||0) >= 100).length;
             highIntentPct = counts.validKeywords > 0 ? (highIntentCount / counts.validKeywords) : 0;
        }

        if (status !== 'READY') {
            if (weakAnchors.length > 0 && status === 'WARNING') {
                primaryAction = 'GROW';
                actionDesc = `Improve ${weakAnchors.length} weak anchors for full certification.`;
                outcome = "Better coverage.";
            } else if (!isGlobalReady) {
                if (counts.unverifiedKeywords > 500) {
                    primaryAction = 'VALIDATE';
                    actionDesc = `Validate ${counts.unverifiedKeywords} pending rows.`;
                    outcome = "Increased valid keyword count.";
                } else {
                    primaryAction = 'GROW';
                    actionDesc = "Generate more keywords to reach global minimum.";
                    outcome = `Reach ${MIN_GLOBAL_VALID} valid keywords.`;
                }
            } else if (!isLifecycleReady) {
                primaryAction = 'VALIDATE';
                actionDesc = "Run validation to transition snapshot state.";
                outcome = "Snapshot becomes VALIDATED.";
            }
        }

        // Anchor Details UI mapping
        const anchorDetails: Record<string, { total: number, valid: number, status: 'GOOD' | 'OK' | 'WEAK' }> = {};
        snapshot.anchors.forEach(a => {
            const total = perAnchorTotal[a.anchor_id] || 0;
            const valid = perAnchorValid[a.anchor_id] || 0;
            anchorDetails[a.anchor_id] = {
                total, valid, status: valid < MIN_ANCHOR_VALID ? 'WEAK' : 'GOOD'
            };
        });

        // Initialize Base with DEFAULT Empty Tiers
        const readiness: CertificationReadiness = {
            category_id: snapshot.category_id,
            snapshot_id: snapshot.snapshot_id,
            lifecycle: snapshot.lifecycle,
            anchors_total: anchorsTotal,
            target_per_anchor: snapshot.targets.per_anchor,
            validation_min_vol: snapshot.targets.validation_min_vol,
            
            totals: {
                keywords_total: counts.totalKeywords,
                validated_total: counts.verifiedKeywords, // Mapped Verified -> Validated
                valid_total: counts.validKeywords,
                low_total: stats.low_total,
                zero_total: counts.zeroVolumeKeywords,
                error_total: stats.error_total
            },
            
            per_anchor: perAnchorValid as any, // Only passing valid counts structure here
            
            lite: { pass: false, reasons: [], missing: { min_valid_per_anchor: {}, global_valid_needed: 0, global_validated_needed: 0 } },
            full: { pass: false, reasons: [], missing: { min_valid_per_anchor: {}, global_valid_needed: 0, global_validated_needed: 0 } },

            status,
            score: Math.max(0, score),
            summary: status === 'READY' ? 'Ready for certification.' : `Issues found: ${blockers.length}`,
            checks: {
                lifecycle: { ok: isLifecycleReady, current: snapshot.lifecycle },
                weakAnchors: { count: weakAnchors.length },
                globalVolume: { ok: isGlobalReady, current: counts.validKeywords, required: MIN_GLOBAL_VALID },
                demandQuality: { ok: highIntentPct >= MIN_HIGH_INTENT_PCT, highIntentPct, requiredPct: MIN_HIGH_INTENT_PCT },
                jobHealth: { ok: true, status: 'IDLE' }
            },
            blockers,
            nextStep: {
                primaryAction,
                description: actionDesc,
                expectedOutcome: outcome
            },
            anchorDetails
        };

        // --- LITE CHECK (V2 Logic) ---
        this.evaluateTierV2(readiness, 'lite', CERT_THRESHOLDS_V2.LITE, snapshot, counts);

        // --- FULL CHECK (V2 Logic) ---
        this.evaluateTierV2(readiness, 'full', CERT_THRESHOLDS_V2.FULL, snapshot, counts);

        return readiness;
    },

    evaluateTierV2(
        readiness: CertificationReadiness, 
        tierKey: 'lite' | 'full', 
        config: typeof CERT_THRESHOLDS_V2.LITE | typeof CERT_THRESHOLDS_V2.FULL,
        snapshot: CategorySnapshotDoc,
        counts: any
    ) {
        const tier = readiness[tierKey];
        if (!tier) return;

        // 1. Usable Keywords Gate (Google Valid Only)
        if (counts.validKeywords < config.MIN_USABLE_KEYWORDS) {
             const short = config.MIN_USABLE_KEYWORDS - counts.validKeywords;
             tier.reasons.push(`Valid keywords short by ${short} (Need ${config.MIN_USABLE_KEYWORDS})`);
             tier.missing.global_valid_needed = short;
        }

        // 2. Meaningful Anchors Gate
        let meaningfulCount = 0;
        const MIN_PER_ANCHOR = CERT_THRESHOLDS_V2.DEFINITION.MIN_KEYWORDS_PER_ANCHOR_MEANINGFUL;
        
        // We need detailed per-anchor counts for this
        if (readiness.anchorDetails) {
            Object.values(readiness.anchorDetails).forEach(a => {
                if (a.valid >= MIN_PER_ANCHOR) meaningfulCount++;
            });
        }

        if (meaningfulCount < config.MIN_MEANINGFUL_ANCHORS) {
            tier.reasons.push(`Meaningful anchors short. Have ${meaningfulCount}, need ${config.MIN_MEANINGFUL_ANCHORS}. (Anchor needs ${MIN_PER_ANCHOR} valid KW)`);
        }

        // 3. Zero Volume Pct Gate (Strict)
        const validTotal = counts.validKeywords;
        const total = counts.totalKeywords;
        const zeroPct = total > 0 ? (1 - (validTotal / total)) : 1.0;
        
        if (zeroPct > config.MAX_ZERO_VOL_PCT) {
             tier.reasons.push(`Zero volume % is ${(zeroPct*100).toFixed(1)}% (Max allowed ${(config.MAX_ZERO_VOL_PCT*100).toFixed(0)}%)`);
        }

        // 4. Lifecycle Check
        if (snapshot.lifecycle === 'DRAFT' || snapshot.lifecycle === 'HYDRATED') {
            tier.reasons.push(`Snapshot state '${snapshot.lifecycle}' must be VALIDATED`);
        }

        tier.pass = tier.reasons.length === 0;
    }
};
