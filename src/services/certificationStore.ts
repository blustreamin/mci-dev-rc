import { StorageAdapter } from './storageAdapter';
import { CertifiedBenchmarkV3 } from '../types';

const STORE_NAME = 'cbv3_store';

export const CertificationStore = {
    getKey(id: string): string {
        return id;
    },

    async saveBenchmark(benchmark: CertifiedBenchmarkV3): Promise<void> {
        await StorageAdapter.set(
            this.getKey(benchmark.id),
            benchmark,
            STORE_NAME
        );
        
        // Mandatory Verification Log (Read-After-Write)
        const all = await this.getAllBenchmarks();
        const saved = all.find(b => b.id === benchmark.id);
        
        if (saved) {
            console.log(`[CBV3] SUCCESS: Saved benchmark id=${benchmark.id} certifiedAt=${benchmark.certifiedAtISO} store=${STORE_NAME}`);
            console.log(`[CBV3] Store now contains ${all.length} benchmarks. Latest certifiedAt=${all[0]?.certifiedAtISO}`);
        } else {
            console.error(`[CBV3] CRITICAL FAILURE: Benchmark saved but not found in retrieval.`);
        }
    },

    async getBenchmark(id: string): Promise<CertifiedBenchmarkV3 | null> {
        return await StorageAdapter.get<CertifiedBenchmarkV3>(
            this.getKey(id),
            STORE_NAME
        );
    },

    async getAllBenchmarks(): Promise<CertifiedBenchmarkV3[]> {
        // getAllKeys returns full prefixed keys (e.g. mci_v1_cbv3_store_cat::win)
        const keys = await StorageAdapter.getAllKeys(STORE_NAME);
        const benchmarks: CertifiedBenchmarkV3[] = [];
        
        // console.log(`[CertificationStore] Found ${keys.length} raw keys in ${STORE_NAME}`);

        for (const key of keys) {
            // FIX: Use getRaw because 'key' already includes the full prefix from getAllKeys.
            // Using .get() here would double-prefix it (mci_v1_cbv3_store_mci_v1_cbv3_store...)
            const b = await StorageAdapter.getRaw<CertifiedBenchmarkV3>(key);
            if (b) benchmarks.push(b);
        }
        
        // Sort descending by date (newest first)
        return benchmarks.sort((a, b) => 
            new Date(b.certifiedAtISO).getTime() - new Date(a.certifiedAtISO).getTime()
        );
    },

    async clear(): Promise<void> {
        await StorageAdapter.clear(STORE_NAME);
    },
    
    STORE_NAME
};