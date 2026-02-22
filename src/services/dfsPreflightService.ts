
import { DataForSeoClient } from './demand_vNext/dataforseoClient';
import { CredsStore } from './demand_vNext/credsStore';

export interface PreflightResult {
    ok: boolean;
    ts: number;
    google: { ok: boolean; error?: string };
    amazon: { ok: boolean; error?: string };
}

let cachedResult: PreflightResult | null = null;
const CACHE_TTL = 60000;

export const DfsPreflightService = {
    async checkEndpoints(): Promise<PreflightResult> {
        if (cachedResult && (Date.now() - cachedResult.ts) < CACHE_TTL) {
            console.log("[DFS_PREFLIGHT] Returning cached result (valid for 60s)");
            return cachedResult;
        }

        console.log("[DFS_PREFLIGHT] Running fresh endpoint checks...");
        const creds = await CredsStore.get();
        if (!creds) throw new Error("No DFS Credentials found in Runtime Flags.");

        // Call BOTH endpoints through production proxy paths
        const [googleRes, amazonRes] = await Promise.all([
            // 1. Google: 1 keyword
            DataForSeoClient.fetchGoogleVolumes_DFS({
                keywords: ["preflight-google"], 
                location: 2356, 
                language: "en", 
                creds: creds as any, 
                useProxy: true
            }).catch(e => ({ ok: false, error: e.message })),
            
            // 2. Amazon Labs: 2 keywords
            DataForSeoClient.fetchAmazonLabsBulkSearchVolume(
                creds as any, 
                ["preflight-amazon-1", "preflight-amazon-2"]
            ).catch(e => ({ ok: false, error: e.message }))
        ]);

        const result: PreflightResult = {
            ok: (googleRes.ok && amazonRes.ok),
            ts: Date.now(),
            google: { ok: googleRes.ok, error: googleRes.ok ? undefined : (googleRes as any).error },
            amazon: { ok: amazonRes.ok, error: amazonRes.ok ? undefined : (amazonRes as any).error }
        };

        cachedResult = result;
        return result;
    },

    getCachedResult() {
        return cachedResult;
    },

    isStale() {
        return !cachedResult || (Date.now() - cachedResult.ts) >= CACHE_TTL;
    },

    clearCache() {
        cachedResult = null;
    }
};
