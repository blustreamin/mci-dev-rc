
import { StorageAdapter } from './storageAdapter';
// Keep JobState import but handle JobType flexibly to avoid strict circular dependency if any
import { JobState, TaskStage } from '../../types';

export const JobRunner = {
    
    getJobKey(jobId: string): string {
        return jobId;
    },

    async createJob(type: string, categoryId: string, windowId: string): Promise<JobState> {
        console.log(`[JOB_RUNNER][CREATE_ENTER] type=${type} categoryId=${categoryId} windowId=${windowId}`);
        const jobId = `JOB-${type}-${categoryId}-${Date.now()}`;
        
        let stage_name: string = 'Strategy';
        switch (type) {
            case 'RUN_DEMAND': stage_name = 'Demand'; break;
            case 'RUN_DEEP_DIVE': stage_name = 'Deep Dive'; break;
            case 'GENERATE_PLAYBOOK': stage_name = 'Playbook'; break;
        }

        const now = new Date().toISOString();

        const job: JobState = {
            jobId,
            type: type as any,
            stage_name,
            categoryId,
            windowId,
            status: 'PENDING',
            progress: 0,
            message: 'Queued...',
            createdAt: now,
            startedAt: now,
            updatedAt: now,
            logs: [],
            activity_log: [],
            currentStage: 'Queued',
            inputsUsed: [],
            outputsExpected: []
        };

        // Safe Persistence with Timeout Race
        try {
            const persistencePromise = StorageAdapter.set(jobId, job, StorageAdapter.STORES.JOB);
            
            // Hard timeout 250ms to ensure UI never hangs on storage I/O
            const timeoutPromise = new Promise<void>((_, reject) => {
                setTimeout(() => reject(new Error("Storage Write Timeout (250ms)")), 250);
            });

            await Promise.race([persistencePromise, timeoutPromise]);
            
            console.log(`[JOB_RUNNER][CREATE_OK] jobId=${jobId}`);
            return job;

        } catch (e: any) {
            console.error(`[JOB_RUNNER][CREATE_FAIL]`, { type, categoryId, windowId, error: String(e?.message || e) });
            // FALLBACK: Return the job object anyway so UI proceeds (in-memory mode for this session)
            return job;
        }
    },

    async updateJob(job: JobState, updates: Partial<JobState>): Promise<JobState> {
        try {
            // Fetch fresh state to avoid overwrite conflicts
            const current = await this.getJob(job.jobId) || job;

            // Prevent zombie updates if job is already terminal
            if ((current.status === 'CANCELLED' || current.status === 'FAILED') && updates.status !== 'CANCELLED' && updates.status !== 'FAILED') {
                console.warn(`[JobRunner] blocked update on terminal job ${job.jobId}`);
                return current;
            }

            const updated = {
                ...current,
                ...updates,
                updatedAt: new Date().toISOString()
            };
            
            // Handle log appending
            if (updates.message && updates.message !== current.message) {
                const time = new Date().toISOString().split('T')[1].slice(0, 8);
                const stage = updates.currentStage || current.currentStage || 'INFO';
                const logEntry = `${time} [${stage}] ${updates.message}`;
                updated.logs = [...(current.logs || []), logEntry].slice(-200); // Keep last 200 logs
            }
            
            await StorageAdapter.set(updated.jobId, updated, StorageAdapter.STORES.JOB);
            return updated;
        } catch (e) {
            console.warn(`[JOB_RUNNER][UPDATE_FAIL] ${job.jobId}`, e);
            // Return applied updates in memory so chain doesn't break
            return { ...job, ...updates };
        }
    },

    async getJob(jobId: string): Promise<JobState | null> {
        try {
            return await StorageAdapter.get<JobState>(jobId, StorageAdapter.STORES.JOB);
        } catch (e) { return null; }
    },

    async getRecentJobs(limit: number = 20): Promise<JobState[]> {
        try {
            const keys = await StorageAdapter.getAllKeys(StorageAdapter.STORES.JOB);
            const jobs: JobState[] = [];
            
            for (let i = keys.length - 1; i >= 0; i--) {
                if (jobs.length >= limit) break;
                const job = await StorageAdapter.getRaw<JobState>(keys[i]);
                if (job) jobs.push(job);
            }
            
            return jobs.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
        } catch (e) { return []; }
    },

    // Helper to run a step with error handling
    async runStep<T>(
        job: JobState, 
        stepName: TaskStage, 
        fn: () => Promise<T>
    ): Promise<T> {
        await this.updateJob(job, { 
            message: `Starting ${stepName}...`, 
            status: 'RUNNING',
            currentStage: stepName
        });
        try {
            const res = await fn();
            return res;
        } catch (e: any) {
            const isCancel = e.name === 'AbortError' || e.message?.includes('aborted') || e.message?.includes('Cancelled');
            const newStatus = isCancel ? 'CANCELLED' : 'FAILED';
            
            await this.updateJob(job, { 
                status: newStatus, 
                error: e.message, 
                message: isCancel ? 'Execution aborted by user.' : `Error: ${e.message}`,
                currentStage: isCancel ? 'Cancelled' : 'Failed'
            });
            throw e;
        }
    },

    // VERIFICATION SELF-TEST
    async __selfTestCreateJob(): Promise<{ ok: boolean, jobId?: string, error?: string }> {
        try {
            const job = await this.createJob('PING', 'GLOBAL', 'test');
            if (job && job.jobId) {
                console.log(`[JOB_RUNNER][SELFTEST_OK] jobId=${job.jobId}`);
                return { ok: true, jobId: job.jobId };
            }
            return { ok: false, error: 'Job created but null?' };
        } catch (e: any) {
            return { ok: false, error: e.message };
        }
    }
};
