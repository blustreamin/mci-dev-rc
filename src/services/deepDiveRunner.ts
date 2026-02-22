
import { DeepDiveResultV2 } from '../types';
import { DeepDiveInputService } from './deepDiveInputService';
import { DeepDiveServiceV2 } from './deepDiveServiceV2';
import { HeartbeatController } from './jobHeartbeat';
import { JobControlService } from './jobControlService';
import { DeepDiveTelemetryBus } from './deepDiveTelemetryBus';
import { MCI_DEEPDIVE_MODEL_TIMEOUT_MS } from '../config/featureFlags';

export interface DeepDiveRunOptions {
    runId?: string;
    bypassCache?: boolean;
}

export const DeepDiveRunner = {
    
    async runDeepDive(
        categoryId: string, 
        month: string,
        onProgress: (msg: string) => void,
        options: DeepDiveRunOptions = {}
    ): Promise<DeepDiveResultV2> {
        
        // Use provided runId or generate one for telemetry continuity
        const runId = options.runId || `DD_RUN_${categoryId}_${Date.now()}`;

        // 1. Initialize Job in Firestore (Critical for Heartbeat)
        const jobId = await JobControlService.startJob('RUN_DEEP_DIVE', categoryId, {
            message: 'Initializing Deep Dive...',
            // We can link the telemetry runId to the job metadata if needed
            inputsUsed: [{ key: 'telemetryRunId', value: runId }] 
        });
        
        const hb = new HeartbeatController(jobId);
        hb.start("RESOLVE_INPUTS");

        DeepDiveTelemetryBus.emit(runId, 'QUEUED', `Job started: ${jobId}`);

        let watchdog: any = null;

        try {
            // 2. Resolve Inputs
            onProgress("Resolving Snapshots...");
            DeepDiveTelemetryBus.emit(runId, 'QUEUED', "Resolving inputs...");
            
            const inputs = await DeepDiveInputService.resolveAndBindInputs(categoryId, month);
            
            const signalCount = inputs.signals.items.length;
            const statusMsg = `Inputs Ready: ${signalCount} signals. Mode: ${inputs.signals.mode}`;
            onProgress(statusMsg);
            
            DeepDiveTelemetryBus.emit(runId, 'INPUTS_RESOLVED', statusMsg, { 
                signalCount, 
                mode: inputs.signals.mode,
                demandOk: inputs.demand.ok,
                metrics: inputs.demand.metrics
            });

            // Update Job State with Input Info
            await hb.tick("SYNTHESIS", { 
                telemetry: { signalCount, signalMode: inputs.signals.mode } 
            });

            // 3. Synthesis via Service (with Timeout Race)
            onProgress("Synthesizing Strategy...");
            DeepDiveTelemetryBus.emit(runId, 'MODEL_CALLING', `Invoking Generative Model (${inputs.signals.mode})...`);

            // EXECUTE WITH TIMEOUT
            const timeoutPromise = new Promise<never>((_, reject) => {
                watchdog = setTimeout(() => {
                    reject(new Error(`MODEL_TIMEOUT: Exceeded ${MCI_DEEPDIVE_MODEL_TIMEOUT_MS}ms`));
                }, MCI_DEEPDIVE_MODEL_TIMEOUT_MS);
            });

            // Execute the v2 service call
            const resultPromise = DeepDiveServiceV2.run(categoryId, month, inputs);
            
            const result = await Promise.race([resultPromise, timeoutPromise]);
            clearTimeout(watchdog);
            
            // Check for explicit failure from Service layer
            if (result.status === 'FAILED_LLM' || (result.verdict && result.verdict === 'FAIL')) {
                const errMsg = result.failCode || result.warnings?.[0] || "Analysis Failed via Verdict";
                DeepDiveTelemetryBus.emit(runId, 'ERROR', errMsg);
                await hb.stop('FAILED', errMsg);
                return result; 
            }

            DeepDiveTelemetryBus.emit(runId, 'WRITING_RESULTS', "Persisting analysis...");
            await hb.stop('COMPLETED', 'Deep Dive Generation Complete');
            
            DeepDiveTelemetryBus.emit(runId, 'COMPLETE', "Analysis Complete", { docId: result.categoryId });

            return result;

        } catch (e: any) {
            if (watchdog) clearTimeout(watchdog);
            console.error("Deep Dive Runner Failed", e);
            
            const isTimeout = e.message?.includes('MODEL_TIMEOUT');
            const phase = isTimeout ? 'TIMEOUT' : 'ERROR';
            const msg = isTimeout ? "Model timed out (120s). Try simpler inputs." : (e.message || "Unknown Runner Error");

            DeepDiveTelemetryBus.emit(runId, phase, msg);
            await hb.stop('FAILED', e.message);
            throw e;
        }
    }
};
