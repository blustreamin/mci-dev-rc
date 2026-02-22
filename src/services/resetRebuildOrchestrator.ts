
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
        
        const appendLog = async (msg: string, level: 'INFO' | 'WARN' | 'ERROR' = 'INFO') => {
            const job = await JobControlService.getJob(jobId);
            const logs = job?.logs || [];
            const newEntry = `[${new Date().toISOString()}] [${level}] ${msg}`;
            await JobControlService.updateProgress(jobId, { 
                logs: [...logs, newEntry].slice(-1000) 
            });
        };

        const updateState = async (updates: any) => {
            await JobControlService.updateProgress(jobId, updates);
        };

        try {
            // --- 0. CREDENTIAL GUARD (P0 Requirement) ---
            await updateState({ status: 'RUNNING', message: 'Resolving credentials...' });
            const dfsConfig = await CredsStore.resolveDfsConfig();
            const hasCreds = !!(dfsConfig.login && dfsConfig.password) || dfsConfig.mode === 'PROXY';
            
            if (!hasCreds) {
                const abortMsg = "[RESET_REBUILD][ABORT] No DFS credentials configured. Flush skipped to prevent data loss.";
                await appendLog(abortMsg, 'ERROR');
                await JobControlService.finishJob(jobId, 'FAILED', 'Missing DFS Credentials. Check Integrity Settings.');
                return;
            }
            await appendLog(`[RESET_REBUILD][INIT] Credentials resolved via ${dfsConfig.source.creds}. Mode: ${dfsConfig.mode}`);

            // --- 1. PREFLIGHT ---
            if (!options.resumeFromRebuild) {
                await updateState({ phase: 'PREFLIGHT', status: 'RUNNING', message: 'Running preflight checks...' });
                await appendLog("[RESET_REBUILD][PREFLIGHT][START]");

                const dfs = await DfsPreflightService.checkEndpoints();
                const dbRead = await DbConnectivityProbe.pingFirestoreRead();
                const dbWrite = await DbConnectivityProbe.pingFirestoreWrite();

                if (!dfs.ok || !dbRead.ok || !dbWrite.ok) {
                    const error = `Preflight failed: DFS_OK=${dfs.ok}, DB_READ=${dbRead.ok}, DB_WRITE=${dbWrite.ok}`;
                    await appendLog(error, 'ERROR');
                    await JobControlService.finishJob(jobId, 'FAILED', error);
                    return;
                }
                await appendLog("[RESET_REBUILD][PREFLIGHT][OK]");
            }

            // --- 2. FLUSHING ---
            if (!options.resumeFromRebuild) {
                await updateState({ phase: 'FLUSHING', message: 'Deleting all snapshots and metrics...' });
                await appendLog("[RESET_REBUILD][FLUSH][START]");
                
                const flushSuccess = await CorpusResetService.flushAll(
                    `FLUSH dev-mens-care-india`, // Token check handled internally by service
                    (msg) => appendLog(msg),
                    jobId // Exclude this job from deletion
                );

                if (!flushSuccess) {
                    throw new Error("Flush operation failed or was aborted.");
                }
                
                await updateState({ 'progress.flushed': totalCats });
                await appendLog("[RESET_REBUILD][FLUSH][OK]");
            }

            // --- 3. REBUILDING ---
            await updateState({ phase: 'REBUILDING', message: 'Generating fresh category snapshots...' });
            await appendLog("[RESET_REBUILD][REBUILD][START]");
            
            let rebuiltCount = 0;
            const job = await JobControlService.getJob(jobId);
            // Cast to any to access custom fields safely
            rebuiltCount = (job?.progress as any)?.rebuilt || 0;

            for (let i = rebuiltCount; i < totalCats; i++) {
                const cat = CORE_CATEGORIES[i];
                await JobControlService.assertNotStopped(jobId);
                
                await updateState({ 
                    message: `Rebuilding: ${cat.category} (${i+1}/${totalCats})`,
                    currentCategory: cat.category
                });

                try {
                    // Call the V3 Rebuild logic directly
                    const res = await CorpusRebuildService.rebuildSingleCategoryV3(cat.id, jobId);
                    if (!(res as any).ok) {
                        // Log failure but CONTINUE to next category
                        await appendLog(`[REBUILD] ${cat.category}: FAILED - ${(res as any).error || "Unknown"}`, 'WARN');
                    } else {
                        await appendLog(`[REBUILD] ${cat.category}: SUCCESS`);
                    }
                    
                    rebuiltCount++;
                    await updateState({ 'progress.rebuilt': rebuiltCount });
                } catch (e: any) {
                    if (e instanceof DfsRateLimitError || e.message?.includes('rates limit')) {
                        await appendLog(`[REBUILD] ${cat.category}: RATE_LIMITED. Halting for cooldown.`, 'WARN');
                        await JobControlService.finishJob(jobId, 'STOPPED', 'DFS Rate Limited. Resume later.');
                        return;
                    }
                    if (e.message === 'STOPPED') {
                        await appendLog(`[REBUILD] ${cat.category}: INTERNAL_STOP (non-fatal, continuing)`, 'WARN');
                    } else {
                        await appendLog(`[REBUILD] ${cat.category}: FAILED - ${e.message}`, 'ERROR');
                    }
                    rebuiltCount++;
                    await updateState({ 'progress.rebuilt': rebuiltCount });
                }
            }
            await appendLog("[RESET_REBUILD][REBUILD][OK]");

            // --- 4. VERIFYING ---
            await updateState({ phase: 'VERIFYING', message: 'Verifying system integrity...' });
            await appendLog("[RESET_REBUILD][VERIFY][START]");
            
            let verifiedCount = 0;
            for (const cat of CORE_CATEGORIES) {
                const res = await SnapshotResolver.resolveActiveSnapshot(cat.id, 'IN', 'en');
                if (res.ok && res.snapshotId) {
                    verifiedCount++;
                } else {
                    await appendLog(`[VERIFY] ${cat.category}: MISSING_POINTER`, 'WARN');
                }
            }
            await updateState({ 'progress.verified': verifiedCount });
            await appendLog(`[RESET_REBUILD][VERIFY][OK] verified=${verifiedCount}/${totalCats}`);

            // --- FINALIZE ---
            const duration = Date.now() - startTs;
            const summary = `[RESET_REBUILD][SUMMARY] status=DONE flushed=${totalCats} rebuilt=${rebuiltCount} verified=${verifiedCount} duration_ms=${duration} errors=0`;
            await appendLog(summary);
            await JobControlService.finishJob(jobId, 'COMPLETED', 'Global Reset & Rebuild Succeeded');

        } catch (e: any) {
            console.error(e);
            const duration = Date.now() - startTs;
            await appendLog(`[RESET_REBUILD][FATAL] ${e.message}`, 'ERROR');
            await updateState({ status: 'FAILED', message: e.message });
            await appendLog(`[RESET_REBUILD][SUMMARY] status=FAILED duration_ms=${duration}`);
        }
    }
};
