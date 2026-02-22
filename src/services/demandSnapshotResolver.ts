
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { FirestoreClient } from './firestoreClient';
import { CategorySnapshotDoc } from '../types';

export interface DemandResolutionResult {
    ok: boolean;
    categoryId: string;
    month: string;
    snapshotId: string | null;
    version: string | null;
    lifecycle: string | null;
    mode: "EXACT_V3" | "EXACT_ANY_VERSION" | "LATEST_ANY" | "MISSING";
    reason?: string;
    snapshot?: CategorySnapshotDoc;
    corpusSnapshotId?: string; // For linking back to source corpus if demand snapshot is derived
}

export const DemandSnapshotResolver = {
    async resolve(
      categoryId: string,
      month: string // YYYY-MM
    ): Promise<DemandResolutionResult> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return { ok: false, categoryId, month, snapshotId: null, version: null, lifecycle: null, mode: "MISSING", reason: "DB_INIT_FAIL" };

        const path = `mci_category_snapshots/IN/en/${categoryId}/snapshots`;
        const colRef = collection(db, path);

        console.log(`[DEMAND_RESOLVER] Resolving ${categoryId} @ ${month}`);

        try {
            // 1. EXACT MATCH (In-Memory Filter to avoid composite index)
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

            // 2. FALLBACK: Latest Available (within reasonable time)
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
    }
};

// Backwards compatibility alias
export const DemandSnapshotResolverInput = {
    async resolveDemandSnapshot(categoryId: string, month: string) {
        const res = await DemandSnapshotResolver.resolve(categoryId, month);
        return {
            categoryId: res.categoryId,
            month: res.month,
            snapshotId: res.snapshotId,
            version: res.version,
            lifecycle: res.lifecycle,
            resolvedBy: res.mode,
            debugInfo: res.reason
        };
    }
};
