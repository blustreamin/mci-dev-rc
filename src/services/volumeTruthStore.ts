
import { StorageAdapter } from './storageAdapter';
import { Normalization } from './normalization';
import { TRUTH_STORE_DEPRECATED } from '../../constants';

// --- Types ---

export interface TruthHistoryPoint {
    date: string;
    volume: number;
}

export interface DerivedDemandMetrics {
    demandBase: number;
    demandNow: number;
    momentum: number;
    trend6m: number;
    trend12m: number;
    seasonality: {
        peakMonth: number;
        strength: number;
    };
    volatility: number;
    recencyCoverage: number;
    demandScore: number;
    trend5y?: number | null;
}

export interface TruthVolume {
    keywordKey: string;
    windowId: string;
    estimator: string;
    truthVolume: number;
    observationCount: number;
    lastUpdatedAt: string;
    truthHash: string; 
    derivedMetrics?: DerivedDemandMetrics;
    truthHistory?: TruthHistoryPoint[];
}

const OBS_PREFIX = 'obs::';
const TRUTH_PREFIX = 'truth::';

// --- Helpers ---

export async function computeSHA256(str: string): Promise<string> {
    const textAsBuffer = new TextEncoder().encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', textAsBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// --- Service ---

export const VolumeTruthStore = {
    
    async recordObservation(keyword: string, windowId: string, volume: number, source: any): Promise<void> {
        if (TRUTH_STORE_DEPRECATED) throw new Error("TRUTH_STORE_DEPRECATED_ACCESS: recordObservation");
    },

    async getTruthVolume(keyword: string, windowId: string): Promise<TruthVolume | null> {
        if (TRUTH_STORE_DEPRECATED) {
            // Soft fail or throw? The requirement says "Disable / bypass". 
            // If caller handles it, null is safer, but strictly we should stop usage.
            console.warn("Legacy Truth Store Access attempted.");
            return null;
        }
        const key = `${TRUTH_PREFIX}${windowId}::${Normalization.normalize(keyword)}`;
        return await StorageAdapter.get<TruthVolume>(key);
    },

    async calculateTruthFromValues(keyword: string, windowId: string, values: number[]): Promise<TruthVolume> {
        if (TRUTH_STORE_DEPRECATED) throw new Error("TRUTH_STORE_DEPRECATED_ACCESS");
        return {} as any;
    },

    async saveTruth(truth: TruthVolume): Promise<void> {
        if (TRUTH_STORE_DEPRECATED) throw new Error("TRUTH_STORE_DEPRECATED_ACCESS: saveTruth");
    }
};
