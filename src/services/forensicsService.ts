
import { SnapshotResolver } from './snapshotResolver';
import { CategorySnapshotStore } from './categorySnapshotStore';
import { CategoryKeywordGuard } from './categoryKeywordGuard';
import { FirestoreClient } from './firestoreClient';
import { FirestoreVolumeCache } from './firestoreVolumeCache';
import { normalizeKeywordString } from '../driftHash';
import { doc, getDoc } from 'firebase/firestore';
import { SnapshotKeywordRow } from '../types';

export const ForensicsService = {
  
  /**
   * P0 Phase 0: Read-Only analysis of backfill potential.
   */
  async runBackfillForensics(targetCategories: string[] = ['shaving', 'beard', 'hair-styling', 'deodorants']) {
      const db = FirestoreClient.getDbSafe();
      if (!db) return { error: "DB_INIT_FAIL" };

      const report: any = {
        ts: new Date().toISOString(),
        categories: [],
        rootCauseHint: "UNKNOWN"
      };

      for (const catId of targetCategories) {
          const catLog: any = {
              categoryId: catId,
              resolver: { source: 'NONE', snapshotId: null },
              rows: 0,
              vol: { present: 0, missing: 0, gt0: 0 },
              amz: { present: 0, missing: 0, gt0: 0 },
              statusCounts: {},
              activeTrue: 0,
              guard: { pass: 0, fail: 0, examples: [] as string[] },
              cacheProbe: { hits: 0, misses: 0 }
          };

          // 1. Resolve Snapshot (Using new robust resolver)
          const res = await SnapshotResolver.resolveActiveSnapshot(catId, 'IN', 'en');
          catLog.resolver.source = res.source;
          catLog.resolver.snapshotId = res.snapshotId;

          if (res.snapshotId) {
              // 2. Load Rows
              const rowsRes = await CategorySnapshotStore.readAllKeywordRows(
                  { categoryId: catId, countryCode: 'IN', languageCode: 'en' }, 
                  res.snapshotId
              );
              
              if (rowsRes.ok) {
                  const rows = rowsRes.data;
                  catLog.rows = rows.length;

                  // 3. Compute Stats
                  rows.forEach(r => {
                      if (typeof r.volume === 'number') {
                          catLog.vol.present++;
                          if (r.volume > 0) catLog.vol.gt0++;
                      } else {
                          catLog.vol.missing++;
                      }

                      if (typeof r.amazonVolume === 'number') {
                          catLog.amz.present++;
                          if (r.amazonVolume > 0) catLog.amz.gt0++;
                      } else {
                          catLog.amz.missing++;
                      }

                      const st = r.status || 'NONE';
                      catLog.statusCounts[st] = (catLog.statusCounts[st] || 0) + 1;
                      if (r.active) catLog.activeTrue++;
                  });

                  // 4. Guard Sample
                  const sample = rows.slice(0, 50);
                  sample.forEach(r => {
                      const check = CategoryKeywordGuard.isSpecific(r.keyword_text, catId);
                      if (check.ok) catLog.guard.pass++;
                      else {
                          catLog.guard.fail++;
                          if (catLog.guard.examples.length < 10) catLog.guard.examples.push(`${r.keyword_text} (${check.reason})`);
                      }
                  });

                  // 5. Cache Probe (10 missing)
                  const probeSet = rows.filter(r => typeof r.volume !== 'number').slice(0, 10);
                  for (const r of probeSet) {
                      const key = FirestoreVolumeCache.getKey('IN', 'en', 2356, r.keyword_text);
                      try {
                          const cSnap = await getDoc(doc(db, 'keyword_volume_cache', key));
                          if (cSnap.exists()) catLog.cacheProbe.hits++;
                          else catLog.cacheProbe.misses++;
                      } catch (e) {}
                  }
              }
          }

          report.categories.push(catLog);
      }

      // Root Cause Heuristics
      const allResolved = report.categories.every((c: any) => c.resolver.snapshotId);
      const allZeroValid = report.categories.every((c: any) => c.vol.gt0 === 0);
      const guardFailHigh = report.categories.some((c: any) => c.guard.fail > c.guard.pass);

      if (!allResolved) report.rootCauseHint = "SCAN_BUG";
      else if (allZeroValid) report.rootCauseHint = "DFS_EMPTY";
      else if (guardFailHigh) report.rootCauseHint = "GUARD_OVERKILL";
      else report.rootCauseHint = "UNKNOWN";

      return report;
  },

  async runForensics(targetCategories: string[] = ['shaving', 'beard', 'hair-styling']) {
    return this.runBackfillForensics(targetCategories);
  }
};
