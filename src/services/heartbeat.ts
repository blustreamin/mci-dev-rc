
/**
 * Deterministic Heartbeat Service
 * Provides a reliable, in-memory tick for system health monitoring.
 */

export type Beat = { tick: number; ts: number };

let state: Beat = { tick: 0, ts: Date.now() };
let started = false;

export function startHeartbeat() {
  if (started) return;
  started = true;

  const interval = 750;
  setInterval(() => {
    state = { tick: state.tick + 1, ts: Date.now() };
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent("mci:heartbeat", { detail: state }));
    }
  }, interval);
  
  console.log("[HEARTBEAT] Started.");
}

export function getHeartbeat(): Beat {
  return state;
}
