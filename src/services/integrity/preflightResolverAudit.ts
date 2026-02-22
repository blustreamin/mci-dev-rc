
import { FirestoreClient } from '../firestoreClient';
import { doc, getDoc, collectionGroup, query, limit, getDocs } from 'firebase/firestore';

export interface AuditCategoryResult {
    categoryId: string;
    ok: boolean;
    source: 'INDEX_POINTER' | 'SNAPSHOT_SCAN' | 'NONE';
    indexDocPath: string | null;
    activeSnapshotId: string | null;
    snapshotDocPath: string | null;
    snapshotId: string | null;
    lifecycle: string;
    valid: number;
    createdAtIso: string | null;
    reason: string;
}

export interface AuditReportV2 {
    ts: string;
    projectId: string;
    categories: AuditCategoryResult[];
    verdict: 'EMPTY_DB' | 'READY_FOR_RESET' | 'NO_GO';
    blockers: string[];
    errors: string[];
}

function normalizeSnapshotMeta(data: any): { snapshotId: string | null, lifecycle: string, valid: number, createdAtIso: string | null } {
    if (!data) return { snapshotId: null, lifecycle: 'UNKNOWN', valid: 0, createdAtIso: null };
    
    return {
        snapshotId: data.snapshot_id || data.id || null,
        lifecycle: data.lifecycle || data.status || data.phase || 'UNKNOWN',
        valid: data.stats?.valid_total || data.stats?.validTotal || data.valid_total || data.validTotal || 0,
        createdAtIso: data.created_at_iso || data.createdAt || data.created_at || data.createdAtIso || null
    };
}

export const PreflightResolverAuditV2 = {
    async runResolverAuditV2(categories: string[]): Promise<AuditReportV2> {
        const db = FirestoreClient.getDbSafe();
        const targetInfo = FirestoreClient.logFirebaseTarget();
        const projectId = targetInfo?.projectId || 'unknown';
        const ts = new Date().toISOString();
        
        if (!db) {
            return {
                ts,
                projectId,
                categories: [],
                verdict: 'NO_GO',
                blockers: ['DB_INIT_FAIL'],
                errors: ['Firestore not initialized']
            };
        }

        const catResults: AuditCategoryResult[] = [];
        const errors: string[] = [];

        for (const catId of categories) {
            const res: AuditCategoryResult = {
                categoryId: catId,
                ok: false,
                source: 'NONE',
                indexDocPath: null,
                activeSnapshotId: null,
                snapshotDocPath: null,
                snapshotId: null,
                lifecycle: 'UNKNOWN',
                valid: 0,
                createdAtIso: null,
                reason: 'Start'
            };

            try {
                // 1. Index Pointer Check
                const indexPaths = [
                    `corpus_index/${catId}_IN_en`,
                    `corpus_index/${catId}`,
                    `corpus_index/${catId}_in_en`
                ];

                let pointerData: any = null;

                for (const path of indexPaths) {
                    const snap = await getDoc(doc(db, path));
                    if (snap.exists()) {
                        res.indexDocPath = path;
                        pointerData = snap.data();
                        break;
                    }
                }

                if (pointerData) {
                    res.activeSnapshotId = pointerData.activeSnapshotId || pointerData.active_snapshot_id || null;
                }

                // 2. Direct Snapshot Fetch
                if (res.activeSnapshotId) {
                    const snapPaths = [
                        `mci_category_snapshots/IN/en/${catId}/snapshots/${res.activeSnapshotId}`,
                        `mci_category_snapshots/in/en/${catId}/snapshots/${res.activeSnapshotId}`,
                        `mci_category_snapshots/IN/en/categories/${catId}/snapshots/${res.activeSnapshotId}`
                    ];

                    let snapData: any = null;
                    for (const path of snapPaths) {
                        const snap = await getDoc(doc(db, path));
                        if (snap.exists()) {
                            res.snapshotDocPath = path;
                            snapData = snap.data();
                            break;
                        }
                    }

                    if (snapData) {
                        const meta = normalizeSnapshotMeta(snapData);
                        res.snapshotId = meta.snapshotId;
                        res.lifecycle = meta.lifecycle;
                        res.valid = meta.valid;
                        res.createdAtIso = meta.createdAtIso;
                        res.source = 'INDEX_POINTER';
                        res.ok = true;
                        res.reason = 'Found via Index Pointer';
                    } else {
                        res.reason = 'Index Pointer Dangling';
                        // Fallthrough to scan
                    }
                } else {
                    res.reason = 'No Index Pointer';
                }

                // 3. Fallback Scan (if not found via pointer)
                if (!res.ok) {
                    // Query collectionGroup('snapshots') limit 200 (Minimal read cost)
                    const q = query(collectionGroup(db, 'snapshots'), limit(200));
                    const querySnap = await getDocs(q);
                    
                    const candidates: any[] = [];
                    querySnap.forEach(d => {
                        const dData = d.data();
                        const dPath = d.ref.path;
                        
                        // Heuristic match for category
                        const matchesCat = 
                            dData.categoryId === catId || 
                            dData.category_id === catId || 
                            dPath.includes(`/${catId}/snapshots/`);
                        
                        if (matchesCat) {
                            candidates.push({
                                ...dData,
                                _path: dPath,
                                _meta: normalizeSnapshotMeta(dData)
                            });
                        }
                    });
                    
                    if (candidates.length > 0) {
                        // Sort candidates: Priority to Certified, then Date
                        const lifecycleOrder = ['CERTIFIED_FULL', 'CERTIFIED_LITE', 'CERTIFIED', 'VALIDATED_LITE', 'VALIDATED', 'HYDRATED', 'DRAFT'];
                        
                        candidates.sort((a, b) => {
                            const idxA = lifecycleOrder.indexOf(a._meta.lifecycle);
                            const idxB = lifecycleOrder.indexOf(b._meta.lifecycle);
                            const rankA = idxA === -1 ? 99 : idxA;
                            const rankB = idxB === -1 ? 99 : idxB;
                            
                            if (rankA !== rankB) return rankA - rankB;
                            
                            const dateA = a._meta.createdAtIso || '';
                            const dateB = b._meta.createdAtIso || '';
                            return dateB.localeCompare(dateA);
                        });
                        
                        const best = candidates[0];
                        res.source = 'SNAPSHOT_SCAN';
                        res.snapshotDocPath = best._path;
                        res.snapshotId = best._meta.snapshotId;
                        res.lifecycle = best._meta.lifecycle;
                        res.valid = best._meta.valid;
                        res.createdAtIso = best._meta.createdAtIso;
                        res.ok = true;
                        res.reason = 'Found via Collection Scan';
                    } else {
                        res.reason = 'No snapshots found in Scan';
                    }
                }

            } catch (e: any) {
                errors.push(`[${catId}] ${e.message}`);
                res.reason = `Error: ${e.message}`;
            }

            catResults.push(res);
        }

        // 4. Verdict Logic
        const blockers: string[] = [];
        // Only count as found if source is NOT NONE
        const foundSnapshots = catResults.filter(c => c.source !== 'NONE').length;
        
        let verdict: AuditReportV2['verdict'] = 'NO_GO';
        
        if (errors.length > 0) {
            verdict = 'NO_GO';
            blockers.push(`Audit internal errors: ${errors.length}`);
        } else if (foundSnapshots === 0) {
            // Truly empty DB
            verdict = 'EMPTY_DB';
        } else {
            // DB has content, safe to reset if user confirms
            verdict = 'READY_FOR_RESET';
        }

        console.log(`[PREFLIGHT][DONE] verdict=${verdict} found=${foundSnapshots}`);

        return {
            ts,
            projectId,
            categories: catResults,
            verdict,
            blockers,
            errors
        };
    }
};
