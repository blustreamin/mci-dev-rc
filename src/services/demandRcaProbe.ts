
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { FirestoreClient } from './firestoreClient';
import { DemandSnapshotResolver } from './deepDiveSnapshotResolvers';
import { SnapshotResolver } from './snapshotResolver';
import { loadSnapshotRowsLiteChunked } from './snapshotChunkReader';

export const DemandRcaProbeService = {
  async runDemandRca(categoryId: string, monthKey: string): Promise<any> {
    const report: any = {
      ts: new Date().toISOString(),
      params: { categoryId, monthKey },
      probes: {}
    };

    const db = FirestoreClient.getDbSafe();
    if (!db) return { error: "DB_INIT_FAIL" };

    // A. Output Snapshot Probe
    try {
      const res = await DemandSnapshotResolver.resolve(categoryId, monthKey);
      report.probes.output = {
        resolved: res.ok,
        snapshotId: res.snapshotId,
        lifecycle: res.lifecycle,
        demand_index_mn: res.data?.demand_index_mn,
        metrics: res.data ? {
          readiness: res.data.metric_scores?.readiness,
          spread: res.data.metric_scores?.spread,
          trend: res.data.trend_5y?.value_percent
        } : 'DATA_MISSING',
        corpusSnapshotId: res.corpusSnapshotId,
        mode: res.mode,
        rawReason: res.reason
      };
    } catch (e: any) {
      report.probes.output = { error: e.message };
    }

    // B. Corpus Snapshot Probe
    let corpusId: string | undefined;
    try {
      const res = await SnapshotResolver.resolveActiveSnapshot(categoryId, 'IN', 'en');
      if (res.ok && res.snapshot) {
        corpusId = res.snapshot.snapshot_id;
        report.probes.corpus = {
          snapshotId: res.snapshot.snapshot_id,
          lifecycle: res.snapshot.lifecycle,
          stats: res.snapshot.stats,
          integrity: res.snapshot.integrity
        };
      } else {
        report.probes.corpus = { status: 'NOT_FOUND', reason: res.reason };
      }
    } catch (e: any) {
      report.probes.corpus = { error: e.message };
    }

    // C. Loader Probe
    if (corpusId) {
      try {
        // Load chunks similar to DemandMetricsRunner
        const { chunks, totalRows } = await loadSnapshotRowsLiteChunked(
            categoryId, 
            corpusId, 
            { chunkSize: 500, maxChunks: 20, seed: `RCA-${categoryId}` }, 
            { onlyValid: false } // Load everything to diagnose
        );
        
        const allRows = chunks.flat();
        const nonZeroGoogle = allRows.filter(r => (r.volume || 0) > 0).length;
        const nonZeroAmazon = allRows.filter(r => (r.amazonVolume || 0) > 0).length;
        const active = allRows.filter(r => r.active !== false).length;
        const validStatus = allRows.filter(r => r.status === 'VALID').length;

        // D. Filter Simulation
        const rowsUsedByGoogleMath = allRows.filter(r => r.active !== false && (r.volume || 0) > 0).length;
        const dropZero = allRows.filter(r => r.active !== false && (r.volume || 0) <= 0).length;
        const dropInactive = allRows.filter(r => r.active === false).length;
        const dropMissingStatus = allRows.filter(r => !r.status).length;
        const dropMissingAnchor = allRows.filter(r => !r.anchor_id).length;

        report.probes.loader = {
           totalRowsReturned: allRows.length,
           totalRowsInMeta: totalRows,
           nonZeroGoogleCount: nonZeroGoogle,
           nonZeroAmazonCount: nonZeroAmazon,
           activeCount: active,
           validStatusCount: validStatus,
           top10ByGoogleVolume: allRows
             .sort((a,b) => (b.volume||0) - (a.volume||0))
             .slice(0, 10)
             .map(r => ({ k: r.keyword, v: r.volume, amz: r.amazonVolume, st: r.status, act: r.active }))
        };

        report.probes.filterSimulation = {
            rowsUsedByGoogleMath,
            rowsDropped: {
                dropped_zero_volume: dropZero,
                dropped_inactive: dropInactive,
                dropped_missing_status: dropMissingStatus,
                dropped_missing_anchor: dropMissingAnchor
            }
        };

      } catch (e: any) {
        report.probes.loader = { error: e.message };
      }
    } else {
        report.probes.loader = { status: 'SKIPPED', reason: 'No Corpus ID resolved' };
    }

    // E. Output Write Path Probe
    try {
        const path = `mci_outputs/IN/en/${categoryId}/snapshots`;
        const q = query(collection(db, path), orderBy('created_at_iso', 'desc'), limit(3));
        const snap = await getDocs(q);
        
        report.probes.recentOutputs = snap.docs.map(d => {
            const data = d.data();
            const sweep = data.demand || data; // handle wrappers
            return {
                id: d.id,
                created: data.created_at_iso || sweep?.created_at_iso,
                lifecycle: data.lifecycle,
                demandIndex: sweep?.demand_index_mn
            };
        });
    } catch (e: any) {
        report.probes.recentOutputs = { error: e.message };
    }

    return report;
  }
};
