
import { DataForSeoClient } from './dataforseoClient';
import { CredsStore } from './credsStore';

export interface DfsTriageReport {
    ts: string;
    verdict: "GO" | "NO_GO";
    mode: "DIRECT" | "PROXY";
    endpoint: string;
    requestUrl: string;
    checks: {
        apiHostPing: { ok: boolean; latencyMs: number; error: string };
        proxyPing: { ok: boolean; latencyMs: number; error: string };
        dfsCall: { ok: boolean; status: number | null; latencyMs: number; error: string; rows: number };
    };
    blockers: string[];
}

export const DfsConnectivityTriage = {
    async run(): Promise<DfsTriageReport> {
        const ts = new Date().toISOString();
        const creds = await CredsStore.get();
        const blockers: string[] = [];

        // Determine Mode & URLs (Async)
        const proxyConfig = await CredsStore.getProxyConfig();
        const proxyBase = proxyConfig ? proxyConfig.url.replace(/\/$/, '') : '';
        const mode = proxyBase ? 'PROXY' : 'DIRECT';
        
        // Report Skeleton
        const report: DfsTriageReport = {
            ts,
            verdict: 'NO_GO',
            mode,
            endpoint: mode === 'PROXY' ? '/dfs/proxy' : '/v3/...',
            requestUrl: mode === 'PROXY' ? `${proxyBase}/dfs/proxy` : 'https://api.dataforseo.com/v3/...',
            checks: {
                apiHostPing: { ok: false, latencyMs: 0, error: '' },
                proxyPing: { ok: false, latencyMs: 0, error: '' },
                dfsCall: { ok: false, status: null, latencyMs: 0, error: '', rows: 0 }
            },
            blockers
        };

        if (!creds || !creds.login || !creds.password) {
            report.blockers.push('CREDS_MISSING');
            return report;
        }

        // --- CHECK A: API HOST PING (DIRECT) ---
        const t1 = Date.now();
        try {
            // Using no-cors mode to attempt a ping without getting blocked by CORS policy on the response read
            // This validates DNS and basic reachability
            await fetch('https://api.dataforseo.com/v3/ping', { mode: 'no-cors' });
            report.checks.apiHostPing.ok = true; // If it doesn't throw, host is reachable
        } catch (e: any) {
            report.checks.apiHostPing.error = e.message;
        }
        report.checks.apiHostPing.latencyMs = Date.now() - t1;

        // --- CHECK B: PROXY PING ---
        if (proxyBase) {
            const t2 = Date.now();
            try {
                // Try health endpoint
                const res = await fetch(`${proxyBase}/healthz`);
                if (res.ok) {
                    report.checks.proxyPing.ok = true;
                } else {
                    report.checks.proxyPing.error = `HTTP ${res.status}`;
                    report.blockers.push('PROXY_DOWN');
                }
            } catch (e: any) {
                report.checks.proxyPing.error = e.message;
                report.blockers.push('PROXY_UNREACHABLE');
            }
            report.checks.proxyPing.latencyMs = Date.now() - t2;
        } else {
            report.checks.proxyPing.error = "No Proxy Configured";
        }

        // --- CHECK C: REAL DFS CALL ---
        // We use fetchGoogleVolumes_DFS which handles fallback logic, but here we want to test the result
        const t3 = Date.now();
        try {
            const res = await DataForSeoClient.fetchGoogleVolumes_DFS({
                keywords: ["test connectivity", "triage check", "razor"],
                location: 2356,
                language: 'en',
                creds: creds as any,
                // If we have a proxy, prefer it for this test to validate the pipeline
                useProxy: !!proxyBase
            });

            report.checks.dfsCall.latencyMs = res.latency || (Date.now() - t3);
            report.checks.dfsCall.status = res.status;
            
            if (res.ok) {
                report.checks.dfsCall.ok = true;
                report.checks.dfsCall.rows = res.parsedRows?.length || 0;
            } else {
                report.checks.dfsCall.error = res.error || "Unknown Error";
                
                // Classify
                if (res.status === 401 || res.status === 403) report.blockers.push('AUTH_FAIL');
                else if (res.status === 402) report.blockers.push('LOW_BALANCE');
                else if (res.isCorsLikely) report.blockers.push('CORS_BLOCK');
                else report.blockers.push('UPSTREAM_FAIL');
            }
            
            // Refine report mode based on actual usage
            report.mode = res.viaProxy ? 'PROXY' : 'DIRECT';
            report.endpoint = res.urlUsed || report.endpoint;
            report.requestUrl = res.urlUsed || report.requestUrl;

        } catch (e: any) {
             report.checks.dfsCall.error = e.message;
             report.blockers.push('CLIENT_EXCEPTION');
        }

        // Final Verdict
        if (report.blockers.length === 0 && report.checks.dfsCall.ok) {
            report.verdict = 'GO';
        }

        return report;
    }
};
