
import { BatchVerificationJob, BatchVerificationRow } from '../types';
import { CORE_CATEGORIES } from '../constants';
import { BatchJobStore } from './batchJobStore';
import { SnapshotResolver } from './snapshotResolver';
import { LiteVerificationRunner } from './liteVerificationRunner';

export const BulkLiteVerificationService = {
    
    abortController: null as AbortController | null,

    async startBatch(): Promise<string> {
        const jobId = `BATCH_VERIFY_LITE_${Date.now()}`;
        const job: BatchVerificationJob = {
            jobId,
            type: 'LITE_VERIFICATION',
            status: 'RUNNING',
            startedAtIso: new Date().toISOString(),
            updatedAtIso: new Date().toISOString(),
            cursorIndex: 0,
            totalCategories: CORE_CATEGORIES.length,
            summary: { attempted: 0, validated: 0, skipped: 0, failed: 0 },
            rows: []
        };

        await BatchJobStore.createVerificationJob(job);
        this.runLoop(job); // Fire and forget
        return jobId;
    },

    async stopBatch() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
    },

    async resumeBatch(jobId: string): Promise<void> {
        const job = await BatchJobStore.getVerificationJob(jobId);
        if (!job) throw new Error("Job not found");
        
        if (job.status === 'COMPLETED') return; 
        
        job.status = 'RUNNING';
        await BatchJobStore.updateVerificationJob(jobId, { status: 'RUNNING' });
        this.runLoop(job);
    },

    async runLoop(job: BatchVerificationJob) {
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        try {
            for (let i = job.cursorIndex; i < CORE_CATEGORIES.length; i++) {
                if (signal.aborted) {
                    // Fixed: Using 'CANCELLED' as 'STOPPED' is not defined in the BatchVerificationJob status type.
                    await BatchJobStore.updateVerificationJob(job.jobId, { status: 'CANCELLED' });
                    return;
                }

                const cat = CORE_CATEGORIES[i];
                const startTime = Date.now();
                
                const row: BatchVerificationRow = {
                    categoryId: cat.id,
                    categoryName: cat.category,
                    status: 'PENDING',
                    tookMs: 0,
                    timestamp: new Date().toISOString()
                };

                try {
                    // 1. Resolve Active Snapshot
                    const resolution = await SnapshotResolver.resolveActiveSnapshot(cat.id, 'IN', 'en');
                    
                    if (!resolution.ok || !resolution.snapshot) {
                        row.status = 'FAILED';
                        row.reasons = ["No active snapshot (Hydrate first)"];
                        job.summary.failed++;
                    } else {
                        const snapshot = resolution.snapshot;
                        row.snapshotId = snapshot.snapshot_id;
                        row.lifecycle = snapshot.lifecycle;

                        // 2. Run Verification
                        const res = await LiteVerificationRunner.runLiteVerification(snapshot.snapshot_id, cat.id, 'IN', 'en');
                        
                        row.status = res.status;
                        row.reasons = res.reasons;
                        if (res.validatedCount !== undefined) {
                            row.metrics = { valid: res.validatedCount, total: snapshot.stats.keywords_total };
                        }

                        if (res.status === 'VALIDATED_LITE') job.summary.validated++;
                        else if (res.status === 'SKIPPED') job.summary.skipped++;
                        else job.summary.failed++;
                        
                        // Update lifecycle in row if changed
                        if (res.status === 'VALIDATED_LITE') row.lifecycle = 'VALIDATED_LITE';
                    }

                } catch (e: any) {
                    console.error(`Batch Verify Error on ${cat.id}`, e);
                    row.status = 'FAILED';
                    row.reasons = [e.message || "Unknown error"];
                    job.summary.failed++;
                }

                row.tookMs = Date.now() - startTime;
                job.rows.push(row);
                job.summary.attempted++;
                job.cursorIndex = i + 1;

                // Update Job State
                await BatchJobStore.updateVerificationJob(job.jobId, {
                    cursorIndex: job.cursorIndex,
                    summary: job.summary,
                    rows: job.rows
                });

                // Backoff for safety (DataForSEO Standard)
                await new Promise(r => setTimeout(r, 250));
            }

            await BatchJobStore.updateVerificationJob(job.jobId, { status: 'COMPLETED' });

        } catch (e) {
            console.error("Batch Verification Loop Fatal Error", e);
            await BatchJobStore.updateVerificationJob(job.jobId, { status: 'FAILED' });
        } finally {
            this.abortController = null;
        }
    }
};