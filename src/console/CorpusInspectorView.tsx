
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
    Loader2, RefreshCw, Play, ShieldCheck, Zap, Activity, Droplets,
    Terminal, Layout, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp,
    Database, Microscope, StopCircle, XCircle, ChevronLeft, ChevronRight
} from 'lucide-react';
import { CategorySnapshotStore } from '../services/categorySnapshotStore';
import { SnapshotResolver } from '../services/snapshotResolver';
import { SnapshotKeywordRow, CorpusJobControl } from '../types';
import { dispatchCategoryAction, CategoryActionKind } from './categoryActionDispatcher';
import { JobControlService } from '../services/jobControlService';
import { CorpusHealthRunner } from '../services/corpusHealthRunner';
import { doc, onSnapshot } from 'firebase/firestore';
import { FirestoreClient } from '../services/firestoreClient';
import { SimpleErrorBoundary } from '../components/SimpleErrorBoundary';

interface Props {
    categoryId: string;
}

const TelemetryPanel: React.FC<{ logs: string[] }> = ({ logs }) => {
    const endRef = useRef<HTMLDivElement>(null);
    useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

    return (
        <div className="bg-slate-900 rounded-xl p-4 font-mono text-[10px] text-slate-300 h-48 overflow-y-auto custom-scrollbar shadow-inner border border-slate-800">
            <div className="flex items-center gap-2 mb-2 border-b border-slate-700 pb-2">
                <Terminal className="w-3 h-3 text-emerald-400"/>
                <span className="font-bold text-slate-400 uppercase tracking-widest">Operator Telemetry</span>
            </div>
            <div className="space-y-1">
                {logs.length === 0 && <span className="text-slate-600 italic">Ready for commands...</span>}
                {logs.map((l, i) => (
                    <div key={i} className={`py-0.5 break-all ${l.includes('[FAIL]') ? 'text-red-400 font-bold' : l.includes('[SUCCESS]') ? 'text-emerald-400' : 'text-slate-300'}`}>
                        {l}
                    </div>
                ))}
                <div ref={endRef} />
            </div>
        </div>
    );
};

const AnchorBreakup: React.FC<{ rows: SnapshotKeywordRow[] }> = ({ rows }) => {
    const [expanded, setExpanded] = useState(false);

    // Derived Stats (Zero Regression: Use existing rows)
    const stats = React.useMemo(() => {
        const map: Record<string, { total: number; valid: number; zero: number; active: number }> = {};
        rows.forEach(r => {
            if (!map[r.anchor_id]) map[r.anchor_id] = { total: 0, valid: 0, zero: 0, active: 0 };
            const s = map[r.anchor_id];
            s.total++;
            if (r.active) s.active++;
            if (r.status === 'VALID' || (r.volume || 0) > 0) s.valid++;
            if (r.status === 'ZERO' || (r.active && (r.volume || 0) === 0)) s.zero++;
        });
        return Object.entries(map).sort((a,b) => b[1].total - a[1].total);
    }, [rows]);

    if (rows.length === 0) return null;

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-6">
            <div 
                className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex justify-between items-center cursor-pointer"
                onClick={() => setExpanded(!expanded)}
            >
                <div className="flex items-center gap-2">
                    <Layout className="w-4 h-4 text-indigo-500"/>
                    <h4 className="text-xs font-bold text-slate-700 uppercase tracking-widest">Anchor Breakup ({stats.length})</h4>
                </div>
                {expanded ? <ChevronUp className="w-4 h-4 text-slate-400"/> : <ChevronDown className="w-4 h-4 text-slate-400"/>}
            </div>
            
            {expanded && (
                <div className="p-4 overflow-x-auto">
                    <table className="w-full text-xs text-left">
                        <thead className="bg-slate-50 text-slate-500 font-bold">
                            <tr>
                                <th className="p-2">Anchor ID</th>
                                <th className="p-2 text-right">Total</th>
                                <th className="p-2 text-right">Active</th>
                                <th className="p-2 text-right text-emerald-600">Valid</th>
                                <th className="p-2 text-right text-slate-400">Zero</th>
                                <th className="p-2 text-right">Yield</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {stats.map(([anchor, s]) => (
                                <tr key={anchor}>
                                    <td className="p-2 font-medium text-slate-700">{anchor}</td>
                                    <td className="p-2 text-right">{s.total}</td>
                                    <td className="p-2 text-right">{s.active}</td>
                                    <td className="p-2 text-right font-bold text-emerald-600">{s.valid}</td>
                                    <td className="p-2 text-right text-slate-500">{s.zero}</td>
                                    <td className="p-2 text-right text-slate-500">
                                        {s.total > 0 ? ((s.valid / s.total) * 100).toFixed(0) : 0}%
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

const CorpusInspectorView: React.FC<Props> = ({ categoryId }) => {
    const [rows, setRows] = useState<SnapshotKeywordRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [snapshotId, setSnapshotId] = useState<string | null>(null);
    
    // Telemetry & Jobs
    const [logs, setLogs] = useState<string[]>([]);
    const [activeJobId, setActiveJobId] = useState<string | null>(null);
    const [activeJobState, setActiveJobState] = useState<CorpusJobControl | null>(null);
    
    // Ref for Zombie Detection to avoid effect thrashing
    const jobStateRef = useRef<CorpusJobControl | null>(null);
    const [isStale, setIsStale] = useState(false);

    // Pagination & Sorting State
    const [pageSize, setPageSize] = useState(500);
    const [currentPage, setCurrentPage] = useState(1);

    const log = (msg: string) => setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 200));

    // MONACO WORKER PATCH (AI Studio Fix)
    useEffect(() => {
        if (window.location.host.includes('aistudio') || window.location.host.includes('googleusercontent')) {
            console.log("[MONACO_PATCH] Disabling workers for AI Studio environment");
            (window as any).MonacoEnvironment = { getWorker: () => null };
        }
        log(`[CORPUS_INSPECTOR][INIT] Ready.`);
    }, []);

    // Sync Ref
    useEffect(() => {
        jobStateRef.current = activeJobState;
    }, [activeJobState]);

    // Sorting & Pagination Logic
    const sortedRows = useMemo(() => {
        return [...rows].sort((a, b) => {
            // Primary: Google Volume DESC
            const volA = a.volume ?? 0;
            const volB = b.volume ?? 0;
            if (volB !== volA) return volB - volA;
            // Secondary: Keyword Text ASC
            return a.keyword_text.localeCompare(b.keyword_text);
        });
    }, [rows]);

    const totalPages = Math.ceil(sortedRows.length / pageSize) || 1;
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, sortedRows.length);
    const currentRows = sortedRows.slice(startIndex, endIndex);

    // Proof Log for Sorting/Pagination
    useEffect(() => {
        if (sortedRows.length > 0) {
            console.log(`[CORPUS_TABLE] rows=${sortedRows.length} page=${currentPage}/${totalPages} pageSize=${pageSize} topVolume=${currentRows[0]?.volume}`);
        }
    }, [sortedRows.length, currentPage, pageSize, currentRows]);

    const loadData = async () => {
        setLoading(true);
        setError(null);
        try {
            log(`[CORPUS_INSPECTOR] Resolving snapshot for ${categoryId}...`);
            const res = await SnapshotResolver.resolveActiveSnapshot(categoryId, 'IN', 'en');
            
            if (res.ok && res.snapshot) {
                setSnapshotId(res.snapshot.snapshot_id);
                log(`[CORPUS_INSPECTOR][SNAP_OK] id=${res.snapshot.snapshot_id} lifecycle=${res.snapshot.lifecycle}`);
                
                const rowsRes = await CategorySnapshotStore.readAllKeywordRows(
                    { categoryId, countryCode: 'IN', languageCode: 'en' },
                    res.snapshot.snapshot_id
                );
                
                if (rowsRes.ok) {
                    setRows(rowsRes.data);
                    setCurrentPage(1); // Reset pagination on new data
                    log(`[CORPUS_INSPECTOR] Loaded ${rowsRes.data.length} rows.`);
                } else {
                    setError((rowsRes as any).error || "Failed to read rows");
                    log(`[CORPUS_INSPECTOR][FAIL] Read rows error: ${(rowsRes as any).error}`);
                }
            } else {
                setError(res.reason || "No snapshot found");
                log(`[CORPUS_INSPECTOR][FAIL] No snapshot: ${res.reason}`);
            }
        } catch (e: any) {
            setError(e.message);
            log(`[CORPUS_INSPECTOR][EXCEPTION] ${e.message}`);
        } finally {
            setLoading(false);
        }
    };

    // Initial Load & Job Check
    useEffect(() => {
        loadData();
        // Check for active job on mount
        JobControlService.getActiveJobForCategory(categoryId).then(async (job) => {
            if (job) {
                // Check if this is a zombie from a previous session
                const age = job.updatedAt ? Date.now() - new Date(job.updatedAt).getTime() : Infinity;
                if (age > 180000) {
                    // Dead zombie from previous session — kill it
                    log(`[JOB_MOUNT_REAP] Found zombie job ${job.jobId} (age=${Math.round(age/1000)}s), auto-killing`);
                    try {
                        await JobControlService.finishJob(job.jobId, 'FAILED', 'Zombie job reaped on page load');
                    } catch (e) {
                        console.error(`[JOB_MOUNT_REAP] Error`, e);
                    }
                } else {
                    setActiveJobId(job.jobId);
                    log(`[JOB] Found active job ${job.jobId} (${job.kind})`);
                }
            }
        });
    }, [categoryId]);

    // --- JOB MONITOR (SINGLETON) ---
    useEffect(() => {
        if (!activeJobId) {
            setActiveJobState(null);
            setIsStale(false);
            return;
        }
        
        const db = FirestoreClient.getDbSafe();
        if (!db) return;

        console.log(`[LISTENER_ATTACH] JobWatcher jobId=${activeJobId}`);
        log(`[JOB_WATCH_START] jobId=${activeJobId}`);

        const unsub = onSnapshot(doc(db, 'corpus_jobs', activeJobId), (snap) => {
            if (snap.exists()) {
                const job = snap.data() as CorpusJobControl;
                setActiveJobState(job);
                
                if (['COMPLETED', 'FAILED', 'STOPPED', 'CANCELLED'].includes(job.status)) {
                    log(`[JOB][${job.status}] ${job.message || ''}`);
                    // Delayed detach to let UI show completion state for a moment? No, user wants instant updates.
                    // But we need to stop watching.
                    // We'll clear the ID, which triggers cleanup.
                    setActiveJobId(null); 
                    loadData(); // Refresh data
                }
            }
        });

        return () => {
            console.log(`[LISTENER_CLEANUP] JobWatcher jobId=${activeJobId}`);
            log(`[JOB_WATCH_STOP] jobId=${activeJobId}`);
            unsub();
        };
    }, [activeJobId]);

    // --- ZOMBIE DETECTION (Independent Timer) ---
    useEffect(() => {
        if (!activeJobId) return;

        const interval = setInterval(async () => {
            const job = jobStateRef.current;
            if (!job || !job.updatedAt) return;

            const last = new Date(job.updatedAt).getTime();
            const diff = Date.now() - last;
            const stale = diff > 90000; // 90s
            
            if (stale !== isStale) {
                setIsStale(stale);
                if (stale) log(`[JOB_STALE] jobId=${activeJobId} ageMs=${diff}`);
            }

            // Auto-reap: if stale >3 minutes, the service is truly dead — force finish
            if (diff > 180000) {
                log(`[JOB_REAP] jobId=${activeJobId} ageMs=${diff} — auto-killing zombie`);
                try {
                    await JobControlService.finishJob(activeJobId, 'FAILED', 'Zombie job reaped: no heartbeat for >3 minutes');
                } catch (e) {
                    console.error(`[JOB_REAP] Error`, e);
                }
                // UI will auto-clear via the Firestore listener detecting FAILED status
            }
        }, 5000);

        return () => clearInterval(interval);
    }, [activeJobId]); // Re-create only if job ID changes

    // --- ACTIONS ---

    const handleAction = async (kind: CategoryActionKind) => {
        if (!categoryId) return;
        
        log(`[UI_ACTION][CLICK] ${kind}`);
        setLoading(true);
        
        try {
            const res = await dispatchCategoryAction({
                kind,
                categoryId,
                categoryName: categoryId, 
                snapshotId: snapshotId || undefined
            });

            if (res.ok && res.jobId) {
                log(`[JOB][START] jobId=${res.jobId}`);
                setActiveJobId(res.jobId);
                setIsStale(false);
            } else {
                log(`[UI_ACTION][FAIL] ${(res as any).error}`);
            }
        } catch (e: any) {
            log(`[UI_ACTION][EXCEPTION] ${e.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handleStopJob = async () => {
        if (!activeJobId) return;
        const idToKill = activeJobId;
        log(`[STOP_CLICK] jobId=${idToKill} kind=SERVER_CANCEL`);
        
        // Send stop signal to Firestore
        await JobControlService.requestStop(idToKill);
        log(`[STOP_RESULT] Stop signal sent for ${idToKill}`);

        // Give the service 5 seconds to see the stop signal and self-terminate
        // If it doesn't, force-finish the job so it doesn't stay RUNNING forever
        setTimeout(async () => {
            try {
                const job = await JobControlService.getJob(idToKill);
                if (job && !['COMPLETED', 'FAILED', 'STOPPED', 'CANCELLED'].includes(job.status)) {
                    console.log(`[STOP_FORCE] Job ${idToKill} still ${job.status} after 5s, force-finishing`);
                    await JobControlService.finishJob(idToKill, 'STOPPED', 'Force-stopped by user (service did not self-terminate)');
                }
            } catch (e) {
                console.error(`[STOP_FORCE] Error force-finishing ${idToKill}`, e);
            }
        }, 5000);

        // Optimistic UI detach
        setActiveJobId(null);
        setActiveJobState(null);
        setIsStale(false);
    };

    const handleForceDetach = async () => {
        if (!activeJobId) return;
        const idToKill = activeJobId;
        log(`[STOP_CLICK] jobId=${idToKill} kind=UI_DETACH`);
        
        // Force-finish the job in Firestore immediately
        try {
            await JobControlService.finishJob(idToKill, 'STOPPED', 'Force-detached by user');
        } catch (e) {
            console.error(`[FORCE_DETACH] Error finishing job ${idToKill}`, e);
        }

        setActiveJobId(null);
        setActiveJobState(null);
        setIsStale(false);
    };

    const handleFixHealth = async () => {
        log(`[UI_ACTION][CLICK] FIX_HEALTH`);
        if (!confirm("Run full health repair pipeline? This includes Hydrate -> Grow -> Validate -> Prune -> Certify.")) return;
        
        setLoading(true);
        try {
            const jobId = await JobControlService.startJob('BUILD_ALL', categoryId, { message: 'Manual Health Fix' });
            setActiveJobId(jobId);
            setIsStale(false);
            
            CorpusHealthRunner.runCategoryHealthFix(categoryId, jobId)
                .then(ok => log(`[FIX_HEALTH] Completed: ${ok}`))
                .catch(e => log(`[FIX_HEALTH] Error: ${e.message}`));
                
        } catch (e: any) {
            log(`[FIX_HEALTH][EXCEPTION] ${e.message}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <SimpleErrorBoundary>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            {/* Header & Controls */}
            <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                    <div>
                        <h3 className="font-black text-slate-800 text-lg flex items-center gap-2">
                            <Database className="w-5 h-5 text-indigo-600"/> Corpus Inspector: {categoryId}
                        </h3>
                        <div className="text-[10px] font-mono text-slate-500 mt-1 flex items-center gap-2">
                            <span>SNAP: {snapshotId || 'NONE'}</span>
                            {activeJobId && <span className="text-indigo-600 font-bold animate-pulse">• JOB: {activeJobId}</span>}
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <button onClick={loadData} className="p-2 hover:bg-slate-200 rounded-full" title="Refresh">
                            {loading ? <Loader2 className="w-4 h-4 animate-spin"/> : <RefreshCw className="w-4 h-4"/>}
                        </button>
                    </div>
                </div>

                {/* ACTION BAR */}
                <div className="flex flex-wrap gap-3">
                    <button 
                        onClick={handleFixHealth}
                        disabled={!!activeJobId}
                        className="px-3 py-1.5 bg-rose-50 border border-rose-100 text-rose-700 rounded-lg text-xs font-black uppercase tracking-widest hover:bg-rose-100 disabled:opacity-50 flex items-center gap-1.5"
                    >
                        <Activity className="w-3.5 h-3.5"/> Fix Health
                    </button>
                    <div className="w-px h-6 bg-slate-200 mx-1"/>
                    <button 
                        onClick={() => handleAction('REHYDRATE')}
                        disabled={!!activeJobId}
                        className="px-3 py-1.5 bg-cyan-50 border border-cyan-100 text-cyan-700 rounded-lg text-xs font-bold hover:bg-cyan-100 disabled:opacity-50 flex items-center gap-1.5"
                    >
                        <Droplets className="w-3.5 h-3.5"/> Hydrate
                    </button>
                    <button 
                        onClick={() => handleAction('GROW_V3')}
                        disabled={!!activeJobId}
                        className="px-3 py-1.5 bg-indigo-50 border border-indigo-100 text-indigo-700 rounded-lg text-xs font-bold hover:bg-indigo-100 disabled:opacity-50 flex items-center gap-1.5"
                    >
                        <Play className="w-3.5 h-3.5"/> Grow (V3)
                    </button>
                    <button 
                        onClick={() => handleAction('EXPAND_ANCHORS')}
                        disabled={!!activeJobId}
                        className="px-3 py-1.5 bg-white border border-slate-200 text-slate-700 rounded-lg text-xs font-bold hover:bg-slate-50 disabled:opacity-50"
                    >
                        Expand Anchors
                    </button>
                    <button 
                        onClick={() => handleAction('AMAZON_BOOST')}
                        disabled={!!activeJobId}
                        className="px-3 py-1.5 bg-orange-50 border border-orange-100 text-orange-700 rounded-lg text-xs font-bold hover:bg-orange-100 disabled:opacity-50 flex items-center gap-1.5"
                    >
                        <Zap className="w-3.5 h-3.5"/> Amazon Boost
                    </button>
                    <button 
                        onClick={() => handleAction('REVALIDATE')}
                        disabled={!!activeJobId}
                        className="px-3 py-1.5 bg-blue-50 border border-blue-100 text-blue-700 rounded-lg text-xs font-bold hover:bg-blue-100 disabled:opacity-50 flex items-center gap-1.5"
                    >
                        <Microscope className="w-3.5 h-3.5"/> Validate
                    </button>
                    <button 
                        onClick={() => handleAction('CERTIFY')}
                        disabled={!!activeJobId}
                        className="px-3 py-1.5 bg-emerald-50 border border-emerald-100 text-emerald-700 rounded-lg text-xs font-black uppercase tracking-widest hover:bg-emerald-100 disabled:opacity-50 flex items-center gap-1.5"
                    >
                        <ShieldCheck className="w-3.5 h-3.5"/> Certify
                    </button>
                </div>
            </div>

            <div className="p-6 bg-slate-50">
                {/* Active Job Monitor */}
                {activeJobState && (
                    <div className="mb-6 bg-white p-4 rounded-xl border border-indigo-200 shadow-sm animate-in fade-in">
                        <div className="flex justify-between items-center mb-2">
                            <div className="flex items-center gap-3">
                                <span className={`text-xs font-black uppercase tracking-widest flex items-center gap-2 ${isStale ? 'text-amber-600' : 'text-indigo-700'}`}>
                                    {isStale ? (
                                        <><AlertTriangle className="w-3.5 h-3.5"/> ZOMBIE JOB DETECTED</>
                                    ) : (
                                        <><Loader2 className="w-3.5 h-3.5 animate-spin"/> {activeJobState.kind} RUNNING...</>
                                    )}
                                </span>
                                {isStale && <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded font-bold">Stale {'>'}90s</span>}
                            </div>
                            <span className="text-[10px] font-mono text-slate-400">{activeJobState.jobId}</span>
                        </div>
                        <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden mb-2">
                            <div 
                                className={`h-full transition-all duration-500 ${isStale ? 'bg-amber-400' : 'bg-indigo-600'}`}
                                style={{ width: `${(activeJobState.progress.processed / (activeJobState.progress.total || 1)) * 100}%` }}
                            />
                        </div>
                        <div className="flex justify-between items-center mt-2">
                            <div className="text-xs text-slate-600 font-medium">
                                {activeJobState.message}
                            </div>
                            <div className="flex gap-2">
                                <button 
                                    onClick={handleStopJob}
                                    className="px-3 py-1 bg-red-50 text-red-600 border border-red-100 rounded text-[10px] font-bold hover:bg-red-100 flex items-center gap-1"
                                >
                                    <StopCircle className="w-3 h-3"/> Stop Job
                                </button>
                                {isStale && (
                                    <button 
                                        onClick={handleForceDetach}
                                        className="px-3 py-1 bg-slate-100 text-slate-600 border border-slate-200 rounded text-[10px] font-bold hover:bg-slate-200 flex items-center gap-1"
                                    >
                                        <XCircle className="w-3 h-3"/> Force Detach UI
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2">
                        <AnchorBreakup rows={rows} />
                        
                        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                            <div className="overflow-x-auto max-h-[500px]">
                                <table className="w-full text-xs text-left">
                                    <thead className="bg-slate-100 text-slate-500 font-bold sticky top-0 z-10">
                                        <tr>
                                            <th className="p-3">Keyword</th>
                                            <th className="p-3">Anchor</th>
                                            <th className="p-3">Intent</th>
                                            <th className="p-3 text-right">Volume</th>
                                            <th className="p-3 text-right">Amz Vol</th>
                                            <th className="p-3">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {currentRows.map((r, i) => (
                                            <tr key={r.keyword_id || i} className="hover:bg-slate-50">
                                                <td className="p-3 font-medium text-slate-800">{r.keyword_text}</td>
                                                <td className="p-3 text-slate-500">{r.anchor_id}</td>
                                                <td className="p-3 text-slate-500">{r.intent_bucket}</td>
                                                <td className="p-3 text-right font-mono">{r.volume}</td>
                                                <td className="p-3 text-right font-mono text-orange-600">{r.amazonVolume || '-'}</td>
                                                <td className="p-3">
                                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                                        r.status === 'VALID' ? 'bg-emerald-100 text-emerald-700' : 
                                                        r.status === 'ZERO' ? 'bg-slate-100 text-slate-500' : 'bg-amber-100 text-amber-700'
                                                    }`}>
                                                        {r.status}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {rows.length === 0 && !loading && !error && (
                                    <div className="p-8 text-center text-slate-400">No keywords found.</div>
                                )}
                            </div>
                            
                            {/* Pagination Footer */}
                            <div className="p-3 bg-slate-50 border-t border-slate-100 flex flex-col sm:flex-row justify-between items-center gap-3 text-xs">
                                <div className="flex items-center gap-2">
                                    <span className="text-slate-500 font-medium">Rows per page:</span>
                                    <select 
                                        value={pageSize}
                                        onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
                                        className="bg-white border border-slate-200 rounded px-2 py-1 text-xs font-bold text-slate-700 outline-none focus:ring-1 focus:ring-indigo-500"
                                    >
                                        {[50, 100, 250, 500].map(s => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                </div>

                                <div className="text-slate-500 font-mono">
                                    {Math.min(startIndex + 1, sortedRows.length)}-{endIndex} of {sortedRows.length} <span className="text-slate-300">|</span> Vol Desc
                                </div>

                                <div className="flex items-center gap-1">
                                    <button 
                                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                        disabled={currentPage === 1}
                                        className="p-1 px-3 bg-white border border-slate-200 rounded hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed font-bold text-slate-600 transition-colors"
                                    >
                                        Prev
                                    </button>
                                    <span className="px-2 font-mono text-slate-500">
                                        {currentPage} / {totalPages || 1}
                                    </span>
                                    <button 
                                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                        disabled={currentPage >= totalPages}
                                        className="p-1 px-3 bg-white border border-slate-200 rounded hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed font-bold text-slate-600 transition-colors"
                                    >
                                        Next
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <div className="lg:col-span-1">
                        <TelemetryPanel logs={logs} />
                        {error && (
                            <div className="mt-4 p-4 bg-red-50 text-red-600 text-xs rounded-xl border border-red-100">
                                <strong>Error:</strong> {error}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
        </SimpleErrorBoundary>
    );
};

export default CorpusInspectorView;
