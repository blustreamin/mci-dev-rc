
import React, { useState, useEffect, useRef } from 'react';
import { AlertTriangle, Trash2, X, Loader2, CheckCircle2, ShieldAlert, Terminal, Activity, Play, Search, AlertCircle, Wrench, UploadCloud, Clock, RefreshCw, PauseCircle, XCircle, Copy, Download } from 'lucide-react';
import { CorpusResetService } from '../services/corpusResetService';
import { CorpusRebuildService } from '../services/corpusRebuildService';
import { FirestoreClient } from '../services/firestoreClient';
import { JobControlService } from '../services/jobControlService';
import { HeartbeatController } from '../services/jobHeartbeat';
import { doc, onSnapshot } from 'firebase/firestore';
import { CorpusJobControl } from '../types';
import { PreflightResolverAuditV2, AuditReportV2 } from '../services/integrity/preflightResolverAudit';
import { IndexRepairService } from '../services/indexRepairService';
import { CORE_CATEGORIES } from '../constants';
import { DfsPreflightService, PreflightResult } from '../services/dfsPreflightService';
import { ResetRebuildOrchestrator, ResetRebuildPhase } from '../services/resetRebuildOrchestrator';

interface FlushRebuildModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const FlushRebuildModal: React.FC<FlushRebuildModalProps> = ({ isOpen, onClose }) => {
    const [token, setToken] = useState('');
    const [jobId, setJobId] = useState<string | null>(null);
    const [jobState, setJobState] = useState<CorpusJobControl | null>(null);
    const [targetInfo, setTargetInfo] = useState<any>(null);
    const [auditReport, setAuditReport] = useState<AuditReportV2 | null>(null);
    const [isAuditing, setIsAuditing] = useState(false);
    const [repairLogs, setRepairLogs] = useState<string[]>([]);
    
    // DFS Preflight State
    const [dfsPreflight, setDfsPreflight] = useState<PreflightResult | null>(null);
    const [checkingDfs, setCheckingDfs] = useState(false);
    
    const heartbeatRef = useRef<HeartbeatController | null>(null);

    // UI Helpers
    const totalCats = CORE_CATEGORIES.length;

    useEffect(() => {
        if (isOpen) {
            setTargetInfo(FirestoreClient.logFirebaseTarget());
            setToken('');
            setAuditReport(null);
            setRepairLogs([]);
            // Initialize with existing cache if not stale
            if (!DfsPreflightService.isStale()) {
                setDfsPreflight(DfsPreflightService.getCachedResult());
            }
             // Try to recover latest job if modal reopened
            JobControlService.getLatestJobForCategory('GLOBAL').then(job => {
                if (job && job.kind === 'RESET_REBUILD') {
                    setJobId(job.jobId);
                }
            });
        }
    }, [isOpen]);

    useEffect(() => {
        if (!jobId) return;
        const db = FirestoreClient.getDbSafe();
        if (!db) return;
        const unsub = onSnapshot(doc(db, 'corpus_jobs', jobId), (snap) => {
            if (snap.exists()) setJobState(snap.data() as CorpusJobControl);
        });
        return () => unsub();
    }, [jobId]);

    const handleDfsCheck = async () => {
        setCheckingDfs(true);
        try {
            const res = await DfsPreflightService.checkEndpoints();
            setDfsPreflight(res);
        } catch (e: any) {
            console.error("DFS check failed", e);
            alert(`DFS Preflight Failed: ${e.message}`);
        } finally {
            setCheckingDfs(false);
        }
    };

    const handleRun = async (resume = false) => {
        const db = FirestoreClient.getDbSafe();
        if (!db) return;

        // Double check DFS preflight one last time (allow cache)
        const check = await DfsPreflightService.checkEndpoints();
        if (!check.ok) {
            alert("DFS Endpoints check failed. Fix connectivity before flushing.");
            setDfsPreflight(check);
            return;
        }

        let activeJobId = jobId;
        if (!resume || !activeJobId) {
             activeJobId = await JobControlService.startJob('RESET_REBUILD', 'GLOBAL', {
                message: 'Initializing Reset Sequence...',
                phase: 'IDLE',
                // Explicitly cast to allow custom properties
                progress: { flushed: 0, rebuilt: 0, verified: 0 } as any
            });
            setJobId(activeJobId);
        }

        ResetRebuildOrchestrator.run(activeJobId, { resumeFromRebuild: resume });
    };

    const runDiagnosticAudit = async () => {
        setIsAuditing(true);
        setAuditReport(null);
        try {
            const report = await PreflightResolverAuditV2.runResolverAuditV2(CORE_CATEGORIES.map(c => c.id));
            setAuditReport(report);
            // Re-check DFS if stale
            if (DfsPreflightService.isStale()) {
                handleDfsCheck();
            }
        } catch (e) {
            console.error("Audit failed", e);
        } finally {
            setIsAuditing(false);
        }
    };

    const handleRepairIndex = async () => {
        if (!auditReport) return;
        setRepairLogs(['Starting Index Repair...']);
        const logs = await IndexRepairService.repairCorpusIndexFromSnapshotScan(auditReport);
        setRepairLogs(prev => [...prev, ...logs]);
        runDiagnosticAudit();
    };

    const handleCopyLogs = () => {
        if (!jobState?.logs) return;
        navigator.clipboard.writeText(jobState.logs.join('\n'));
        alert("Logs copied to clipboard.");
    };

    const handleDownloadSummary = () => {
        if (!jobState) return;
        const blob = new Blob([JSON.stringify(jobState, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `reset_rebuild_summary_${jobId}.json`;
        a.click();
    };

    const handleCloseWithGuard = () => {
        if (jobState?.status === 'RUNNING') {
            if (confirm("Reset & Rebuild is still running in the background. Close window?")) {
                onClose();
            }
        } else {
            onClose();
        }
    };

    if (!isOpen) return null;

    const projectId = targetInfo?.projectId || 'unknown';
    const requiredToken = `FLUSH ${projectId}`;
    
    // Gating Logic
    const isAuditGreen = auditReport?.verdict === 'EMPTY_DB' || auditReport?.verdict === 'READY_FOR_RESET';
    const isDfsGreen = dfsPreflight?.ok === true && !DfsPreflightService.isStale();
    
    const canRun = token === requiredToken && !jobId && isAuditGreen && isDfsGreen;
    
    // Job State
    const isRunning = jobState?.status === 'RUNNING';
    const isPartial = jobState?.status === 'STOPPED' || jobState?.status === 'PARTIAL';
    const isFailed = jobState?.status === 'FAILED';
    const isComplete = jobState?.status === 'COMPLETED';
    
    const currentPhase = (jobState?.phase as ResetRebuildPhase) || 'IDLE';
    const p = jobState?.progress as any || { flushed: 0, rebuilt: 0, verified: 0 };

    return (
        <div className="fixed inset-0 z-[1300] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
                <div className="p-6 border-b border-slate-100 bg-rose-50 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${isComplete ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'}`}>
                            <ShieldAlert className="w-6 h-6"/>
                        </div>
                        <div>
                            <h2 className="text-xl font-black text-rose-900">Global Reset & Rebuild</h2>
                            <p className="text-[10px] font-bold text-rose-700 uppercase tracking-widest">
                                Phase: {currentPhase} • {jobState?.status || 'IDLE'}
                            </p>
                        </div>
                    </div>
                    <button onClick={handleCloseWithGuard} className="p-2 hover:bg-rose-100 rounded-full text-rose-400 transition-colors">
                        <X className="w-5 h-5"/>
                    </button>
                </div>

                <div className="p-8 overflow-y-auto flex-1 space-y-6">
                    {!jobId && (
                        <div className="space-y-6">
                            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-900">
                                <p className="flex items-center gap-2 font-bold mb-2"><AlertTriangle className="w-4 h-4"/> WARNING: IRREVERSIBLE DATA LOSS</p>
                                <p>This will <strong>DELETE ALL</strong> data in project <strong>{projectId}</strong>. Ensure DFS credentials are configured to allow rebuild.</p>
                            </div>

                            <div className="space-y-2">
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest">Confirmation Token</label>
                                <input type="text" value={token} onChange={e => setToken(e.target.value)} placeholder={requiredToken} className="w-full p-3 border-2 border-slate-200 rounded-xl font-mono text-sm focus:border-rose-500 outline-none" />
                            </div>

                            <div className="pt-4 border-t border-slate-100 space-y-4">
                                <div className="flex justify-between items-center">
                                    <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">System Pre-Flight</span>
                                    <button onClick={runDiagnosticAudit} disabled={isAuditing} className="text-xs bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg text-slate-700 font-bold flex items-center gap-2 transition-all">
                                        {isAuditing ? <Loader2 className="w-3 h-3 animate-spin"/> : <Search className="w-3 h-3"/>} Run DB Audit
                                    </button>
                                </div>

                                {/* DFS GATING UI */}
                                <div className={`p-4 rounded-xl border space-y-3 ${isDfsGreen ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'}`}>
                                    <div className="flex justify-between items-center">
                                        <h5 className="text-[10px] font-black uppercase text-slate-500 tracking-wider">DFS Readiness Lock</h5>
                                        <button onClick={handleDfsCheck} disabled={checkingDfs} className="text-[10px] bg-white border border-slate-200 px-2 py-1 rounded font-bold hover:bg-slate-50 transition-colors flex items-center gap-1.5">
                                            {checkingDfs ? <Loader2 className="w-3 h-3 animate-spin"/> : <RefreshCw className="w-3 h-3"/>} Re-Check
                                        </button>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="flex items-center justify-between bg-white/50 p-2.5 rounded-lg border border-black/5">
                                            <span className="text-[10px] font-bold text-slate-600 uppercase">Google (1 KW)</span>
                                            {dfsPreflight?.google.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-600"/> : <AlertCircle className="w-4 h-4 text-slate-300"/>}
                                        </div>
                                        <div className="flex items-center justify-between bg-white/50 p-2.5 rounded-lg border border-black/5">
                                            <span className="text-[10px] font-bold text-slate-600 uppercase">Amazon (2 KW)</span>
                                            {dfsPreflight?.amazon.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-600"/> : <AlertCircle className="w-4 h-4 text-slate-300"/>}
                                        </div>
                                    </div>
                                    {dfsPreflight && (
                                        <div className="flex justify-between items-center text-[9px] font-mono text-slate-400">
                                            <span className="flex items-center gap-1">
                                                {DfsPreflightService.isStale() ? <AlertTriangle className="w-3 h-3 text-amber-500"/> : <CheckCircle2 className="w-3 h-3 text-emerald-500"/>} 
                                                {DfsPreflightService.isStale() ? 'STALE (>60s)' : 'VERIFIED (cached)'}
                                            </span>
                                            <span>Last: {new Date(dfsPreflight.ts).toLocaleTimeString()}</span>
                                        </div>
                                    )}
                                    {!isDfsGreen && !checkingDfs && dfsPreflight && (
                                        <div className="p-2 bg-red-100 text-red-700 text-[10px] font-bold rounded border border-red-200">
                                            Amazon DFS endpoint not configured. Expected: dataforseo_labs/amazon/bulk_search_volume/live
                                        </div>
                                    )}
                                </div>

                                {auditReport && (
                                    <div className={`p-3 rounded-xl border flex items-center justify-between ${isAuditGreen ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                                        <span className="text-[10px] font-black uppercase tracking-wider">DB Status: {auditReport.verdict}</span>
                                        <button onClick={handleRepairIndex} className="text-[10px] bg-white px-2 py-1 rounded border border-slate-200 font-bold hover:bg-slate-50 flex items-center gap-1 shadow-sm"><Wrench className="w-3 h-3"/> Repair Pointers</button>
                                    </div>
                                )}
                                
                                {repairLogs.length > 0 && (
                                    <div className="bg-slate-900 p-3 rounded-lg text-[10px] font-mono text-emerald-400 max-h-32 overflow-y-auto custom-scrollbar">
                                        {repairLogs.map((l, i) => <div key={i}>{l}</div>)}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {jobId && jobState && (
                        <div className="space-y-6 animate-in fade-in duration-500">
                            {/* Status Banner */}
                            <div className={`p-4 rounded-xl border flex items-center justify-between shadow-sm ${
                                isRunning ? 'bg-blue-50 border-blue-200 text-blue-800' :
                                isComplete ? 'bg-emerald-50 border-emerald-200 text-emerald-800' :
                                isPartial ? 'bg-amber-50 border-amber-200 text-amber-800' :
                                'bg-red-50 border-red-200 text-red-800'
                            }`}>
                                <div className="flex items-center gap-3">
                                    {isRunning && <Loader2 className="w-5 h-5 animate-spin"/>}
                                    {isComplete && <CheckCircle2 className="w-5 h-5"/>}
                                    {isPartial && <PauseCircle className="w-5 h-5"/>}
                                    {isFailed && <XCircle className="w-5 h-5"/>}
                                    <span className="font-black uppercase tracking-tight">{jobState?.status}</span>
                                </div>
                                <div className="text-xs font-bold font-mono">
                                    {jobState?.message}
                                </div>
                            </div>

                             {/* Progress Matrix */}
                             <div className="grid grid-cols-3 gap-4">
                                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-center">
                                    <div className="text-[9px] font-black text-slate-400 uppercase mb-1">Flush</div>
                                    <div className="text-lg font-black text-slate-700">{p.flushed} / {totalCats}</div>
                                    <div className="h-1 w-full bg-slate-200 rounded-full mt-2 overflow-hidden">
                                        <div className="h-full bg-rose-500" style={{width: `${(p.flushed/totalCats)*100}%`}}/>
                                    </div>
                                </div>
                                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-center">
                                    <div className="text-[9px] font-black text-slate-400 uppercase mb-1">Rebuild</div>
                                    <div className="text-lg font-black text-slate-700">{p.rebuilt} / {totalCats}</div>
                                    <div className="h-1 w-full bg-slate-200 rounded-full mt-2 overflow-hidden">
                                        <div className="h-full bg-indigo-500" style={{width: `${(p.rebuilt/totalCats)*100}%`}}/>
                                    </div>
                                </div>
                                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-center">
                                    <div className="text-[9px] font-black text-slate-400 uppercase mb-1">Verify</div>
                                    <div className="text-lg font-black text-slate-700">{p.verified} / {totalCats}</div>
                                    <div className="h-1 w-full bg-slate-200 rounded-full mt-2 overflow-hidden">
                                        <div className="h-full bg-emerald-500" style={{width: `${(p.verified/totalCats)*100}%`}}/>
                                    </div>
                                </div>
                            </div>

                            {/* Log Stream */}
                            <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                        <Terminal className="w-3 h-3"/> Runtime Logs
                                    </h4>
                                    <div className="flex gap-2">
                                        <button onClick={handleCopyLogs} className="p-1 hover:bg-slate-100 rounded text-slate-400" title="Copy"><Copy className="w-3.5 h-3.5"/></button>
                                        <button onClick={handleDownloadSummary} className="p-1 hover:bg-slate-100 rounded text-slate-400" title="Download JSON"><Download className="w-3.5 h-3.5"/></button>
                                    </div>
                                </div>
                                <div className="bg-slate-900 rounded-xl p-4 font-mono text-[10px] text-slate-300 h-64 overflow-y-auto custom-scrollbar flex flex-col-reverse shadow-inner border border-slate-800">
                                    <div className="space-y-1">
                                        {(jobState?.logs || []).slice().reverse().map((l, i) => (
                                            <div key={i} className={`py-0.5 border-b border-white/5 last:border-0 ${l.includes('[ERROR]') ? 'text-red-400' : l.includes('[WARN]') ? 'text-amber-400' : 'text-slate-300'}`}>
                                                {l}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>

                             {/* Action Guidance */}
                             {isPartial && (
                                <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between">
                                    <div className="text-xs text-amber-800 font-bold">
                                        Rebuild was interrupted (Rate Limited).
                                    </div>
                                    <button 
                                        onClick={() => handleRun(true)}
                                        className="bg-amber-600 text-white px-4 py-2 rounded-lg text-xs font-black uppercase hover:bg-amber-700 shadow-sm flex items-center gap-2"
                                    >
                                        <Play className="w-3 h-3 fill-current"/> Resume Rebuild
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                    {!jobId ? (
                        <>
                            <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors">Cancel</button>
                            <button 
                                onClick={() => handleRun()}
                                disabled={!canRun}
                                className="px-8 py-2 bg-rose-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-rose-700 disabled:opacity-30 disabled:cursor-not-allowed shadow-lg hover:shadow-xl transition-all flex items-center gap-2"
                                title={!isDfsGreen ? "DFS Readiness Check Missing or Stale" : !isAuditGreen ? "DB Integrity Audit Failed" : !token ? "Enter Confirmation Token" : "Ready to Flush"}
                            >
                                <Trash2 className="w-4 h-4"/> Run Flush & Rebuild
                            </button>
                        </>
                    ) : (
                        <button onClick={handleCloseWithGuard} className="px-8 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold shadow-lg hover:bg-slate-800 transition-all" disabled={isRunning}>Close Monitor</button>
                    )}
                </div>
            </div>
        </div>
    );
};
