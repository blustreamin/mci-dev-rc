
import { BatchCertificationJob, BatchCertifyRow, BatchCertifyTier } from '../types';
import { CORE_CATEGORIES } from '../constants';
import { BatchJobStore } from './batchJobStore';
import { SnapshotResolver } from './snapshotResolver';
import { CertificationReadinessService } from './certificationReadinessService';
import { CategorySnapshotBuilder } from './categorySnapshotBuilder';
import { CategoryKeywordGrowthService } from './categoryKeywordGrowthService';

export const BatchCertificationService = {
    
    abortController: null as AbortController | null,

    async startBatch(tier: BatchCertifyTier): Promise<string> {
        const jobId = `BATCH_CERT_${tier}_${Date.now()}`;
        const job: BatchCertificationJob = {
            jobId,
            tier,
            status: 'RUNNING',
            startedAtIso: new Date().toISOString(),
            updatedAtIso: new Date().toISOString(),
            cursorIndex: 0,
            totalCategories: CORE_CATEGORIES.length,
            summary: { attempted: 0, certified: 0, skipped: 0, failed: 0 },
            rows: []
        };

        await BatchJobStore.createJob(job);
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
        const job = await BatchJobStore.getJob(jobId);
        if (!job) throw new Error("Job not found");
        
        if (job.status === 'COMPLETED') return; // Already done
        
        job.status = 'RUNNING';
        await BatchJobStore.updateJob(jobId, { status: 'RUNNING' });
        this.runLoop(job);
    },

    async runLoop(job: BatchCertificationJob) {
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        try {
            for (let i = job.cursorIndex; i < CORE_CATEGORIES.length; i++) {
                if (signal.aborted) {
                    // Fixed: Using 'CANCELLED' as 'STOPPED' is not defined in the BatchCertificationJob status type.
                    await BatchJobStore.updateJob(job.jobId, { status: 'CANCELLED' });
                    return;
                }

                const cat = CORE_CATEGORIES[i];
                const startTime = Date.now();
                
                const row: BatchCertifyRow = {
                    categoryId: cat.id,
                    categoryName: cat.category,
                    tier: job.tier,
                    status: 'PENDING',
                    tookMs: 0,
                    timestamp: new Date().toISOString()
                };

                try {
                    // 1. Resolve Active Snapshot
                    const resolution = await SnapshotResolver.resolveActiveSnapshot(cat.id, 'IN', 'en');
                    
                    if (!resolution.ok || !resolution.snapshot) {
                        row.status = 'FAILED';
                        row.reasons = ["No active snapshot found (Run Hydrate/Validate)"];
                        job.summary.failed++;
                    } else {
                        const snapshot = resolution.snapshot;
                        row.snapshotId = snapshot.snapshot_id;
                        row.lifecycle = snapshot.lifecycle;

                        // 2a. Attempt Auto-Promotion to Lite
                        // If HYDRATED and has enough data, this will bump it to VALIDATED_LITE
                        if (snapshot.lifecycle === 'HYDRATED' && job.tier === 'LITE') {
                            const promoted = await CategoryKeywordGrowthService.attemptLitePromotion(snapshot, cat.id, 'IN', 'en');
                            if (promoted) {
                                row.lifecycle = 'VALIDATED_LITE'; // Update local ref
                                snapshot.lifecycle = 'VALIDATED_LITE';
                            }
                        }

                        // 2b. Lifecycle Check
                        // Now VALIDATED_LITE is a valid starting point for Certification
                        const validStates = ['VALIDATED', 'VALIDATED_LITE', 'CERTIFIED', 'CERTIFIED_LITE', 'CERTIFIED_FULL'];
                        if (!validStates.includes(snapshot.lifecycle)) {
                            row.status = 'SKIPPED';
                            row.reasons = [`Lifecycle '${snapshot.lifecycle}' not ready for certification`];
                            job.summary.skipped++;
                        } 
                        // Already Certified Check
                        else if (job.tier === 'LITE' && (snapshot.lifecycle === 'CERTIFIED_LITE' || snapshot.lifecycle === 'CERTIFIED_FULL')) {
                            row.status = 'SKIPPED';
                            row.reasons = ["Already Certified (LITE or higher)"];
                            job.summary.skipped++;
                        }
                        else if (job.tier === 'FULL' && snapshot.lifecycle === 'CERTIFIED_FULL') {
                            row.status = 'SKIPPED';
                            row.reasons = ["Already Certified FULL"];
                            job.summary.skipped++;
                        }
                        else {
                            // 3. Readiness Check
                            const readiness = CertificationReadinessService.computeReadiness(snapshot);
                            const tierResult = job.tier === 'LITE' ? readiness.lite : readiness.full;

                            if (!tierResult.pass) {
                                row.status = 'SKIPPED';
                                row.reasons = tierResult.reasons;
                                job.summary.skipped++;
                            } else {
                                // 4. Certify Execution
                                const res = await CategorySnapshotBuilder.certify(snapshot.snapshot_id, cat.id, 'IN', 'en', job.tier);
                                
                                if (res.ok) {
                                    row.status = 'CERTIFIED';
                                    row.lifecycle = res.data.lifecycle; // Update to new status
                                    job.summary.certified++;
                                } else {
                                    row.status = 'FAILED';
                                    const err = (res as { ok: false; error: string }).error;
                                    row.reasons = [err];
                                    job.summary.failed++;
                                }
                            }
                        }
                    }

                } catch (e: any) {
                    console.error(`Batch Cert Error on ${cat.id}`, e);
                    row.status = 'FAILED';
                    row.reasons = [e.message || "Unknown error"];
                    job.summary.failed++;
                }

                row.tookMs = Date.now() - startTime;
                job.rows.push(row);
                job.summary.attempted++;
                job.cursorIndex = i + 1;

                // Persist every 1 items to keep UI snappy
                await BatchJobStore.updateJob(job.jobId, {
                    cursorIndex: job.cursorIndex,
                    summary: job.summary,
                    rows: job.rows
                });

                // Throttle
                await new Promise(r => setTimeout(r, 150));
            }

            await BatchJobStore.updateJob(job.jobId, { status: 'COMPLETED' });

        } catch (e) {
            console.error("Batch Loop Fatal Error", e);
            await BatchJobStore.updateJob(job.jobId, { status: 'FAILED' });
        } finally {
            this.abortController = null;
        }
    }
};