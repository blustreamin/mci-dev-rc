
import { SnapshotResolver } from './snapshotResolver';
import { CategorySnapshotStore } from './categorySnapshotStore';
import { CategorySnapshotDoc } from '../types';

export type SnapshotAccessResult = 
  | { 
      ok: true; 
      snapshotId: string; 
      snapshot: CategorySnapshotDoc; 
      snapshotStatus: 'VALIDATED' | 'VALIDATED_LITE' | 'CERTIFIED' | 'CERTIFIED_LITE' | 'CERTIFIED_FULL'; 
    }
  | { 
      ok: false; 
      error: string; 
      reason: 'NOT_FOUND' | 'NOT_READY' | 'ERROR'; 
      snapshotStatus?: string; 
    };

export const SnapshotAccess = {
    async getValidatedOrCertifiedSnapshot(
        categoryId: string, 
        countryCode: string = 'IN', 
        languageCode: string = 'en',
        explicitSnapshotId?: string
    ): Promise<SnapshotAccessResult> {
        try {
            let snapshot: CategorySnapshotDoc | null = null;
            let status: string = 'UNKNOWN';

            // 1. Explicit Override (e.g. re-running old job)
            if (explicitSnapshotId) {
                const res = await CategorySnapshotStore.getSnapshotById({ categoryId, countryCode, languageCode }, explicitSnapshotId);
                if (res.ok) {
                    snapshot = res.data;
                    status = snapshot.lifecycle;
                } else {
                    return { ok: false, error: "Explicit snapshot not found", reason: 'NOT_FOUND' };
                }
            } 
            // 2. Canonical Resolution
            else {
                const resolution = await SnapshotResolver.resolveActiveSnapshot(categoryId, countryCode, languageCode);
                if (resolution.ok && resolution.snapshot) {
                    snapshot = resolution.snapshot;
                    status = resolution.snapshotStatus;
                } else {
                    return { 
                        ok: false, 
                        error: "Snapshot Not Found. Please Hydrate in Integrity Console.", 
                        reason: 'NOT_FOUND' 
                    };
                }
            }

            if (!snapshot) {
                return { ok: false, error: "Snapshot Resolution Failed", reason: 'ERROR' };
            }

            // 3. Status Gating (Includes LITE and FULL)
            if (status === 'VALIDATED' || status === 'VALIDATED_LITE' || status === 'CERTIFIED' || status === 'CERTIFIED_LITE' || status === 'CERTIFIED_FULL') {
                return {
                    ok: true,
                    snapshotId: snapshot.snapshot_id,
                    snapshot: snapshot,
                    snapshotStatus: status as any
                };
            }

            return {
                ok: false,
                error: `Snapshot Not Ready (Found ${status}). Please Validate or Certify in Integrity Console.`,
                reason: 'NOT_READY',
                snapshotStatus: status
            };

        } catch (e: any) {
            console.error(`[SnapshotAccess] Error for ${categoryId}`, e);
            return {
                ok: false,
                error: e.message || "Unknown error resolving snapshot",
                reason: 'ERROR'
            };
        }
    }
};
