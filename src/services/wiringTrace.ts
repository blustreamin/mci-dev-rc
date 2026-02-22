
export type TraceStage = string;

const safe = (v: any) => {
  try {
    if (typeof v === "string") return v.length > 400 ? v.slice(0, 400) + "…" : v;
    if (v instanceof Error) return v.message;
    return JSON.parse(JSON.stringify(v));
  } catch {
    return String(v);
  }
};

export const WiringTrace = {
    log(id: string, categoryId: string, stage: TraceStage, payload?: any) {
        try {
            const timestamp = new Date().toISOString();
            // Deterministic console output
            console.log(`[AP][TRACE]`, { 
                traceId: id, 
                categoryId, 
                event: stage, 
                payload: payload ? safe(payload) : undefined, 
                ts: timestamp 
            });
        } catch (e) {
            // Last resort fallback
            console.error("[AP] Logging failed", e);
        }
    },

    group(label: string) {
        try {
            console.group(label);
        } catch {}
    },

    groupEnd() {
        try {
            console.groupEnd();
        } catch {}
    }
};
