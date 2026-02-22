
import React, { useState, useEffect, useRef } from 'react';
import { 
    BarChart3, RefreshCw, Play, UploadCloud, FileJson, 
    AlertTriangle, Loader2, ChevronDown, ChevronUp, CheckCircle2,
    Database, X, ShieldCheck, Copy, Upload, Check, Download
} from 'lucide-react';
import { MetricsBacktestAudit, BacktestReport, CategoryResult, Bench25Report, Bench25Item } from '../services/metricsBacktestAudit';
import { SimpleErrorBoundary } from './SimpleErrorBoundary';
import { JobRunner } from '../services/jobRunner';
import { CORE_CATEGORIES } from '../constants';
import { DateUtils } from '../utils/dateUtils';

// --- ROBUST UI NORMALIZERS (P0 Fix) ---

function computeMedian(input: any): number | null {
    if (typeof input === 'number') return input;
    if (Array.isArray(input)) {
        const nums = input.filter(n => typeof n === 'number' && Number.isFinite(n)).sort((a, b) => a - b);
        if (nums.length === 0) return null;
        const mid = Math.floor(nums.length / 2);
        return nums.length % 2 !== 0 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
    }
    return null;
}

function extractMetric(container: any, ...keys: string[]): number | null {
    if (!container) return null;
    for (const k of keys) {
        const val = container[k];
        if (val === undefined || val === null) continue;
        
        // 1. Direct number
        if (typeof val === 'number') return val;
        
        // 2. Object with median/value
        if (typeof val === 'object') {
            if (typeof val.median === 'number') return val.median;
            if (typeof val.value === 'number') return val.value;
            // 3. Array of runs
            if (Array.isArray(val)) return computeMedian(val);
        }
    }
    return null;
}

// Dedicated Demand Helper (P0 Fix for Missing Data)
function getDemandMn(row: any): number | null {
    if (!row) return null;
    const m = row.metrics || {};
    
    // Check Root Level (Priority) - Flattened Bench25 case
    if (typeof row.demandMn === 'number' && Number.isFinite(row.demandMn)) return row.demandMn;
    
    // Legacy / Nested
    if (typeof row.demand_index_mn === 'number' && Number.isFinite(row.demand_index_mn)) return row.demand_index_mn;
    
    // Helper to check object stats
    const checkObj = (o: any) => {
        if (!o || typeof o !== 'object') return null;
        if (typeof o.median === 'number' && Number.isFinite(o.median)) return o.median;
        if (typeof o.mn === 'number' && Number.isFinite(o.mn)) return o.mn;
        if (typeof o.value === 'number' && Number.isFinite(o.value)) return o.value;
        return null;
    };

    // Check Metrics Level (Numeric direct or Object)
    // 1. Check numeric direct
    if (typeof m.demand_index_mn === 'number') return m.demand_index_mn;
    if (typeof m.demandMn === 'number') return m.demandMn;
    if (typeof m.demand_mn === 'number') return m.demand_mn;
    if (typeof m.demand === 'number') return m.demand;

    // 2. Check object stats
    let val = checkObj(m.demand_index_mn) ?? checkObj(m.demandMn) ?? checkObj(m.demand) ?? checkObj(m.demand_mn);
    if (val !== null) return val;

    // 3. Check Arrays (Runs)
    const runsArr = m.runs?.demand || m.demandRuns;
    if (Array.isArray(runsArr)) return computeMedian(runsArr);

    return null;
}

function normalizeBenchSummary(rawReport: any) {
     const s = rawReport?.summary ?? {};
     const root = rawReport || {};
     
     const maxOverall = 
        root.maxDriftOverallPct ?? // Bench25 format
        s.maxDeviationPctOverall ?? 
        s.maxDrift ?? 
        s.max_drift ?? 
        s.maxDeviationPct?.max ?? 
        null;
    
     // Robust Runs/Cat extraction
     const runs = 
        root.runsPerCat ?? 
        root.runsPerCategory ?? 
        root.runCount ?? 
        root.config?.runsPerCat ??
        s.runsPerCat ?? 
        s.runs ?? 
        0;

     return {
       auditId: root.auditId || s.auditId || 'N/A',
       ts: root.ts || s.ts || new Date().toISOString(),
       maxDeviationPctOverall: (typeof maxOverall === 'number') ? maxOverall : null,
       categories: s.categories ?? s.totalCategories ?? s.cats ?? (root.categoriesTotal ?? root.results?.length ?? 0),
       runsPerCat: runs,
       goCount: root.verdictCounts?.GO ?? s.goCount ?? 0,
       warnCount: root.verdictCounts?.WARN ?? s.warnCount ?? 0,
       missingCount: root.verdictCounts?.MISSING ?? s.missingCount ?? 0
     };
}

interface RenderRow {
    categoryId: string;
    snapshotId: string;
    lifecycle: string;
    verdict: string;
    drift: number;
    demandMn: number | null;
    readiness: number | null;
    spread: number | null;
}

function normalizeCategoryResult(raw: any): RenderRow {
     const r = raw || {};
     const m = r.metrics || {};
     
     // Use dedicated demand helper
     const demand = getDemandMn(r);
     
     const readiness = r.readiness ?? extractMetric(m, 'readinessScore', 'readiness', 'r');
     const spread = r.spread ?? extractMetric(m, 'spreadScore', 'spread', 's');
     
     // Drift might be on root or inside driftPct object
     let drift = 0;
     if (typeof r.drift === 'number') drift = r.drift; // Bench25 format
     else if (typeof r.maxDeviationPct === 'number') drift = r.maxDeviationPct;
     else if (typeof r.driftPct === 'number') drift = r.driftPct;
     else if (r.driftPct && typeof r.driftPct.max === 'number') drift = r.driftPct.max;

     return {
         categoryId: r.categoryId || 'Unknown',
         snapshotId: r.snapshotId || 'N/A',
         lifecycle: r.lifecycle || 'UNKNOWN',
         verdict: r.verdict || 'UNKNOWN',
         drift: drift,
         demandMn: demand,
         readiness: readiness,
         spread: spread
     };
}
// -----------------------

interface DemandBenchmarksPanelProps {
    onClose?: () => void;
}

export const DemandBenchmarksPanel: React.FC<DemandBenchmarksPanelProps> = ({ onClose }) => {
    const [loading, setLoading] = useState(false);
    const [running, setRunning] = useState(false);
    const [publishing, setPublishing] = useState(false);
    const [report, setReport] = useState<BacktestReport | Bench25Report | null>(null);
    const [error, setError] = useState<string | null>(null);
    const hasLoggedShape = useRef(false);
    
    // Upload Panel State
    const [showUpload, setShowUpload] = useState(false);
    const [jsonInput, setJsonInput] = useState('');
    const [validationMsg, setValidationMsg] = useState<{ok: boolean, msg: string} | null>(null);
    const [copySuccess, setCopySuccess] = useState(false);

    // One-time shape logging
    useEffect(() => {
        if (report && report.results && report.results.length > 0 && !hasLoggedShape.current) {
            const rows = report.results;
            console.log("[BENCH_UI][DEMAND_KEYS_SAMPLE]", {
                 sampleRowKeys: Object.keys(rows?.[0]||{}),
                 sampleMetricsKeys: Object.keys((rows?.[0] as any)?.metrics||{}),
                 demandCandidates: {
                   root: (rows?.[0] as any)?.demand_index_mn ?? (rows?.[0] as any)?.demandMn,
                   metrics: (rows?.[0] as any)?.metrics?.demand_index_mn ?? (rows?.[0] as any)?.metrics?.demandMn ?? (rows?.[0] as any)?.metrics?.demand,
                   runsLen: (rows?.[0] as any)?.metrics?.runs?.demand?.length ?? (rows?.[0] as any)?.metrics?.demandRuns?.length
                 }
            });
            hasLoggedShape.current = true;
        }
    }, [report]);

    const loadLatest = async () => {
        console.log('[BENCH_UI][CLICK_LOAD_LATEST]');
        if (loading || running || publishing) return;
        
        setLoading(true);
        setError(null);
        let job = null;

        try {
            job = await JobRunner.createJob('LOAD_LATEST_BACKTEST', 'GLOBAL', 'current');
            console.log(`[BENCH_UI][JOB_CREATED] type=LOAD_LATEST_BACKTEST jobId=${job.jobId}`);
            await JobRunner.updateJob(job, { status: 'RUNNING', message: 'Loading latest benchmark...' });

            const latestRes = await MetricsBacktestAudit.getLatestBacktestReport();
            
            if (latestRes) {
                console.log('[BENCH_UI][SUMMARY_SHAPE]', { hasSummary: !!latestRes?.summary, keys: Object.keys(latestRes||{}), summaryKeys: Object.keys(latestRes?.summary||{}) });
                setReport(latestRes);
                console.log(`[BENCHMARK][LOAD_OK] auditId=${latestRes.auditId}`);
                await JobRunner.updateJob(job, { status: 'COMPLETED', progress: 100, message: `Loaded ${latestRes.auditId}` });
                console.log(`[BENCH_UI][JOB_DONE] jobId=${job.jobId} ok=true`);
            } else {
                setError("No published benchmark report found.");
                await JobRunner.updateJob(job, { status: 'COMPLETED', message: 'No report found' });
            }
        } catch (e: any) {
            console.error(e);
            const msg = `Failed to load benchmark: ${e.message}`;
            setError(msg);
            if (job) {
                await JobRunner.updateJob(job, { status: 'FAILED', error: msg });
                console.log(`[BENCH_UI][JOB_FAIL] jobId=${job.jobId} err=${msg}`);
            }
        } finally {
            setLoading(false);
        }
    };

    const handleRun25xAudit = async () => {
        // ENTRY LOG: Prove handler execution
        const context = { isBusy, running, loading, publishing, hasReport: !!report, reportRows: report?.results?.length };
        const monthKey = DateUtils.getCurrentMonthKey();
        console.log('[BENCH25][CLICK]', { month: monthKey, categories: CORE_CATEGORIES.length, ...context });

        if (isBusy) {
             console.warn('[BENCH_UI][CLICK_RUN25][EARLY_RETURN]', { reason: 'BUSY_STATE', ...context });
             return;
        }

        // Verify Job Runner health first (P0 fix)
        const selfCheck = await JobRunner.__selfTestCreateJob();
        if (!selfCheck.ok) {
             console.error(`[BENCH25][BLOCKED_BY_JOBRUNNER] error=${selfCheck.error}`);
             setError(`System Error: Job Runner unhealthy (${selfCheck.error})`);
             return;
        }

        if (!window.confirm("Run 25x Deterministic Audit? This runs purely in memory to verify stability.")) {
             console.warn("[BENCH_UI][CLICK_RUN25][EARLY_RETURN]", { reason: 'USER_CANCELLED' });
             return;
        }
        
        setRunning(true);
        setError(null);
        let job: any = null;

        try {
            console.log('[BENCH25][RUN_START]', { runsPerCat: 25 });
            
            // Unconditional Job Creation
            job = await JobRunner.createJob('BENCH25_AUDIT', 'GLOBAL', 'current');
            console.log(`[BENCH25][JOB_CREATED] jobId=${job.jobId}`);
            
            await JobRunner.updateJob(job, { status: 'RUNNING', message: 'Running 25x Audit across all categories...', progress: 1 });
            
            // Execute Logic - Actual computation call with callback
            const res = await MetricsBacktestAudit.runBench25({
                month: monthKey,
                categoryIds: CORE_CATEGORIES.map(c => c.id),
                runsPerCat: 25,
                onProgress: (msg, pct) => {
                     if (job) JobRunner.updateJob(job, { message: msg, progress: pct }).catch(e => console.warn(e));
                }
            });
            
            if (res) {
                // Mandatory Telemetry
                const results = res.results;
                console.log(`[BENCH25][RUN_DONE] auditId=${res.auditId} maxDriftOverallPct=${res.maxDriftOverallPct} rows=${results?.length}`);
                
                // Detailed telemetry on first row to debug shape
                if (results && results.length > 0) {
                     const r0 = results[0];
                     console.log("[BENCH_UI][ROW_METRICS_KEYS]", {
                          categoryId: r0.categoryId,
                          keys: Object.keys(r0)
                     });
                     console.log("[BENCH_UI][NORMALIZED_SAMPLE]", normalizeCategoryResult(r0));
                }
                
                setReport(res);
                await JobRunner.updateJob(job, { status: 'COMPLETED', progress: 100, message: 'Audit Complete' });
            } else {
                const msg = "Audit failed: No result returned";
                console.error(`[BENCH25][FAIL] ${msg}`);
                setError(msg);
                await JobRunner.updateJob(job, { status: 'FAILED', error: msg });
            }
        } catch (e: any) {
            const msg = e.message || "Unknown error";
            console.error(`[BENCH25][EXCEPTION]`, e);
            setError(`Exception: ${msg}`);
            
            if (job) {
                await JobRunner.updateJob(job, { status: 'FAILED', error: msg });
            }
        } finally {
            console.log('[BENCH25][EXIT]');
            setRunning(false);
        }
    };

    // canPublish only works with BacktestReport shape (has 'metrics' obj) OR if we normalize
    // Currently publish logic in service expects BacktestReport shape. Bench25 output is for Audit Only.
    // So disable Publish if report is Bench25Report (detected by kind)
    const isBench25 = report && 'kind' in report && report.kind === 'bench25_audit';
    const canPublish = !isBench25 && report && report.results.every((r: any) => r.verdict === 'GO' || r.verdict === 'WARN');

    const handlePublishBaseline = async () => {
        console.log(`[BENCH_UI][CLICK_PUBLISH_BASELINE] enabled=${canPublish}`);
        if (publishing) return;
        
        if (!report) {
            alert("No report to publish.");
            return;
        }

        if (!window.confirm("Publish these results as the OFFICIAL BASELINE for all categories?")) return;
        
        setPublishing(true);
        let job = null;

        try {
            job = await JobRunner.createJob('BENCH25_PUBLISH_BASELINE', 'GLOBAL', 'current');
            console.log(`[BENCH_UI][JOB_CREATED] type=BENCH25_PUBLISH_BASELINE jobId=${job.jobId}`);
            
            await JobRunner.updateJob(job, { status: 'RUNNING', message: 'Publishing baseline...' });

            const res = await MetricsBacktestAudit.run25xBenchmark('PUBLISH_BASELINE');
            
            if (res.ok) {
                alert("Baseline Published Successfully.");
                await JobRunner.updateJob(job, { status: 'COMPLETED', progress: 100, message: 'Published' });
                console.log(`[BENCH_UI][JOB_DONE] jobId=${job.jobId} ok=true`);
            } else {
                const msg = `Publish Failed: ${res.error}`;
                alert(msg);
                await JobRunner.updateJob(job, { status: 'FAILED', error: msg });
                console.log(`[BENCH_UI][JOB_FAIL] jobId=${job.jobId} err=${msg}`);
            }
        } catch (e: any) {
            alert(`Error: ${e.message}`);
            if (job) {
                await JobRunner.updateJob(job, { status: 'FAILED', error: e.message });
                console.log(`[BENCH_UI][JOB_FAIL] jobId=${job.jobId} err=${e.message}`);
            }
        } finally {
            setPublishing(false);
        }
    };

    const toggleUpload = () => {
        const nextState = !showUpload;
        setShowUpload(nextState);
    };

    const validateJson = () => {
        setValidationMsg(null);
        try {
            if (!jsonInput.trim()) throw new Error("Input is empty");
            const data = JSON.parse(jsonInput);
            if (!data.results || !Array.isArray(data.results)) throw new Error("Missing 'results' array");
            // Basic shape check
            if (!data.auditId) throw new Error("Missing auditId");
            setValidationMsg({ ok: true, msg: `Valid Report: ${data.results.length} categories.` });
        } catch (e: any) {
            setValidationMsg({ ok: false, msg: `Validation Error: ${e.message}` });
        }
    };

    const handleUploadJson = async () => {
        if (!validationMsg?.ok) return;
        try {
            const data = JSON.parse(jsonInput);
            console.log('[BENCH_JSON][UPLOAD_START]');
            const res = await MetricsBacktestAudit.publishExternalReport(data);
            if (res.ok) {
                console.log(`[BENCH_JSON][UPLOAD_WRITE_OK] auditId=${res.auditId}`);
                alert("Report Uploaded Successfully.");
                setShowUpload(false);
                setJsonInput('');
                setValidationMsg(null);
                loadLatest();
            } else {
                console.error(`[BENCH_JSON][UPLOAD_WRITE_FAIL] ${res.error}`);
                alert(`Upload Failed: ${res.error}`);
            }
        } catch (e: any) {
            alert(`Error: ${e.message}`);
        }
    };

    const copyToClipboard = () => {
        if (!report) return;
        try {
            // Need robust extraction for clipboard too
            const summary = normalizeBenchSummary(report);
            const contract = {
                kind: "bench25_audit",
                auditId: summary.auditId,
                ts: summary.ts,
                runsPerCat: summary.runsPerCat,
                categoriesTotal: report.results.length,
                maxDriftOverallPct: summary.maxDeviationPctOverall,
                verdictCounts: {
                    GO: summary.goCount,
                    WARN: summary.warnCount,
                    FAIL: 0, 
                    MISSING: summary.missingCount
                },
                results: report.results.map(r => normalizeCategoryResult(r))
            };
            
            navigator.clipboard.writeText(JSON.stringify(contract, null, 2));
            setCopySuccess(true);
            setTimeout(() => setCopySuccess(false), 2000);
        } catch (e) {
            console.error("Copy failed", e);
        }
    };

    const downloadJson = () => {
        if (!report) {
            console.log('[BENCH25][JSON_DISABLED] reason=NO_REPORT');
            return;
        }
        
        try {
            // Re-use logic from copyToClipboard for consistency
            const summary = normalizeBenchSummary(report);
            const contract = {
                kind: "bench25_audit",
                auditId: summary.auditId,
                ts: summary.ts,
                runsPerCat: summary.runsPerCat,
                categoriesTotal: report.results.length,
                maxDriftOverallPct: summary.maxDeviationPctOverall,
                verdictCounts: {
                    GO: summary.goCount,
                    WARN: summary.warnCount,
                    FAIL: 0, 
                    MISSING: summary.missingCount
                },
                results: report.results.map(r => normalizeCategoryResult(r))
            };

            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(contract, null, 2));
            const downloadAnchorNode = document.createElement('a');
            downloadAnchorNode.setAttribute("href", dataStr);
            downloadAnchorNode.setAttribute("download", `bench25_audit_${Date.now()}.json`);
            document.body.appendChild(downloadAnchorNode);
            downloadAnchorNode.click();
            downloadAnchorNode.remove();
        } catch (e) {
            console.error("Download failed", e);
        }
    };

    useEffect(() => {
        loadLatest();
    }, []);

    const renderSummary = (report: BacktestReport | Bench25Report) => {
        // Safe access via normalizer
        const safeSummary = normalizeBenchSummary(report);
        const maxDev = safeSummary.maxDeviationPctOverall;
        const hasDev = maxDev !== null;

        return (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                <div className="space-y-1">
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Audit ID</div>
                    <div className="text-xs font-mono font-bold text-slate-700 truncate" title={safeSummary.auditId}>{safeSummary.auditId}</div>
                </div>
                <div className="space-y-1">
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Timestamp</div>
                    <div className="text-xs font-bold text-slate-700">{new Date(safeSummary.ts).toLocaleString()}</div>
                </div>
                <div className="space-y-1">
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Categories</div>
                    <div className="text-xs font-bold text-slate-700">{report.results?.length ?? 0} / 16</div>
                </div>
                <div className="space-y-1">
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Runs/Cat</div>
                    <div className="text-xs font-bold text-slate-700">{safeSummary.runsPerCat > 0 ? `${safeSummary.runsPerCat}x` : '—'}</div>
                </div>
                <div className="space-y-1">
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Max Drift</div>
                    <div className={`text-xs font-bold ${hasDev && maxDev < 1.0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {hasDev ? `${maxDev.toFixed(4)}%` : '—'}
                    </div>
                </div>
            </div>
        );
    };

    const isBusy = loading || running || publishing;

    if (report?.results) {
         console.log('[BENCH_UI][ROWS_SHAPE]', {
             count: report.results.length,
             undefinedCount: report.results.filter((x: any) => !x).length,
             // Fix: check actual renderable value
             missingMedian: report.results.filter((x: any) => getDemandMn(x) === null).length,
             sampleKeys: Object.keys(report.results.find(Boolean) || {})
         });
    }

    return (
        <SimpleErrorBoundary>
            <div className="space-y-6 animate-in fade-in duration-500">
                
                {/* Actions Row */}
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
                            <BarChart3 className="w-5 h-5 text-indigo-600"/> Demand Benchmarks
                        </h3>
                        <p className="text-xs text-slate-500 mt-1">Deterministic backtesting to verify logic consistency and data stability.</p>
                    </div>
                    
                    <div className="flex gap-2">
                        <button 
                            onClick={loadLatest}
                            disabled={isBusy}
                            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 text-slate-700 text-xs font-bold rounded-xl hover:bg-slate-50 transition-all disabled:opacity-50"
                        >
                            {loading ? <Loader2 className="w-4 h-4 animate-spin"/> : <RefreshCw className="w-4 h-4"/>}
                            Load Latest
                        </button>
                        <button 
                            onClick={handleRun25xAudit}
                            type="button"
                            disabled={isBusy}
                            className={`flex items-center gap-2 px-4 py-2 text-white text-xs font-bold rounded-xl shadow-lg transition-all disabled:opacity-50 ${running ? 'bg-indigo-400' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                        >
                            {running ? <Loader2 className="w-4 h-4 animate-spin"/> : <Play className="w-4 h-4 fill-current"/>}
                            {running ? 'Running 25x...' : 'Run 25x Audit'}
                        </button>
                        
                        <div className="h-6 w-px bg-slate-200 mx-1 self-center" />
                        
                        <button 
                             onClick={toggleUpload}
                             disabled={isBusy}
                             className={`p-2 rounded-xl border transition-all ${showUpload ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                             title="Upload / Update JSON"
                        >
                            <Upload className="w-4 h-4" />
                        </button>

                        {report && (
                            <>
                                <button 
                                    onClick={copyToClipboard}
                                    className={`flex items-center gap-2 px-3 py-2 border rounded-xl text-xs font-bold transition-all ${copySuccess ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                                    title="Copy Audit JSON"
                                >
                                    {copySuccess ? <Check className="w-3.5 h-3.5"/> : <Copy className="w-3.5 h-3.5"/>}
                                    {copySuccess ? 'Copied' : 'JSON'}
                                </button>
                                
                                <button
                                    onClick={downloadJson}
                                    className="flex items-center gap-2 px-3 py-2 border rounded-xl text-xs font-bold transition-all bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                                    title="Download Audit JSON"
                                >
                                    <Download className="w-3.5 h-3.5"/>
                                    Download
                                </button>
                            </>
                        )}
                        
                        {report && (
                            <button 
                                onClick={handlePublishBaseline}
                                disabled={!canPublish || isBusy}
                                className={`flex items-center gap-2 px-4 py-2 text-white text-xs font-bold rounded-xl shadow-lg transition-all disabled:opacity-50 ${canPublish ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-slate-400 cursor-not-allowed'}`}
                            >
                                {publishing ? <Loader2 className="w-4 h-4 animate-spin"/> : <ShieldCheck className="w-4 h-4"/>}
                                Publish Baseline
                            </button>
                        )}
                    </div>
                </div>

                {/* Upload Panel */}
                {showUpload && (
                    <div className="p-5 bg-slate-50 border border-slate-200 rounded-2xl animate-in fade-in slide-in-from-top-2">
                        <div className="flex justify-between items-center mb-3">
                            <h4 className="text-xs font-black text-slate-700 uppercase tracking-widest flex items-center gap-2">
                                <FileJson className="w-4 h-4"/> Update Benchmark Data
                            </h4>
                            <button onClick={toggleUpload} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4"/></button>
                        </div>
                        <textarea 
                            value={jsonInput}
                            onChange={(e) => setJsonInput(e.target.value)}
                            className="w-full h-32 p-3 text-[10px] font-mono border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none mb-3"
                            placeholder='Paste JSON here (must include "results" array and "auditId")...'
                        />
                        <div className="flex justify-between items-center">
                             <div className="text-xs">
                                {validationMsg && (
                                    <span className={validationMsg.ok ? "text-emerald-600 font-bold" : "text-red-600 font-bold"}>
                                        {validationMsg.msg}
                                    </span>
                                )}
                             </div>
                             <div className="flex gap-2">
                                <button onClick={validateJson} className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-50">
                                    Validate Schema
                                </button>
                                <button 
                                    onClick={handleUploadJson} 
                                    disabled={!validationMsg?.ok}
                                    className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Upload & Publish
                                </button>
                             </div>
                        </div>
                    </div>
                )}

                {/* Error Banner */}
                {error && (
                    <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-red-500 shrink-0"/>
                        <div>
                            <h4 className="text-sm font-bold text-red-900">Benchmark Notification</h4>
                            <p className="text-xs text-red-700 mt-1">{error}</p>
                        </div>
                    </div>
                )}

                {/* Report Content */}
                {report && !running && (
                    <div className="space-y-6">
                        {renderSummary(report)}

                        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                                <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                    <Database className="w-4 h-4"/> Category Stability Results
                                </h4>
                                <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400">
                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500"/> Verified Deterministic
                                </div>
                            </div>
                            
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-xs border-collapse">
                                    <thead className="bg-slate-100 text-slate-500 font-bold uppercase border-b border-slate-200">
                                        <tr>
                                            <th className="p-4">Category</th>
                                            <th className="p-4">Snapshot / Lifecycle</th>
                                            <th className="p-4 text-right">Demand (Mn)</th>
                                            <th className="p-4 text-right">Readiness</th>
                                            <th className="p-4 text-right">Spread</th>
                                            <th className="p-4 text-right">Max Drift</th>
                                            <th className="p-4 text-center">Verdict</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {report.results.map((rawCat: CategoryResult | Bench25Item) => {
                                            // Apply new robust normalization
                                            const cat = normalizeCategoryResult(rawCat);
                                            const drift = cat.drift;
                                            
                                            return (
                                                <tr key={cat.categoryId} className="hover:bg-slate-50 group">
                                                    <td className="p-4 font-black text-slate-900">{cat.categoryId}</td>
                                                    <td className="p-4">
                                                        <div className="font-mono text-[10px] text-slate-400">{cat.snapshotId || 'N/A'}</div>
                                                        <div className="text-[10px] font-bold text-slate-600 uppercase tracking-tighter mt-0.5">{cat.lifecycle || 'UNKNOWN'}</div>
                                                    </td>
                                                    <td className="p-4 text-right font-mono font-bold text-slate-700">
                                                        {cat.demandMn?.toFixed(2) ?? '—'}
                                                    </td>
                                                    <td className="p-4 text-right font-mono font-bold text-slate-700">
                                                        {cat.readiness?.toFixed(1) ?? '—'}
                                                    </td>
                                                    <td className="p-4 text-right font-mono font-bold text-slate-700">
                                                        {cat.spread?.toFixed(1) ?? '—'}
                                                    </td>
                                                    <td className={`p-4 text-right font-mono ${drift < 0.001 ? 'text-emerald-600' : 'text-amber-600'}`}>
                                                        {drift.toFixed(4)}%
                                                    </td>
                                                    <td className="p-4 text-center">
                                                        <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${cat.verdict === 'GO' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                                                            {cat.verdict}
                                                        </span>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </SimpleErrorBoundary>
    );
};
