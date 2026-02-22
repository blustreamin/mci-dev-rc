
// Safe env access helper
const getEnv = (key: string) => {
    if (typeof process !== 'undefined' && process.env && process.env[key]) return process.env[key];
    if ((import.meta as any).env && (import.meta as any).env[key]) return (import.meta as any).env[key];
    return undefined;
};

export const readBoolEnv = (key: string, def: boolean): boolean => {
    const val = getEnv(key);
    if (val === 'true' || val === '1') return true;
    if (val === 'false' || val === '0') return false;
    return def;
};

export const readNumEnv = (key: string, def: number): number => {
    const val = getEnv(key);
    const num = Number(val);
    return isNaN(num) ? def : num;
};

// --- FEATURE FLAGS ---

// Toggle Signal Corpus Integration for Deep Dive (Default: FALSE for safety, can be enabled via env)
export const ENABLE_SIGNAL_CORPUS = readBoolEnv('VITE_MCI_ENABLE_SIGNAL_CORPUS', false);

// Toggle Pointer-based Read for Deep Dive UI (Default: TRUE)
export const ENABLE_DEEPDIVE_POINTER_READ = readBoolEnv('VITE_MCI_ENABLE_DEEPDIVE_POINTER_READ', true);

// Max signals to ingest from Corpus (Default: 90)
export const DEEPDIVE_SIGNAL_LIMIT = readNumEnv('VITE_MCI_DEEPDIVE_SIGNAL_LIMIT', 90);

// --- V2 UPGRADE FLAGS ---
export const MCI_ENABLE_DEEPDIVE_CONTRACT = readBoolEnv('VITE_MCI_ENABLE_DEEPDIVE_CONTRACT', true); // Enabled by default for stability
export const MCI_ENABLE_DEEPDIVE_RUN_TRANSCRIPT = readBoolEnv('VITE_MCI_ENABLE_DEEPDIVE_RUN_TRANSCRIPT', true);
export const MCI_ENABLE_DEMAND_ONLY_DEEPDIVE = readBoolEnv('VITE_MCI_ENABLE_DEMAND_ONLY_DEEPDIVE', false);
export const MCI_DEEPDIVE_MODEL_TIMEOUT_MS = readNumEnv('VITE_MCI_DEEPDIVE_MODEL_TIMEOUT_MS', 120000);

// --- INTEGRITY FLAGS ---
export const MCI_ENABLE_INTEGRITY_CONTRACT_AUDIT = readBoolEnv('VITE_MCI_ENABLE_INTEGRITY_CONTRACT_AUDIT', true);
