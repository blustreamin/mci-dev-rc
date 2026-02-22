
export type DeepDivePhase = 
    | 'IDLE' 
    | 'QUEUED' 
    | 'INPUTS_RESOLVED' 
    | 'MODEL_CALLING' 
    | 'MODEL_STREAMING' 
    | 'WRITING_RESULTS' 
    | 'POINTER_UPDATED' 
    | 'COMPLETE' 
    | 'ERROR' 
    | 'TIMEOUT';

export type DeepDiveTelemetryEvent = {
    ts: number;
    phase: DeepDivePhase;
    message: string;
    meta?: Record<string, unknown>;
};

type Listener = (event: DeepDiveTelemetryEvent) => void;

class DeepDiveTelemetryBusImpl {
    private listeners = new Map<string, Set<Listener>>();
    private history = new Map<string, DeepDiveTelemetryEvent[]>();
    private lastPhase = new Map<string, DeepDivePhase>();

    public emit(runKey: string, phase: DeepDivePhase, message: string, meta?: Record<string, unknown>) {
        const event: DeepDiveTelemetryEvent = {
            ts: Date.now(),
            phase,
            message,
            meta
        };

        // Update history (Ring buffer 200)
        if (!this.history.has(runKey)) this.history.set(runKey, []);
        const logs = this.history.get(runKey)!;
        logs.unshift(event);
        if (logs.length > 200) logs.length = 200;

        this.lastPhase.set(runKey, phase);

        // Notify
        const subs = this.listeners.get(runKey);
        if (subs) {
            subs.forEach(cb => cb(event));
        }
        
        // Dev log
        console.log(`[DD_TELEMETRY][${runKey}] ${phase}: ${message}`);
    }

    public subscribe(runKey: string, cb: Listener): () => void {
        if (!this.listeners.has(runKey)) this.listeners.set(runKey, new Set());
        this.listeners.get(runKey)!.add(cb);
        return () => {
            const subs = this.listeners.get(runKey);
            if (subs) {
                subs.delete(cb);
                if (subs.size === 0) this.listeners.delete(runKey);
            }
        };
    }

    public getSnapshot(runKey: string) {
        return {
            logs: this.history.get(runKey) || [],
            phase: this.lastPhase.get(runKey) || 'IDLE'
        };
    }
}

export const DeepDiveTelemetryBus = new DeepDiveTelemetryBusImpl();
