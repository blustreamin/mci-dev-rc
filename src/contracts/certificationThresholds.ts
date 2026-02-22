
export const CERT_THRESHOLDS = {
  VALIDATED_LITE: {
    min_valid_per_anchor: 25
  },
  LITE: {
    min_valid_per_anchor: 75,
    target_kept_per_anchor: 200,
    min_global_valid: 200,          // floor: to avoid tiny corpuses (or anchors_total * 100)
    min_global_validated: 400,      // floor: must have some validation
  },
  FULL: {
    min_valid_per_anchor: 250,
    target_kept_per_anchor: 400,
    min_global_valid: 2000,         // Target: 2000+ valid keywords per category
    min_global_validated: 2500,
  }
} as const;

export const CERT_THRESHOLDS_V2 = {
  DEFINITION: {
    MIN_KEYWORDS_PER_ANCHOR_MEANINGFUL: 10
  },
  FULL: {
    MIN_MEANINGFUL_ANCHORS: 10,
    MIN_USABLE_KEYWORDS: 500,
    MAX_ZERO_VOL_PCT: 0.85
  },
  LITE: {
    MIN_MEANINGFUL_ANCHORS: 3,
    MIN_USABLE_KEYWORDS: 150,
    MAX_ZERO_VOL_PCT: 0.95
  }
};

/**
 * CERT_V3_LEAN_REBUILD_POLICY
 * Rebuild-only policy to ensure categories don't get stuck in RED/DRAFT 
 * during a full system flush, while maintaining zero-poison guards.
 */
export const CERT_V3_LEAN_REBUILD_POLICY = {
    minAnchorsAttempted: 4,
    certifiedTierRules: {
        CERTIFIED_FULL: { 
            minAnchorsPassing: 4,       // Categories have 6 anchors — 4/6 = 67%
            minCoveragePct: 20, 
            minValidKeywordsTotal: 200,  // Meaningful quality gate
            maxZeroPct: 80 
        },
        CERTIFIED_LITE: { 
            minAnchorsPassing: 2,       // 2/6 — minimum viable for rebuild
            minCoveragePct: 10, 
            minValidKeywordsTotal: 100, 
            maxZeroPct: 90 
        }
    }
};
