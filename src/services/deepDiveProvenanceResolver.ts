
import { DeepDiveResultV2 } from '../types';
import { DemandSnapshotResolver } from './deepDiveSnapshotResolvers';

export interface ResolvedProvenance {
    demandSnapshotId: string;
    signalMode: string;
    confidence: string;
    isBackfill: boolean;
    displayDemand: string;
    displayConf: string;
}

export const DeepDiveProvenanceResolver = {
    async resolveDeepDiveProvenance(result: DeepDiveResultV2): Promise<ResolvedProvenance> {
        const prov = result.provenance || ({} as any);
        
        let demandId = prov.demandSnapshotId;
        let isBackfill = false;

        // UI HEURISTIC: If demand snapshot is missing but we have metrics, it's likely a valid run
        // with a missing link. We try to resolve it for display purposes.
        if (!demandId || demandId === 'MISSING' || demandId === 'NONE') {
            try {
                // Attempt soft resolve (non-blocking)
                const res = await DemandSnapshotResolver.resolve(result.categoryId, result.monthKey);
                if (res.ok && res.snapshotId) {
                    demandId = res.snapshotId;
                } else {
                    isBackfill = true;
                }
            } catch (e) {
                isBackfill = true;
            }
        }

        // Integrity Check: High Confidence requires Demand ID
        let confidence = prov.dataConfidence || 'UNKNOWN';
        if (confidence === 'HIGH' && (!demandId || demandId === 'MISSING')) {
            // Downgrade display confidence if link is broken
            confidence = 'BACKFILL';
            isBackfill = true;
        }

        return {
            demandSnapshotId: demandId || 'UNRESOLVED',
            signalMode: prov.signalMode || 'UNKNOWN',
            confidence,
            isBackfill,
            // Display Helpers
            displayDemand: (demandId && demandId !== 'MISSING' && demandId !== 'NONE') ? demandId : 'UNRESOLVED',
            displayConf: confidence
        };
    }
};
