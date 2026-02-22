import { doc, setDoc, getDoc } from 'firebase/firestore';
import { FirestoreClient } from './firestoreClient';
import { DemandSnapshotResolver } from './deepDiveSnapshotResolvers';
import { DemandMetricsRunner } from './demandMetricsRunner';
import { OutputSnapshotStore } from './outputSnapshotStore';
import { SnapshotResolver } from './snapshotResolver';

/**
 * Service to repair demand output snapshots that are 'poisoned' 
 * (e.g., marked as CERTIFIED but containing zero or invalid demand metrics).
 */
export const DemandSnapshotRepairService = {
  async rebuildDemandSnapshot(categoryId: string, monthKey: string): Promise<{
    ok: boolean;
    action: 'REBUILT' | 'MARKED_POISONED_ONLY' | 'NO_OP' | 'FAILED';
    notes: string[];
    previousSnapshotId?: string | null;
    newSnapshotId?: string | null;
    computedDemandMn?: number | null;
  }> {
    const notes: string[] = [];
    const db = FirestoreClient.getDbSafe();
    if (!db) return { ok: false, action: 'FAILED', notes: ['FIREBASE_DB_NOT_INITIALIZED'] };

    // Step A: Resolve current demand output snapshot
    const res = await DemandSnapshotResolver.resolve(categoryId, monthKey);
    const snap = res.data;
    const snapId = res.snapshotId;

    if (!res.ok || !snapId || !snap) {
        notes.push("No existing demand snapshot found for this month.");
        console.log(`[DEMAND_REPAIR] category=${categoryId} month=${monthKey} action=NO_OP reason=NOT_FOUND`);
        return { ok: true, action: 'NO_OP', notes };
    }

    // Step B: Determine if poisoned (Certified but Zero/Invalid)
    const demandVal = snap.demand_index_mn;
    const lifecycle = res.lifecycle || 'UNKNOWN';
    const isCertified = lifecycle.includes('CERTIFIED');
    const isZero = typeof demandVal !== 'number' || !Number.isFinite(demandVal) || demandVal <= 0;

    if (!isCertified || !isZero) {
        notes.push(`Snapshot ${snapId} is ${lifecycle} with demand ${demandVal}. Not considered poisoned (must be CERTIFIED and <= 0).`);
        console.log(`[DEMAND_REPAIR] category=${categoryId} month=${monthKey} action=NO_OP reason=NOT_POISONED demand=${demandVal}`);
        return { ok: true, action: 'NO_OP', notes, previousSnapshotId: snapId };
    }

    notes.push(`Detected POISONED snapshot ${snapId} (Lifecycle: ${lifecycle}, Demand: ${demandVal})`);
    
    // Step C: Mark old snapshot as POISONED (Merge update)
    // This breaks the Parity Lock without deleting history
    try {
        const docPath = `mci_outputs/IN/en/${categoryId}/snapshots`;
        const docRef = doc(db, docPath, snapId);
        await setDoc(docRef, {
            lifecycle: 'POISONED',
            poisoned: true,
            poisonedAt: new Date().toISOString(),
            poisonReason: 'CERTIFIED_BUT_ZERO',
            poisonedBy: 'IntegrityConsole'
        }, { merge: true });
        notes.push(`Marked ${snapId} as lifecycle=POISONED.`);
    } catch (e: any) {
        console.error(`[DEMAND_REPAIR] Failed to mark poisoned`, e);
        return { ok: false, action: 'FAILED', notes: [`Firestore write failed: ${e.message}`] };
    }

    // Step D: Force a fresh recompute bypassing cache
    notes.push("Triggering fresh DemandMetricsRunner (forceRecalculate=true)...");
    
    // Resolve corpus snapshot ID for linkage
    let corpusId = res.corpusSnapshotId;
    if (!corpusId) {
        const corpusRes = await SnapshotResolver.resolveActiveSnapshot(categoryId, 'IN', 'en');
        corpusId = corpusRes.snapshot?.snapshot_id;
    }
    
    if (!corpusId) {
        notes.push("Warning: Base corpus snapshot ID could not be resolved. Rebuild may have weak linkage.");
    }

    try {
        // Fixed: Passing correct arguments to runDemandMetrics to satisfy expected signature.
        const runnerRes = await DemandMetricsRunner.runDemandMetrics(categoryId, monthKey, {
            dryRun: false,
            forceRecalculate: true,
            jobId: `REBUILD_${categoryId}_${Date.now()}`
        });

        if (!runnerRes.ok || !runnerRes.metrics) {
            const err = runnerRes.error || "Runner returned empty result";
            notes.push(`Runner failed: ${err}`);
            console.log(`[DEMAND_REPAIR] category=${categoryId} month=${monthKey} action=MARKED_POISONED_ONLY reason=RUNNER_FAIL`);
            return { ok: false, action: 'MARKED_POISONED_ONLY', notes, previousSnapshotId: snapId };
        }

        const newDemand = runnerRes.metrics.demand_index_mn;
        const resultData = runnerRes.metrics.result;

        // Step E: Save result safely if demand is healthy
        if (newDemand > 0 && Number.isFinite(newDemand)) {
            // Attempt to preserve Strategy from old doc if it existed
            let strategy = {};
            try {
                const oldDocSnap = await getDoc(doc(db, `mci_outputs/IN/en/${categoryId}/snapshots`, snapId));
                if (oldDocSnap.exists()) {
                    strategy = oldDocSnap.data().strategy || {};
                }
            } catch (e) {
                notes.push("Strategy recovery from old snapshot skipped.");
            }

            const saveRes = await OutputSnapshotStore.createOutputSnapshot(
                corpusId || 'REPAIR_SOURCE_UNKNOWN',
                categoryId,
                'IN',
                'en',
                monthKey,
                strategy,
                resultData
            );

            if (saveRes.ok) {
                const newId = saveRes.data.snapshot_id;
                notes.push(`Saved new HEALTHY snapshot: ${newId} (Demand: ${newDemand.toFixed(2)} Mn)`);
                console.log(`[DEMAND_REPAIR] category=${categoryId} month=${monthKey} action=REBUILT prev=${snapId} new=${newId} demand=${newDemand}`);
                
                return {
                    ok: true,
                    action: 'REBUILT',
                    notes,
                    previousSnapshotId: snapId,
                    newSnapshotId: newId,
                    computedDemandMn: newDemand
                };
            } else {
                 notes.push(`Save failed: ${(saveRes as any).error}`);
                 console.log(`[DEMAND_REPAIR] category=${categoryId} month=${monthKey} action=MARKED_POISONED_ONLY reason=SAVE_FAIL`);
                 return { ok: false, action: 'MARKED_POISONED_ONLY', notes, previousSnapshotId: snapId };
            }
        } else {
            notes.push(`Recompute still returned zero or invalid demand (${newDemand}).`);
            notes.push("Check corpus hydration, DFS credits, or keyword volumes.");
            console.log(`[DEMAND_REPAIR] category=${categoryId} month=${monthKey} action=MARKED_POISONED_ONLY reason=STILL_ZERO`);
            return {
                ok: true,
                action: 'MARKED_POISONED_ONLY',
                notes,
                previousSnapshotId: snapId,
                computedDemandMn: newDemand
            };
        }

    } catch (e: any) {
        const msg = e.message || "Unknown exception";
        notes.push(`Exception during recompute: ${msg}`);
        console.error(`[DEMAND_REPAIR] Exception`, e);
        return { ok: false, action: 'FAILED', notes, previousSnapshotId: snapId };
    }
  }
};