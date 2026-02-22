
import { JobControlService } from './jobControlService';
import { CorpusResetService } from './corpusResetService';
import { CorpusRebuildService } from './corpusRebuildService';
import { DfsPreflightService } from './dfsPreflightService';
import { DbConnectivityProbe } from './dbConnectivityProbe';
import { SnapshotResolver } from './snapshotResolver';
import { CORE_CATEGORIES } from '../constants';
import { DfsRateLimitError } from '../utils/dfsRateLimiter';
import { CredsStore } from './demand_vNext/credsStore';

export type ResetRebuildPhase = 'IDLE' | 'PREFLIGHT' | 'FLUSHING' | 'REBUILDING' | 'VERIFYING' | 'COMPLETED';

export const ResetRebuildOrchestrator = {
    async run(jobId: string, options: { resumeFromRebuild?: boolean } = {}) {
        const startTs = Date.now();
        const totalCats = CORE_CATEGORIES.length;
        let failedCats: string[] = [];
        
        const appendLog = async (msg: string, level: 'INFO' | 'WARN' | 'ERROR' = 'INFO') => {
            try {
                const job = await JobControlService.getJob(jobId);
                const logs = job?.logs || [];
                const newEntry = `[${new Date().toISOString()}] [${level}] ${msg}`;
                await JobControlService.updateProgress(jobId, { 
                    logs: [...logs, newEntry].slice(-1000) 
                });
            } catch (logErr) {
                console.error('[LOG_APPEND_FAIL]', logErr);
            }
        };

        const updateState = async (updates: any) => {
            try {
                await JobControlService.updateProgress(jobId, updates);
            } catch (stateErr) {
                console.error('[STATE_UPDATE_FAIL]', stateErr);
            }
        };

        try {
            await updateState({ status: 'RUNNING', message: 'Resolving credentials...' });
            const dfsConfig = await CredsStore.resolveDfsConfig();
            const hasCreds = !!(dfsConfig.login && dfsConfig.password) || dfsConfig.mode === 'PROXY';
            
            if (!hasCreds) {
                await appendLog("[RESET_REBUILD][ABORT] No DFS credentials configured.", 'ERROR');
                await JobControlService.finishJob(jobId, 'FAILED', 'Missing DFS Credentials.');
                return;
            }
            await appendLog(`[RESET_REBUILD][INIT] Credentials: ${dfsConfig.source.creds}. Mode: ${dfsConfig.mode}`);

            if (!options.resumeFromRebuild) {
                await updateState({ phase: 'PREFLIGHT', status: 'RUNNING', message: 'Running preflight checks...' });
                await appendLog("[RESET_REBUILD][PREFLIGHT][START]");
                const dfs = await DfsPreflightService.checkEndpoints();
                const dbRead = await DbConnectivityProbe.pingFirestoreRead();
                const dbWrite = await DbConnectivityProbe.pingFirestoreWrite();
                if (!dfs.ok || !dbRead.ok || !dbWrite.ok) {
                    const error = `Preflight failed: DFS=${dfs.ok}, DB_R=${dbRead.ok}, DB_W=${dbWrite.ok}`;
                    await appendLog(error, 'ERROR');
                    await JobControlService.finishJob(jobId, 'FAILED', error);
                    return;
                }
                await appendLog("[RESET_REBUILD][PREFLIGHT][OK]");
            }

            if (!options.resumeFromRebuild) {
                await updateState({ phase: 'FLUSHING', message: 'Deleting all snapshots and metrics...' });
                await appendLog("[RESET_REBUILD][FLUSH][START]");
                const flushSuccess = await CorpusResetService.flushAll(
                    `FLUSH dev-mens-care-india`, (msg) => appendLog(msg), jobId
                );
                if (!flushSuccess) throw new Error("Flush failed");
                await updateState({ 'progress.flushed': totalCats });
                await appendLog("[RESET_REBUILD][FLUSH][OK]");
            }

            await updateState({ phase: 'REBUILDING', message: 'Rebuilding categories...' });
            await appendLog("[RESET_REBUILD][REBUILD][START]");
            
            let successCount = 0;

            for (let i = 0; i < totalCats; i++) {
                const cat = CORE_CATEGORIES[i];
                await updateState({ 
                    message: `Rebuilding: ${cat.category} (${i+1}/${totalCats})`,
                    currentCategory: cat.category,
                    'progress.rebuilt': i
                });

                try {
                    const res = await CorpusRebuildService.rebuildSingleCategoryV3(cat.id, jobId);
                    if (!(res as any).ok) {
                        await appendLog(`[REBUILD] ${cat.category}: FAILED - ${(res as any).error || "Unknown"}`, 'WARN');
                        failedCats.push(cat.category);
                    } else {
                        await appendLog(`[REBUILD] ${cat.category}: SUCCESS`);
                        successCount++;
                    }
                } catch (e: any) {
                    await appendLog(`[REBUILD] ${cat.category}: ERROR - ${e.message} (skipping)`, 'WARN');
                    failedCats.push(cat.category);
                }
                
                await updateState({ 'progress.rebuilt': i + 1 });
            }
            await appendLog(`[RESET_REBUILD][REBUILD][DONE] success=${successCount}/${totalCats}`);

            await updateState({ phase: 'VERIFYING', message: 'Verifying...' });
            await appendLog("[RESET_REBUILD][VERIFY][START]");
            
            let verifiedCount = 0;
            for (const cat of CORE_CATEGORIES) {
                try {
                    const res = await SnapshotResolver.resolveActiveSnapshot(cat.id, 'IN', 'en');
                    if (res.ok && res.snapshotId) verifiedCount++;
                    else await appendLog(`[VERIFY] ${cat.category}: MISSING`, 'WARN');
                } catch (ve) {
                    await appendLog(`[VERIFY] ${cat.category}: ERROR`, 'WARN');
                }
            }
            await updateState({ 'progress.verified': verifiedCount });
            await appendLog(`[RESET_REBUILD][VERIFY][OK] verified=${verifiedCount}/${totalCats}`);

            const duration = Date.now() - startTs;
            const summary = `[SUMMARY] DONE success=${successCount}/${totalCats} verified=${verifiedCount} failed=[${failedCats.join(', ')}] ${duration}ms`;
            await appendLog(summary);
            await JobControlService.finishJob(jobId, 'COMPLETED', 
                failedCats.length > 0 
                    ? `Done with ${failedCats.length} failures: ${failedCats.join(', ')}`
                    : 'Global Reset & Rebuild Succeeded'
            );

        } catch (e: any) {
            console.error(e);
            const duration = Date.now() - startTs;
            await appendLog(`[RESET_REBUILD][FATAL] ${e.message}`, 'ERROR');
            await updateState({ status: 'FAILED', message: e.message });
            await appendLog(`[SUMMARY] FAILED ${duration}ms`);
        }
    }
};
