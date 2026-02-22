
import { doc, setDoc } from 'firebase/firestore';
import { FirestoreClient } from './firestoreClient';
import { AuditReportV2 } from './integrity/preflightResolverAudit';
import { CorpusIndexStore } from './corpusIndexStore';
import { CategorySnapshotStore } from './categorySnapshotStore';
import { SnapshotStatsNormalizer } from './snapshotStatsNormalizer';
import { CategoryKeywordGrowthService } from './categoryKeywordGrowthService';
import { CategorySnapshotBuilder } from './categorySnapshotBuilder';
import { DfsRateLimitError, DfsUnavailableError } from '../utils/dfsRateLimiter';

export const IndexRepairService = {
    async repairCorpusIndexFromSnapshotScan(scanResults: AuditReportV2, country = 'IN', lang = 'en'): Promise<string[]> {
        const db = FirestoreClient.getDbSafe();
        const logs: string[] = [];
        const startTime = Date.now();
        
        if (!db) {
            return ['[INDEX_REPAIR][FAIL] DB_INIT_FAIL'];
        }

        logs.push(`[INDEX_REPAIR][START] Fixing pointers for ${scanResults.categories.length} categories`);

        let repairedCount = 0;
        let rateLimitedCount = 0;
        let otherFailedCount = 0;

        // Process categories sequentially to respect global rate limits
        for (const cat of scanResults.categories) {
            const categoryId = cat.categoryId;
            let snapshotId = cat.snapshotId;

            // Diagnostic filter
            if (snapshotId && (snapshotId.startsWith('diag_') || snapshotId.includes('integrity'))) {
                logs.push(`[INDEX_REPAIR][SKIP_DIAG] ${categoryId}: Ignoring diagnostic snapshot ${snapshotId}`);
                snapshotId = null;
            }

            // Ensure Draft if no snapshot resolved
            if (!snapshotId) {
                try {
                    const draftRes = await CategorySnapshotBuilder.ensureDraft(categoryId, country, lang);
                    if (draftRes.ok) {
                        snapshotId = draftRes.data.snapshot_id;
                    } else {
                        logs.push(`[INDEX_REPAIR][FAIL] ${categoryId}: Draft creation failed`);
                        otherFailedCount++;
                        continue;
                    }
                } catch (e: any) {
                    logs.push(`[INDEX_REPAIR][FAIL] ${categoryId}: Exception during draft: ${e.message}`);
                    otherFailedCount++;
                    continue;
                }
            }

            try {
                let validTotal = 0;
                let rows: any[] = [];
                let lifecycle = cat.lifecycle || 'DRAFT';
                
                const rowsRes = await CategorySnapshotStore.readAllKeywordRows({ categoryId, countryCode: country, languageCode: lang }, snapshotId!);

                if (!rowsRes.ok || !rowsRes.data) {
                    logs.push(`[INDEX_REPAIR][FAIL] ${categoryId}: Read rows failed`);
                    otherFailedCount++;
                    continue;
                }

                rows = rowsRes.data;
                validTotal = rows.filter(r => r.active === true && (r.status === 'VALID' || (r.volume || 0) > 0)).length;

                // Trigger backfill if corpus is empty/unverified
                if (validTotal === 0) {
                    logs.push(`[INDEX_REPAIR] ${categoryId}: 0 valid detected. Triggering backfill check...`);
                    
                    const backfillRes = await CategoryKeywordGrowthService.runBackfillMinimumValidation(categoryId, snapshotId!);
                    
                    if (backfillRes.ok) {
                        // Only proceed if backfill actually returned stats
                        if (backfillRes.fixedCount > 0) {
                            validTotal = backfillRes.validCount;
                            logs.push(`[INDEX_REPAIR] ${categoryId}: Backfill OK. new_valid=${validTotal}`);
                            // Reload rows to ensure normalization is accurate
                            const reload = await CategorySnapshotStore.readAllKeywordRows({ categoryId, countryCode: country, languageCode: lang }, snapshotId!);
                            if (reload.ok) rows = reload.data;
                        } else {
                            logs.push(`[INDEX_REPAIR][SKIP] ${categoryId}: Backfill complete but 0 keywords fixed.`);
                            // We don't mark as REPAIRED/WRITE_OK yet if nothing changed and still 0
                            continue;
                        }
                    } else {
                        // Handle typed DFS errors from backfill
                        throw new Error(backfillRes.error || "Backfill failed");
                    }
                }

                // Finalize and Write Pointer (FAIL CLOSED: only if validTotal > 0 or explicitly verified)
                const normLogs = await SnapshotStatsNormalizer.normalizeSnapshotStats(categoryId, snapshotId!, rows, country, lang);
                logs.push(...normLogs);

                const indexPayload = {
                    categoryId: cat.categoryId,
                    countryCode: country,
                    languageCode: lang,
                    activeSnapshotId: snapshotId!,
                    snapshotStatus: lifecycle,
                    keywordTotals: {
                        valid: validTotal,
                        total: rows.length,
                        validated: rows.filter(r => r.status !== 'UNVERIFIED').length,
                        zero: rows.filter(r => r.status === 'ZERO').length
                    },
                    source: "INDEX_REPAIR_SAFE",
                    updatedAt: new Date().toISOString()
                };

                const key = CorpusIndexStore.getKey(cat.categoryId, country, lang);
                await setDoc(doc(db, 'corpus_index', key), indexPayload, { merge: true });
                logs.push(`[INDEX_REPAIR][WRITE_OK] ${cat.categoryId} -> ${snapshotId}`);
                repairedCount++;

            } catch (e: any) {
                if (e instanceof DfsRateLimitError || e.message?.includes('DFS_RATE_LIMIT')) {
                    logs.push(`[INDEX_REPAIR][FAIL] ${categoryId}: DFS_RATE_LIMIT. Stopping run.`);
                    rateLimitedCount++;
                    // Fail closed - update no more categories
                    break; 
                }
                if (e instanceof DfsUnavailableError || e.message?.includes('DFS_UNAVAILABLE')) {
                    logs.push(`[INDEX_REPAIR][FAIL] ${categoryId}: DFS_UNAVAILABLE. Stopping run.`);
                    otherFailedCount++;
                    break;
                }
                logs.push(`[INDEX_REPAIR][FAIL] ${categoryId}: ${e.message}`);
                otherFailedCount++;
            }
        }

        const duration = Date.now() - startTime;
        console.log(`[INDEX_REPAIR_SUMMARY] total=${scanResults.categories.length} repaired=${repairedCount} rate_limited=${rateLimitedCount} failed=${otherFailedCount} duration_ms=${duration}`);
        
        return logs;
    }
};
