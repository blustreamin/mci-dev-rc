import { JobControlService } from './jobControlService';
import { CorpusJobControl } from '../types';

export class HeartbeatController {
    private intervalId: any = null;
    private lastUpdateAt: number = 0;
    private currentStage: string = 'INIT';
    private telemetry: any = {};
    private progress: { processed: number; total: number } = { processed: 0, total: 0 };

    constructor(private jobId: string, baseTelemetry: any = {}) {
        this.telemetry = { ...baseTelemetry };
    }

    start(initialStage: string = 'START') {
        this.currentStage = initialStage;
        this.lastUpdateAt = Date.now();
        console.log(`[HEARTBEAT][START] jobId=${this.jobId}`);
        
        this.intervalId = setInterval(async () => {
            await this.performUpdate();
        }, 3000);
    }

    async tick(stage: string, updates: { telemetry?: any; progress?: { processed: number; total: number } } = {}) {
        this.currentStage = stage;
        if (updates.telemetry) {
            this.telemetry = { ...this.telemetry, ...updates.telemetry };
        }
        if (updates.progress) {
            this.progress = updates.progress;
        }
        await this.performUpdate();
    }

    private async performUpdate() {
        try {
            await JobControlService.updateProgress(this.jobId, {
                message: `Stage: ${this.currentStage}`,
                telemetry: this.telemetry,
                progress: this.progress,
                // Pass ISO string to string field
                updatedAt: new Date().toISOString()
            });
            this.lastUpdateAt = Date.now();
        } catch (e) {
            console.error(`[HEARTBEAT][ERR] Failed to update progress for ${this.jobId}`, e);
        }
    }

    async stop(status: CorpusJobControl['status'] = 'COMPLETED', message?: string) {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        console.log(`[HEARTBEAT][STOP] jobId=${this.jobId} status=${status}`);
        await JobControlService.finishJob(this.jobId, status, message);
    }

    async assertNotStopped() {
        const job = await JobControlService.getJob(this.jobId);
        if (job && (job.stopRequested || job.status === 'STOPPED' || job.status === 'FAILED')) {
            await this.stop('STOPPED', 'User requested stop');
            throw new Error('STOPPED');
        }
    }
}