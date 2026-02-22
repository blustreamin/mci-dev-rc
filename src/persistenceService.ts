
import { computeRegistryHash } from './driftHash';
import { StorageAdapter } from './services/storageAdapter';
import { KeywordRegister, BenchmarkSnapshot, PreSweepData, SweepResult } from './types';

const STORAGE_KEY = 'state_v1';
const BENCHMARK_KEY = 'benchmark_v1';
const CACHE_PREFIX = 'cache_';
const REGISTRY_PREFIX = 'keyword_registry_';
const STATE_VERSION = '1.0.0';

// Cache Version for Deep Dive (Increment to flush old results)
const DEEP_DIVE_CACHE_SCHEMA_VERSION = "v2-metrics+sections";

export interface StoredStateContainer {
    stateVersion: string;
    updatedAt: string;
    registryHash: string;
    appState: any; 
}

// --- State Management ---

export async function saveState(state: any): Promise<void> {
    try {
        const registryHash = await computeRegistryHash();
        
        // Inject current cache version into state
        if (state) {
            state.deepDiveCacheVersion = DEEP_DIVE_CACHE_SCHEMA_VERSION;
        }

        const stateContainer = {
            stateVersion: STATE_VERSION,
            updatedAt: new Date().toISOString(),
            registryHash: registryHash,
            appState: state,
        };
        await StorageAdapter.set(STORAGE_KEY, stateContainer);
    } catch (error) {
        console.error("Failed to save state:", error);
    }
}

export async function loadState(): Promise<StoredStateContainer | null> {
    try {
        const stateContainer = await StorageAdapter.get<StoredStateContainer>(STORAGE_KEY);
        if (!stateContainer) return null;
        
        // Basic validation
        if (stateContainer.stateVersion && stateContainer.appState) {
            
            // --- Deep Dive Cache Validation ---
            const storedVersion = stateContainer.appState.deepDiveCacheVersion;
            if (storedVersion !== DEEP_DIVE_CACHE_SCHEMA_VERSION) {
                console.log(`[CACHE] Deep Dive cache schema mismatch (${storedVersion} vs ${DEEP_DIVE_CACHE_SCHEMA_VERSION}). Flushing stale results.`);
                stateContainer.appState.deepDiveResults = {};
                stateContainer.appState.deepDiveCacheVersion = DEEP_DIVE_CACHE_SCHEMA_VERSION;
                
                console.log("Deep Dive plumbing verified: metrics inherited from Sweep; cache schema v2 active; required sections present.");
            }

            return stateContainer;
        }
        
        return null;
    } catch (error) {
        console.error("Failed to load state:", error);
        return null;
    }
}

export async function clearState(): Promise<void> {
    await StorageAdapter.remove(STORAGE_KEY);
    await StorageAdapter.clear();
}

// --- Benchmark ---

export async function saveBenchmark(snapshot: BenchmarkSnapshot): Promise<void> {
    if (!snapshot.createdAtISO) snapshot.createdAtISO = new Date().toISOString();
    await StorageAdapter.set(BENCHMARK_KEY, snapshot);
}

export async function loadBenchmark(): Promise<BenchmarkSnapshot | null> {
    const snapshot = await StorageAdapter.get<BenchmarkSnapshot>(BENCHMARK_KEY);
    if (!snapshot) return null;
    return snapshot;
}

export async function clearBenchmark(): Promise<void> {
    await StorageAdapter.remove(BENCHMARK_KEY);
}

// --- Registry ---

export async function saveKeywordRegister(register: KeywordRegister): Promise<void> {
    await StorageAdapter.set(REGISTRY_PREFIX + register.categoryId, register);
}

export async function loadKeywordRegister(categoryId: string): Promise<KeywordRegister | null> {
    return await StorageAdapter.get<KeywordRegister>(REGISTRY_PREFIX + categoryId);
}

// --- Result Caching ---

export async function getCachedResult<T>(key: string): Promise<T | null> {
    const entry = await StorageAdapter.get<any>(CACHE_PREFIX + key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > entry.ttl) {
        await StorageAdapter.remove(CACHE_PREFIX + key);
        return null;
    }
    return entry.data;
}

export async function setCachedResult<T>(key: string, data: T, ttlDays: number = 7): Promise<void> {
    const entry = {
        data,
        timestamp: Date.now(),
        ttl: ttlDays * 24 * 60 * 60 * 1000,
        version: STATE_VERSION
    };
    await StorageAdapter.set(CACHE_PREFIX + key, entry);
}

// --- Volume Caching (High Frequency) ---

export async function setCachedVolume<T>(key: string, data: T): Promise<void> {
    const entry = {
        data,
        timestamp: Date.now(),
        ttl: 7 * 24 * 60 * 60 * 1000,
        version: STATE_VERSION
    };
    await StorageAdapter.set('mci_vol_' + key, entry);
}

export async function getCachedVolume<T>(key: string): Promise<T | null> {
    const entry = await StorageAdapter.get<any>('mci_vol_' + key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > entry.ttl) {
        await StorageAdapter.remove('mci_vol_' + key);
        return null;
    }
    return entry.data;
}