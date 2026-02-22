
// Safe env access helper
const getEnv = (key: string) => {
    if (typeof process !== 'undefined' && process.env && process.env[key]) return process.env[key];
    if ((import.meta as any).env && (import.meta as any).env[key]) return (import.meta as any).env[key];
    return undefined;
};

export const FORCE_CERTIFY_MODE = false; // STRICT ENFORCEMENT: Never allow bypass in this build
export const BUILD_STAMP = `RC_${Date.now()}`;
export const FF_REPAIR_VALIDATION_V4 = false; // Default OFF for safe rollout

// P0: Demand Baseline Mode (Default TRUE for AI Studio stability)
export const DEMAND_BASELINE_MODE = true;
