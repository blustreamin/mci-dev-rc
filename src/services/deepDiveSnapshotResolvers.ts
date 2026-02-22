
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { FirestoreClient } from './firestoreClient';
import { CategorySnapshotDoc } from '../types.js';
import { SweepResult, SignalSnapshot, SignalItem, SignalResolutionResult } from '../types.js';
import { safeText } from '../utils/safety';
import { DateUtils } from '../utils/dateUtils';
import { DemandOutputStore, DEMAND_OUTPUT_VERSION } from './demandOutputStore';
import { doc, getDoc } from 'firebase/firestore'; 

// Re-export for consumers
export { DEMAND_OUTPUT_VERSION };

export interface DemandResolutionResult {
    ok: boolean;
    data?: SweepResult;
    // Added fields to match return objects and fix type errors
    categoryId: string;
    month: string;
    snapshotId?: string | null;
    corpusSnapshotId?: string;
    lifecycle?: string | null;
    metricsVersion?: string;
    resolvedMonthKey?: string;
    mode?: "EXACT_V3" | "EXACT_ANY_VERSION" | "LATEST_ANY" | "MISSING";
    reason?: string;
    warning?: string;
    // Fields found in usage/returns
    version?: string | null;
    snapshot?: CategorySnapshotDoc;
}

export function isValidCertifiedDemandSnapshot(
    sweep: any, 
    lifecycle: string, 
    corpusSnapshotId?: string
): boolean {
    if (!sweep) return false;
    const version = sweep.metricsVersion || (sweep.demand && sweep.demand.metricsVersion) || sweep.version;
    if (version !== DEMAND_OUTPUT_VERSION) return false;
    
    // Lifecycle check - Deterministic docs are implicitly certified if they exist and pass validation
    // But we check the field if present
    if (lifecycle && !['CERTIFIED', 'CERTIFIED_FULL', 'CERTIFIED_LITE'].includes(lifecycle)) return false;

    // Value checks
    const d = typeof sweep.demand_index_mn === 'number' ? sweep.demand_index_mn : sweep.demand?.demand_index_mn;
    if (typeof d !== 'number' || !Number.isFinite(d) || d <= 0) return false;
    
    return true;
}

export const DemandSnapshotResolver = {
    async resolve(
      categoryId: string,
      month: string // YYYY-MM
    ): Promise<DemandResolutionResult> {
        // Priority 1: Check Deterministic Output Store (V3)
        // This ensures Diagnostics and Deep Dive see the persisted output in 'mci_outputs'
        const v3Res = await this.resolveV3OrUpgradeLegacy(categoryId, month);
        if (v3Res.ok && v3Res.mode === 'EXACT_V3') {
            return v3Res;
        }

        const db = FirestoreClient.getDbSafe();
        if (!db) return { ok: false, categoryId, month, snapshotId: null, version: null, lifecycle: null, mode: "MISSING", reason: "DB_INIT_FAIL" };

        const path = `mci_category_snapshots/IN/en/${categoryId}/snapshots`;
        const colRef = collection(db, path);

        console.log(`[DEMAND_RESOLVER] Resolving ${categoryId} @ ${month} (Fallback Scan)`);

        try {
            // 2. FALLBACK: EXACT MATCH SCAN (In-Memory Filter)
            // Fetch recent 30 snapshots and find the one matching the month
            const qRecent = query(colRef, orderBy('created_at_iso', 'desc'), limit(30));
            const recentSnaps = await getDocs(qRecent);
            
            const candidates = recentSnaps.docs.map(d => d.data() as CategorySnapshotDoc);
            
            // Filter for target month
            const monthMatches = candidates.filter(d => d.created_at_iso.startsWith(month));

            // 1a. Try CERTIFIED first (V3 equivalent)
            const certifiedMatch = monthMatches.find(d => 
                ['CERTIFIED', 'CERTIFIED_FULL', 'CERTIFIED_LITE'].includes(d.lifecycle)
            );

            if (certifiedMatch) {
                return {
                    ok: true,
                    categoryId,
                    month,
                    snapshotId: certifiedMatch.snapshot_id,
                    version: "v3",
                    lifecycle: certifiedMatch.lifecycle,
                    mode: "EXACT_V3",
                    snapshot: certifiedMatch,
                    corpusSnapshotId: certifiedMatch.snapshot_id
                };
            }

            // 1b. Try Any Validated
            const validatedMatch = monthMatches.find(d => 
                ['VALIDATED', 'VALIDATED_LITE', 'HYDRATED'].includes(d.lifecycle)
            );

            if (validatedMatch) {
                return {
                    ok: true,
                    categoryId,
                    month,
                    snapshotId: validatedMatch.snapshot_id,
                    version: "v2",
                    lifecycle: validatedMatch.lifecycle,
                    mode: "EXACT_ANY_VERSION",
                    snapshot: validatedMatch,
                    corpusSnapshotId: validatedMatch.snapshot_id
                };
            }

            // 3. FALLBACK: Latest Available (within reasonable time)
            if (candidates.length > 0) {
                const latest = candidates[0];
                return {
                    ok: true,
                    categoryId,
                    month,
                    snapshotId: latest.snapshot_id,
                    version: "fallback",
                    lifecycle: latest.lifecycle,
                    mode: "LATEST_ANY",
                    reason: `Exact month ${month} missing. Using latest ${latest.created_at_iso.substring(0, 10)}`,
                    snapshot: latest,
                    corpusSnapshotId: latest.snapshot_id
                };
            }

            return { 
                ok: false, 
                categoryId, 
                month, 
                snapshotId: null, 
                version: null, 
                lifecycle: null, 
                mode: "MISSING", 
                reason: "No snapshots found for category" 
            };

        } catch (e: any) {
            console.error("Demand Resolution Error", e);
            return { 
                ok: false, 
                categoryId, 
                month, 
                snapshotId: null, 
                version: null, 
                lifecycle: null, 
                mode: "MISSING", 
                reason: e.message 
            };
        }
    },

    async resolveV3OrUpgradeLegacy(categoryId: string, monthKey: string): Promise<DemandResolutionResult> {
        // Use the new deterministic store which enforces V3 compliance
        const res = await DemandOutputStore.readDemandDoc({
            country: 'IN',
            language: 'en',
            categoryId,
            month: monthKey,
            runtimeTargetVersion: DEMAND_OUTPUT_VERSION
        });

        if (res.ok && res.data) {
            const doc = res.data;
            
            // Map DemandDoc to SweepResult compatible structure
            // We use the full result payload if available, else overlay root fields
            const sweep: SweepResult = {
                ...(doc.result || {}),
                category: doc.categoryId,
                demand_index_mn: doc.demand_index_mn,
                metric_scores: doc.metric_scores,
                trend_5y: doc.trend_5y,
                metricsVersion: doc.metricsVersion,
                // Ensure critical fields are present
                runId: doc.docId, // Use docId as runId proxy
                totalKeywordsInput: doc.totalKeywordsInput,
                totalKeywordsUsedInMetrics: doc.totalKeywordsUsedInMetrics,
                corpusFingerprint: doc.corpusFingerprint
            } as SweepResult;

            return {
                ok: true,
                data: sweep,
                categoryId: categoryId,
                month: monthKey,
                snapshotId: doc.docId,
                corpusSnapshotId: doc.corpusSnapshotId,
                lifecycle: 'CERTIFIED', // Deterministic docs are certified by definition
                metricsVersion: doc.metricsVersion,
                resolvedMonthKey: monthKey,
                mode: 'EXACT_V3',
                reason: "Found exact deterministic doc via DemandOutputStore"
            };
        }

        return { 
            ok: false, 
            reason: res.reason || "Demand Snapshot Missing", 
            mode: "MISSING",
            categoryId, 
            month: monthKey
        } as any;
    },
    
    // Legacy alias - No-op/Passthrough
    async resolveLegacy(categoryId: string, monthKey: string, db: any): Promise<DemandResolutionResult> {
         return this.resolve(categoryId, monthKey);
    }
};

export const SignalSnapshotResolver = {
    async resolve(categoryId: string, monthKey: string): Promise<SignalResolutionResult> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return { ok: false, reason: "DB_INIT_FAIL", mode: 'NONE' };

        const tryFetch = async (mKey: string): Promise<SignalSnapshot | null> => {
            try {
                const path = `signal_harvester_snapshots/${categoryId}/${mKey}`;
                const docRef = doc(db, path, 'latest');
                const snap = await getDoc(docRef);
                
                if (snap.exists()) {
                    const raw = snap.data();
                    const safeSignals: SignalSnapshot['signals'] = {
                        problems: this.mapItems(raw.signals?.problems),
                        aspirations: this.mapItems(raw.signals?.aspirations),
                        routines: this.mapItems(raw.signals?.routines),
                        triggers: this.mapItems(raw.signals?.triggers),
                        barriers: this.mapItems(raw.signals?.barriers),
                        trends: this.mapItems(raw.signals?.trends),
                        needGaps: this.mapItems(raw.signals?.needGaps)
                    };
                    return {
                        snapshotId: snap.id,
                        harvestVersion: raw.harvestVersion || '1.0',
                        timeWindow: raw.timeWindow || mKey,
                        signals: safeSignals
                    };
                }
            } catch (e) {
            }
            return null;
        };

        const exact = await tryFetch(monthKey);
        if (exact) {
            return {
                ok: true,
                data: exact,
                snapshotId: exact.snapshotId,
                harvestVersion: exact.harvestVersion,
                resolvedMonthKey: monthKey,
                mode: 'EXACT',
                reason: "Found exact match"
            };
        }

        const currentMonth = DateUtils.getCurrentMonthKey();
        if (currentMonth !== monthKey) {
            const fallbackCurrent = await tryFetch(currentMonth);
            if (fallbackCurrent) {
                 return {
                    ok: true,
                    data: fallbackCurrent,
                    snapshotId: fallbackCurrent.snapshotId,
                    harvestVersion: fallbackCurrent.harvestVersion,
                    resolvedMonthKey: currentMonth,
                    mode: 'FALLBACK_LATEST',
                    reason: `Target ${monthKey} missing. Using current (${currentMonth}).`
                };
            }
        }

        return { ok: false, reason: "NO_SIGNAL_SNAPSHOT", mode: 'NONE' };
    },

    mapItems(rawItems: any[]): SignalItem[] {
        if (!Array.isArray(rawItems)) return [];
        return rawItems.map(item => ({
            title: safeText(item.title || item.statement),
            description: safeText(item.description || item.context),
            impact: (['HIGH', 'MEDIUM', 'LOW'].includes(item.impact) ? item.impact : 'MEDIUM'),
            evidence: Array.isArray(item.evidence) ? item.evidence.map(safeText) : [],
            keywords: Array.isArray(item.keywords) ? item.keywords.map(safeText) : []
        }));
    }
};

export { SignalItem, SignalSnapshot, SignalResolutionResult };