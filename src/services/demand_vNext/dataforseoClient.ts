
import { CredsStore } from './credsStore';
import { DfsGlobalLimiter } from '../../utils/dfsRateLimiter';

const BASE_URL = 'https://api.dataforseo.com/v3';
const PROXY_API_KEY = 'dev-key'; // Should match proxy config (if used)
const TIMEOUT_PROXY_MS = 60000;

export interface DataForSeoRow {
    keyword: string;
    search_volume?: number;
    amazon_volume?: number; // Normalized field for amazon
    cpc: number;
    competition_index: number;
    competition: number;
    [key: string]: any;
}

export interface DataForSeoTestResult {
    ok: boolean;
    status: number;
    latency: number;
    error?: string;
    errorCode?: string;
    urlUsed: string;
    viaProxy: boolean;
    parsedRows?: DataForSeoRow[];
    parseMeta?: { matchedPath: string };
    bodySnippet?: string;
    isCorsLikely?: boolean;
    hint?: string;
}

function extractVolumeRows(data: any): { rows: DataForSeoRow[], meta: any } {
    const rows: DataForSeoRow[] = [];
    let matchedPath = "NONE";
    const task0 = data?.tasks?.[0];

    const mapItem = (item: any) => {
        const row: DataForSeoRow = {
            keyword: item.keyword,
            cpc: item.cpc,
            competition_index: item.competition_index,
            competition: item.competition
        };
        if (item.search_volume !== undefined) {
            row.search_volume = item.search_volume;
        }
        if (item.amazon_search_volume !== undefined) {
            row.amazon_volume = item.amazon_search_volume;
        }
        return row;
    };

    if (Array.isArray(task0?.result) && task0.result.length > 0 && task0.result[0].keyword) {
         matchedPath = "tasks[0].result (Direct)";
         task0.result.forEach((item: any) => rows.push(mapItem(item)));
    }
    else if (task0?.result?.[0]?.items) {
        matchedPath = "tasks[0].result[0].items";
        task0.result[0].items.forEach((item: any) => rows.push(mapItem(item)));
    }
    else if (data?.result?.[0]?.items) {
        matchedPath = "result[0].items";
        data.result[0].items.forEach((item: any) => rows.push(mapItem(item)));
    }

    return { rows, meta: { matchedPath } };
}

export const DataForSeoClient = {

    getUsageReport() {
        return "N/A"; // Stub
    },

    /**
     * Strict Proxy Resolver. 
     * Throws explicit errors if configuration violates AI Studio security/CORS constraints.
     */
    async resolveDfsProxyEndpoint(): Promise<string> {
        const config = await CredsStore.resolveDfsConfig();
        const isAiStudio = typeof window !== 'undefined' && (window.location.host.includes('aistudio') || window.location.host.includes('googleusercontent'));
        
        if (isAiStudio && config.mode !== 'PROXY') {
            throw { code: "DFS_PROXY_REQUIRED", message: "Security Violation: Direct DFS calls blocked in AI Studio. Configure Proxy URL." };
        }

        if (config.mode === 'PROXY' && !config.proxyUrl) {
            throw { code: "DFS_PROXY_URL_MISSING", message: "Proxy Mode enabled but URL is empty." };
        }

        return config.proxyUrl || '';
    },

    async fetchGoogleVolumes_DFS(params: {
        keywords: string[],
        location: number,
        language: string,
        creds: { login: string; password: string },
        useProxy?: boolean;
        signal?: AbortSignal;
        categoryId?: string;
        snapshotId?: string;
        jobId?: string;
    }): Promise<DataForSeoTestResult> {
        // 1. Resolve Config Deterministically
        const config = await CredsStore.resolveDfsConfig();
        
        // Auto-detect proxy requirement based on environment
        const proxyUrl = await this.resolveDfsProxyEndpoint().catch(e => {
            // If explicit proxy required by caller or environment, bubble up
            if (params.useProxy) throw e;
            return '';
        });

        const effectiveMode = proxyUrl ? 'PROXY' : 'DIRECT';

        // 2. Mandatory Telemetry
        console.log(`[DFS_CONFIG] mode=${effectiveMode} source=${config.source.proxyUrl} endpointHost=${config.proxyUrl} jobId=${params.jobId || 'N/A'}`);
        
        const path = 'keywords_data/google_ads/search_volume/live';
        const postData = [{
            keywords: params.keywords,
            location_code: params.location,
            language_code: params.language
        }];

        return DfsGlobalLimiter.execute(
            'google',
            params.categoryId || 'unknown',
            params.snapshotId || 'unknown',
            params.keywords.length,
            path,
            () => {
                if (effectiveMode === 'PROXY') {
                    return this._execProxy(`/v3/${path}`, postData, params.creds, proxyUrl, params.jobId);
                } else {
                    return this._execDirect(`${BASE_URL}/${path}`, postData, params.creds);
                }
            }
        );
    },

    async fetchKeywordsForKeywords(params: {
        keywords: string[],
        location: number,
        language: string,
        creds: { login: string; password: string },
        jobId?: string
    }): Promise<string[]> {
        const proxyUrl = await this.resolveDfsProxyEndpoint();
        const path = 'keywords_data/google_ads/keywords_for_keywords/live';
        
        const postData = [{
            keys: params.keywords,
            location_code: params.location,
            language_code: params.language
        }];

        const res = await this._execProxy(`/v3/${path}`, postData, params.creds, proxyUrl, params.jobId);
        if (res.ok && res.parsedRows) {
            return res.parsedRows.map(r => r.keyword);
        }
        return [];
    },

    async discoverKeywordsWithVolume(params: {
        keywords: string[],
        location: number,
        language: string,
        creds: { login: string; password: string },
        jobId?: string
    }): Promise<DataForSeoRow[]> {
        const proxyUrl = await this.resolveDfsProxyEndpoint();
        const path = 'keywords_data/google_ads/keywords_for_keywords/live';
        
        const postData = [{
            keys: params.keywords,
            location_code: params.location,
            language_code: params.language
        }];

        const res = await this._execProxy(`/v3/${path}`, postData, params.creds, proxyUrl, params.jobId);
        if (res.ok && res.parsedRows) {
            return res.parsedRows.filter(r => (r.search_volume || 0) > 0);
        }
        return [];
    },

    /**
     * Like fetchKeywordsForKeywords but returns keyword + volume pairs.
     * Used by the quality growth pipeline to skip zero-volume keywords.
     */
    async fetchKeywordsForKeywordsWithVolume(params: {
        keywords: string[],
        location: number,
        language: string,
        creds: { login: string; password: string },
        jobId?: string
    }): Promise<{keyword: string, volume: number}[]> {
        const proxyUrl = await this.resolveDfsProxyEndpoint();
        const path = 'keywords_data/google_ads/keywords_for_keywords/live';
        
        const postData = [{
            keys: params.keywords,
            location_code: params.location,
            language_code: params.language
        }];

        const res = await this._execProxy(`/v3/${path}`, postData, params.creds, proxyUrl, params.jobId);
        if (res.ok && res.parsedRows) {
            return res.parsedRows
                .filter((r: any) => (r.search_volume || r.volume || 0) > 0)
                .map((r: any) => ({ 
                    keyword: r.keyword, 
                    volume: r.search_volume || r.volume || 0 
                }));
        }
        return [];
    },

    async fetchAmazonLabsBulkSearchVolume(
        creds: { login: string; password: string },
        keywords: string[],
        locationCode: number = 2356,
        categoryId?: string,
        snapshotId?: string,
        jobId?: string
    ): Promise<DataForSeoTestResult> {
        // Enforce Proxy Check
        const proxyUrl = await this.resolveDfsProxyEndpoint();
        const effectiveMode = 'PROXY';

        console.log(`[DFS_CONFIG][AMZ] mode=${effectiveMode} endpoint=${proxyUrl}`);

        // Corrected Endpoint for Amazon Volume
        const endpoint = 'dataforseo_labs/amazon/bulk_search_volume/live';
        
        const payload = [{
            se_type: "amazon",
            location_code: locationCode,
            language_code: "en",
            keywords: keywords
        }];

        return DfsGlobalLimiter.execute(
            'amazon',
            categoryId || 'unknown',
            snapshotId || 'unknown',
            keywords.length,
            endpoint,
            () => {
                 return this._execProxy(endpoint, payload, creds, proxyUrl, jobId);
            }
        );
    },
    
    async fetchAmazonKeywordVolumesLive(creds: any, keywords: string[], marketplace: string): Promise<DataForSeoTestResult> {
        return this.fetchAmazonLabsBulkSearchVolume(creds, keywords);
    },

    async fetchVolumeStandard(creds: any, keywords: string[], location: number, lang: string): Promise<DataForSeoTestResult> {
        return this.fetchGoogleVolumes_DFS({
            keywords, location, language: lang, creds
        });
    },
    
    async fetchLiveVolume(creds: any, keywords: string[], location: number, signal?: AbortSignal): Promise<DataForSeoTestResult> {
        return this.fetchGoogleVolumes_DFS({
            keywords, location, language: 'en', creds, signal
        });
    },

    async _execDirect(url: string, payload: any, creds: { login: string; password: string }): Promise<DataForSeoTestResult> {
        const start = Date.now();
        const auth = btoa(`${creds.login}:${creds.password}`);
        
        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
            
            const latency = Date.now() - start;
            
            if (!res.ok) {
                let errorText = res.statusText;
                try {
                     const json = await res.json();
                     errorText = json.tasks?.[0]?.status_message || json.error?.message || res.statusText;
                } catch {}

                return { 
                    ok: false, status: res.status, latency, 
                    error: `HTTP ${res.status}: ${errorText}`, 
                    urlUsed: url, viaProxy: false 
                };
            }

            const data = await res.json();
            const extracted = extractVolumeRows(data);
            
            const taskStatus = data.tasks?.[0]?.status_code;
            if (taskStatus && taskStatus !== 20000) {
                 return { 
                     ok: false, status: taskStatus, latency, 
                     error: `DFS Error: ${data.tasks[0].status_message}`, 
                     urlUsed: url, viaProxy: false 
                 };
            }

            return {
                ok: true, status: 200, latency, urlUsed: url, viaProxy: false,
                parsedRows: extracted.rows, parseMeta: extracted.meta
            };

        } catch (e: any) {
             return { ok: false, status: 0, latency: 0, error: `Client Exception: ${e.message}`, urlUsed: url, viaProxy: false };
        }
    },

    async _execProxy(endpoint: string, payload: any, creds: { login: string; password: string }, resolvedProxyUrl: string | null, jobId?: string): Promise<DataForSeoTestResult> {
        const start = Date.now();
        const baseUrl = resolvedProxyUrl ? resolvedProxyUrl.replace(/\/$/, '') : '';
        const url = baseUrl ? `${baseUrl}/dfs/proxy` : 'NONE';
        
        const endpointHost = baseUrl ? new URL(baseUrl).host : 'NONE';
        const pathClean = endpoint.replace(/^\/v3\//, '').replace(/^\//, '');
        const size = Array.isArray(payload) ? (payload[0]?.keywords?.length || 0) : 0;
        
        console.log(`[DFS][REQUEST] endpointHost=${endpointHost} path=${pathClean} size=${size} jobId=${jobId || 'N/A'}`);

        try {
            if (!baseUrl) {
                 return { ok: false, status: 0, latency: 0, error: "Proxy URL missing.", urlUsed: "NONE", viaProxy: true };
            }

            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), TIMEOUT_PROXY_MS);

            let path = endpoint.replace(/^\/v3\//, '').replace(/^\//, '');
            
            const proxyPayload = { path, payload, creds, method: "POST" };

            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-API-Key': PROXY_API_KEY },
                body: JSON.stringify(proxyPayload),
                signal: controller.signal
            });
            clearTimeout(id);

            const latency = Date.now() - start;

            if (!res.ok) {
                const txt = await res.text();
                // Check for typical proxy errors
                if (res.status === 504 || res.status === 408) {
                     return { ok: false, status: 408, latency, error: "DFS_PROXY_TIMEOUT", urlUsed: url, viaProxy: true };
                }
                return { ok: false, status: res.status, latency, error: `Proxy HTTP ${res.status}: ${txt}`, urlUsed: url, viaProxy: true };
            }

            const wrapper = await res.json(); 
            // Handle different proxy wrapper formats
            const data = wrapper.data || wrapper; 
            const extracted = extractVolumeRows(data);
            
            const taskStatus = data.tasks?.[0]?.status_code;
            if (taskStatus && taskStatus !== 20000) {
                 return { ok: false, status: taskStatus, latency, error: `DFS Error (via Proxy): ${data.tasks[0].status_message}`, urlUsed: url, viaProxy: true };
            }

            return {
                ok: true, status: 200, latency, urlUsed: url, viaProxy: true,
                parsedRows: extracted.rows, parseMeta: extracted.meta
            };

        } catch (e: any) {
            return { ok: false, status: 0, latency: 0, error: `Proxy Error: ${e.message}`, urlUsed: url, viaProxy: true };
        }
    }
};
