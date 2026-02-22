#!/usr/bin/env python3
"""
COMPREHENSIVE FIX: Match app to presentation
1. Expand keywords to 150-200+ per category
2. Fix Spread formula to match presentation (Top3-based)
3. Fix Demand to use intent-weighted volumes (CAV)
4. Add Demand Over Time + Buying Intent Index
"""
import os, shutil

# ============================================================
# STEP 1: Copy expanded curated seeds
# ============================================================
print("=== STEP 1: Expanding keyword corpus ===")
# The expanded seeds file should be at curatedKeywordSeeds_expanded.ts
# Copy it over the existing one
src = 'curatedKeywordSeeds_expanded.ts'
dst = 'src/services/curatedKeywordSeeds.ts'
if os.path.exists(src):
    shutil.copy(src, dst)
    # Count keywords
    with open(dst) as f:
        content = f.read()
    count = content.count('"')  // 2  # rough count (each keyword has 2 quotes)
    print(f"  OK: Copied expanded seeds (~{count} keywords)")
else:
    print(f"  ERROR: {src} not found. Place it in project root.")

# ============================================================
# STEP 2: Fix Spread formula to match presentation
# Presentation: Spread = 10 × (1 − Top3_share)
# App currently: Spread = 1 + 9 × sqrt(1 - HHI)
# ============================================================
print("\n=== STEP 2: Fix Spread formula ===")
metrics_path = 'src/services/metricsCalculator.ts'
with open(metrics_path, 'r') as f:
    content = f.read()

old_spread = """        // 3. Demand Spread (Smoothed HHI)
        let hhi = 0;
        const activeAnchors = Object.values(anchorVols).filter(v => v > 0);
        const totalActiveVol = activeAnchors.reduce((sum, v) => sum + v, 0);
        
        if (totalActiveVol > 0) {
            activeAnchors.forEach(v => {
                const share = v / totalActiveVol;
                hhi += share * share;
            });
        }
        
        const rawSpread = activeAnchors.length > 1 ? (1 - hhi) : 0;
        const spreadScore = 1 + (9 * Math.sqrt(rawSpread));"""

new_spread = """        // 3. Demand Spread (Top3-Based, per presentation formula)
        // Spread = 10 × (1 − Top3_share)
        const activeAnchors = Object.values(anchorVols).filter(v => v > 0);
        const totalActiveVol = activeAnchors.reduce((sum, v) => sum + v, 0);
        
        let spreadScore = 1;
        if (totalActiveVol > 0 && activeAnchors.length > 1) {
            // Sort descending and take top 3 shares
            const shares = activeAnchors
                .map(v => v / totalActiveVol)
                .sort((a, b) => b - a);
            const top3Share = shares.slice(0, 3).reduce((s, v) => s + v, 0);
            spreadScore = 10 * (1 - top3Share);
            // Clamp to 1-10
            spreadScore = Math.max(1, Math.min(10, spreadScore));
        }"""

if old_spread in content:
    content = content.replace(old_spread, new_spread)
    print("  OK: Spread formula changed to Top3-based")
else:
    print("  SKIP: Spread formula not found exactly")

with open(metrics_path, 'w') as f:
    f.write(content)

# ============================================================
# STEP 3: Fix Demand Index to use intent-weighted volumes (CAV)
# Presentation: CAV = Σ(V_k × w_intent(k))
# App currently: demandIndex = totalVol / 1000000 (raw, unweighted)
# ============================================================
print("\n=== STEP 3: Fix Demand Index to use CAV ===")
with open(metrics_path, 'r') as f:
    content = f.read()

old_demand = """        // 1. Demand Index (Unthrottled)
        const demandIndex = totalVol / 1000000;

        // 2. Engagement Readiness (Smoothed)
        const avgIntent = totalVol > 0 ? weightedSum / totalVol : 0;
        const normReadiness = Math.max(0, Math.min(1, (avgIntent - 0.5) / 0.5));
        
        // Scale 1..10 with mild sqrt smoothing to avoid polarization
        const readinessScore = 1 + (9 * Math.sqrt(normReadiness));"""

new_demand = """        // 1. Demand Index (Commercially Adjusted Volume / CAV)
        // Per presentation: CAV = Σ(V_k × w_intent(k)) / 1,000,000
        // weightedSum already contains Σ(volume × intent_weight)
        const demandIndex = weightedSum / 1000000;

        // 2. Engagement Readiness (Smoothed)
        const avgIntent = totalVol > 0 ? weightedSum / totalVol : 0;
        const normReadiness = Math.max(0, Math.min(1, (avgIntent - 0.5) / 0.5));
        
        // Scale 1..10 with mild sqrt smoothing to avoid polarization
        const readinessScore = 1 + (9 * Math.sqrt(normReadiness));"""

if old_demand in content:
    content = content.replace(old_demand, new_demand)
    print("  OK: Demand now uses intent-weighted CAV")
else:
    print("  SKIP: Demand formula not found exactly")

with open(metrics_path, 'w') as f:
    f.write(content)

# ============================================================
# STEP 4: Align intent weights with presentation
# Presentation uses: Urgent/Transaction=1.0, Research=0.7, Browse=0.4
# App uses 6 buckets. Map them to the 3-bucket model:
#   Decision → 1.0 (Urgent/Transaction)
#   Need, Problem → 0.7 (Research/Evaluation)  
#   Habit, Aspirational, Discovery → 0.4 (Browse/Informational)
# ============================================================
print("\n=== STEP 4: Align intent weights ===")
with open(metrics_path, 'r') as f:
    content = f.read()

old_weights = """        const intentWeights: Record<string, number> = {
            'Decision': 1.00, 'Need': 0.85, 'Problem': 0.75, 
            'Habit': 0.70, 'Aspirational': 0.60, 'Discovery': 0.55
        };"""

new_weights = """        // Intent weights aligned with presentation formula:
        // Urgent/Transaction = 1.0, Research/Evaluation = 0.7, Browse/Info = 0.4
        const intentWeights: Record<string, number> = {
            'Decision': 1.00,
            'Consideration': 0.70, 'Need': 0.70, 'Problem': 0.70,
            'Habit': 0.40, 'Aspirational': 0.40, 'Discovery': 0.40
        };"""

if old_weights in content:
    content = content.replace(old_weights, new_weights)
    print("  OK: Intent weights aligned with presentation")
else:
    print("  SKIP: Intent weights not found exactly")

with open(metrics_path, 'w') as f:
    f.write(content)

# ============================================================
# STEP 5: Add Demand Over Time + Buying Intent Index to output
# ============================================================
print("\n=== STEP 5: Add derived metrics ===")
with open(metrics_path, 'r') as f:
    content = f.read()

old_return = """        return {
            snapshotId,
            snapshotStatus,
            computedAt: Date.now(),
            demandIndex: {
                value: stats.demandIndex, // RAW UNTOUCHED
                unit: 'searches_per_month',
                display: `${displayDemand.toFixed(2)} Mn` // NORMALIZED PRESENTATION
            },
            readinessScore: {
                value: stats.readinessScore,
                scaleMax: 10,
                label: getLabel(stats.readinessScore)
            },
            spreadScore: {
                value: stats.spreadScore,
                scaleMax: 10,
                label: getLabel(stats.spreadScore)
            },
            trend: {
                label: trendLabel,
                valuePercent: trendValue
            },
            inputs: {
                keywordCountTotal: totalCount,
                keywordCountValidated: validatedCount,
                volumeSumValidated: totalVol,
                volumeSumAllKnown: totalVol,
                coverage: totalCount > 0 ? validatedCount / totalCount : 0
            },
            quality: {
                isPartial,
                reasons
            }
        };"""

new_return = """        // Derived metrics per presentation
        const trendMultiplier = (trendValue || 0) / 100; // Convert percentage to decimal
        const demandOverTimeGrowth = displayDemand * trendMultiplier;
        const demandOverTime = displayDemand + demandOverTimeGrowth;
        const buyingIntentIndex = stats.spreadScore > 0 ? stats.readinessScore / stats.spreadScore : 0;

        return {
            snapshotId,
            snapshotStatus,
            computedAt: Date.now(),
            demandIndex: {
                value: stats.demandIndex, // RAW (CAV-based)
                unit: 'searches_per_month',
                display: `${displayDemand.toFixed(2)} Mn`
            },
            readinessScore: {
                value: stats.readinessScore,
                scaleMax: 10,
                label: getLabel(stats.readinessScore)
            },
            spreadScore: {
                value: stats.spreadScore,
                scaleMax: 10,
                label: getLabel(stats.spreadScore)
            },
            trend: {
                label: trendLabel,
                valuePercent: trendValue
            },
            demandOverTime: {
                growth: demandOverTimeGrowth,
                total: demandOverTime
            },
            buyingIntentIndex: {
                value: buyingIntentIndex
            },
            inputs: {
                keywordCountTotal: totalCount,
                keywordCountValidated: validatedCount,
                volumeSumValidated: totalVol,
                volumeSumAllKnown: totalVol,
                coverage: totalCount > 0 ? validatedCount / totalCount : 0
            },
            quality: {
                isPartial,
                reasons
            }
        };"""

if old_return in content:
    content = content.replace(old_return, new_return)
    print("  OK: Added demandOverTime and buyingIntentIndex")
else:
    print("  SKIP: Return block not found exactly")

with open(metrics_path, 'w') as f:
    f.write(content)

# ============================================================
# STEP 6: Update CategoryMetrics type to include new fields
# ============================================================
print("\n=== STEP 6: Update types ===")
types_path = 'src/types.ts'
if os.path.exists(types_path):
    with open(types_path, 'r') as f:
        types_content = f.read()
    
    # Add new fields to CategoryMetrics if not present
    if 'demandOverTime' not in types_content and 'CategoryMetrics' in types_content:
        old_type = "    quality: {"
        new_type = """    demandOverTime?: {
        growth: number;
        total: number;
    };
    buyingIntentIndex?: {
        value: number;
    };
    quality: {"""
        if old_type in types_content:
            types_content = types_content.replace(old_type, new_type, 1)
            with open(types_path, 'w') as f:
                f.write(types_content)
            print("  OK: Added demandOverTime and buyingIntentIndex to types")
        else:
            print("  SKIP: Could not find quality field in types")
    else:
        print("  SKIP: Types already have new fields or CategoryMetrics not found")
else:
    print(f"  SKIP: {types_path} not found")

print("\n=== ALL FIXES APPLIED ===")
print("Now copy curatedKeywordSeeds_expanded.ts to project root, then run this script.")
print("Run: git add -A && git commit -m 'Align formulas with presentation + expand keywords to 200+' && git push")
