
import { CategorySnapshotStore } from './categorySnapshotStore';
import { CorpusIndexStore } from './corpusIndexStore';
import { CategorySnapshotDoc, ResolvedSnapshot } from '../types';
import { FirestoreClient } from './firestoreClient';
import { collectionGroup, query, where, orderBy, limit, getDocs, doc, getDoc } from 'firebase/firestore';
import { FF_REPAIR_VALIDATION_V4 } from '../constants/runtimeFlags';

export const SnapshotResolver = {
    /**
     * ROBUST RESOLVER V2 (Fixed for Missing Indexes)
     * Uses Collection Group queries to find snapshots regardless of their parent path.
     * Performs in-memory sorting to avoid composite index requirements.
     * Prioritizes CERTIFIED > VALIDATED > DRAFT (Non-Empty).
     * 
     * SAFE MODE: Explicitly rejects 'diag_*', 'v4_check', 'integrity' snapshots.
     */
    async resolveCategorySnapshot(
        categoryId: string, 
        countryCode: string = 'IN', 
        languageCode: string = 'en'
    ): Promise<ResolvedSnapshot> {
        console.log(`[SNAP_RESOLVE][START] categoryId=${categoryId} v4=${FF_REPAIR_VALIDATION_V4}`);
        const db = FirestoreClient.getDbSafe();

        if (!db) {
            return { 
                ok: false, categoryId, snapshotId: null, snapshotStatus: 'UNKNOWN', 
                resolutionStatus: 'ERROR', reason: 'No DB Connection', source: 'NONE', snapshot: null,
                telemetry: {}
            };
        }

        // Helper to validate Snapshot ID format
        const isRealSnapshot = (id: string) => {
            if (!id) return false;
            // Common allow list
            if (id.startsWith('snap_') || id.startsWith('cbv3_')) {
                // Explicit reject list
                if (id.startsWith('diag_') || id.startsWith('v4_check_') || id.includes('integrity')) return false;
                if (FF_REPAIR_VALIDATION_V4) {
                    // Additional V4 constraints if needed
                }
                return true;
            }
            return false;
        };

        // 1. CorpusIndex (Fastest Pointer)
        try {
            const index = await CorpusIndexStore.get(categoryId, countryCode, languageCode);
            if (index && index.activeSnapshotId) {
                // Validate pointer is not poisoned
                if (isRealSnapshot(index.activeSnapshotId)) {
                    const standardPath = `mci_category_snapshots/${countryCode}/${languageCode}/${categoryId}/snapshots`;
                    const snapRef = doc(db, standardPath, index.activeSnapshotId);
                    const snapSnap = await getDoc(snapRef);
                    
                    if (snapSnap.exists()) {
                        const snap = snapSnap.data() as CategorySnapshotDoc;
                        // In V4 mode, be stricter about what constitutes a valid snapshot (e.g. lifecycle)
                        if (FF_REPAIR_VALIDATION_V4) {
                             if (['CERTIFIED', 'VALIDATED', 'DRAFT', 'HYDRATED'].includes(snap.lifecycle)) {
                                 console.log(`[RESOLVER] Index Hit: ${snap.snapshot_id}`);
                                 return this.success(categoryId, snap, "CORPUS_INDEX", "Stable Index Pointer");
                             }
                        } else {
                            if ((snap.stats?.valid_total || 0) > 0 || (snap.stats?.keywords_total || 0) > 0) {
                                return this.success(categoryId, snap, "CORPUS_INDEX", "Stable Index Pointer");
                            }
                        }
                    }
                } else {
                    console.warn(`[SNAP_RESOLVE] Ignoring poisoned pointer: ${index.activeSnapshotId}`);
                }
            }
        } catch (e) {
            console.warn("[SNAP_RESOLVE] CorpusIndex check failed", e);
        }

        // 2. Collection Group Query (Robust Scan)
        try {
            const q = query(
                collectionGroup(db, 'snapshots'),
                where('category_id', '==', categoryId),
                limit(50) 
            );
            
            const snapshot = await getDocs(q);
            
            let candidates = snapshot.docs.map(d => {
                const data = d.data() as CategorySnapshotDoc;
                return {
                    ...data,
                    _path: d.ref.path
                };
            });

            // STRICT FILTER: Reject Diagnostic Snapshots
            candidates = candidates.filter(c => isRealSnapshot(c.snapshot_id));
            
            console.log(`[SNAP_RESOLVE][SCAN] Found ${candidates.length} valid candidates for ${categoryId}`);

            if (candidates.length > 0) {
                // In-Memory Sort: Newest First
                candidates.sort((a, b) => {
                    const dateA = a.created_at_iso || a.updated_at_iso || '';
                    const dateB = b.created_at_iso || b.updated_at_iso || '';
                    return dateB.localeCompare(dateA);
                });

                // Lifecycle Priority
                // Pass 1: Certified/Validated with Valid > 0
                const bestValid = candidates.find(s => 
                    ['CERTIFIED', 'CERTIFIED_FULL', 'CERTIFIED_LITE', 'VALIDATED', 'VALIDATED_LITE'].includes(s.lifecycle) && 
                    (s.stats?.valid_total || 0) > 0
                );
                if (bestValid) return this.success(categoryId, bestValid, "SCAN_PRIORITY", `Found ${bestValid.lifecycle} (Valid > 0)`);

                // Pass 2: Any with Valid > 0
                const anyValid = candidates.find(s => (s.stats?.valid_total || 0) > 0);
                if (anyValid) return this.success(categoryId, anyValid, "SCAN_VALID", `Found ${anyValid.lifecycle} (Valid > 0)`);

                // Pass 3: Any with Total > 0
                const anyRows = candidates.find(s => (s.stats?.keywords_total || 0) > 0);
                if (anyRows) return this.success(categoryId, anyRows, "SCAN_ROWS", `Found ${anyRows.lifecycle} (Rows > 0)`);

                // Pass 4: Most Recent (Fallback)
                const latest = candidates[0];
                return this.success(categoryId, latest, "SCAN_LATEST", `Found ${latest.lifecycle} (Latest)`);
            }

        } catch (e: any) {
            console.warn(`[SNAP_RESOLVE] Collection Group query failed: ${e.message}`);
        }

        return {
            ok: false,
            categoryId,
            snapshotId: null,
            snapshotStatus: 'UNKNOWN',
            resolutionStatus: 'NOT_FOUND',
            reason: "No valid snapshot found",
            source: "NONE",
            snapshot: null,
            telemetry: {},
            error: "SNAPSHOT_NOT_FOUND"
        };
    },

    async resolveActiveSnapshot(categoryId: string, countryCode: string = 'IN', languageCode: string = 'en'): Promise<ResolvedSnapshot> {
        return this.resolveCategorySnapshot(categoryId, countryCode, languageCode);
    },

    success(categoryId: string, snap: CategorySnapshotDoc, source: string, reason: string): ResolvedSnapshot {
        // Self-heal index asynchronously if it was a scan result
        if (source.startsWith("SCAN")) {
            CorpusIndexStore.upsertFromSnapshot(snap).catch(() => {});
        }
        
        return {
            ok: true,
            categoryId,
            snapshotId: snap.snapshot_id,
            snapshotStatus: snap.lifecycle,
            resolutionStatus: 'OK',
            reason,
            source,
            snapshot: snap,
            telemetry: {}
        };
    }
};
