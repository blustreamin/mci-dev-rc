
import React from 'react';
import { DemandMetricsDiagnosticsPanel } from '../../components/DemandMetricsDiagnosticsPanel';
import { SimpleErrorBoundary } from '../../components/SimpleErrorBoundary';
import { DemandSnapshotResolver } from '../../services/deepDiveSnapshotResolvers';
import { useState, useEffect } from 'react';
import { Stethoscope, Thermometer, Loader2, RefreshCw, Microscope, Zap, Activity } from 'lucide-react';
import { toReactText } from '../../utils/reactSafe';
import { DebugValidationProbe } from '../../services/debugValidationProbe';
import { SnapshotRepairService } from '../../services/snapshotRepairService';
import { FullRebuildService } from '../../services/fullRebuildService';

interface Props {
    categoryId: string;
    monthKey: string;
}

// Inline component for Repair Tool
const RepairTool: React.FC<Props> = ({ categoryId, monthKey }) => {
    const [status, setStatus] = useState<'LOADING' | 'HEALTHY' | 'POISONED' | 'MISSING' | 'UNKNOWN'>('LOADING');
    const [statusText, setStatusText] = useState('');
    const [loading, setLoading] = useState(false);
    const [probeLoading, setProbeLoading] = useState(false);
    const [recoveryLoading, setRecoveryLoading] = useState(false);
    const [smokeLoading, setSmokeLoading] = useState(false);
    const [probeResult, setProbeResult] = useState<{ logs: string[], verdict: string, result?: any } | null>(null);
    
    // Action tracking logs
    const [actionLogs, setActionLogs] = useState<string[]>([]);

    const checkStatus = async () => {
        setStatus('LOADING');
        try {
            const res = await DemandSnapshotResolver.resolve(categoryId, monthKey);
            if (res.ok && res.data) {
                const demand = res.data.demand_index_mn;
                const lifecycle = res.lifecycle || 'UNKNOWN';
                
                const isCertified = lifecycle.includes('CERTIFIED');
                const isZero = typeof demand !== 'number' || !Number.isFinite(demand) || demand <= 0;

                if (isCertified && isZero) {
                    setStatus('POISONED');
                    setStatusText(`Poisoned: Snapshot is CERTIFIED but Demand is 0.00. Cache will be bypassed.`);
                } else if (demand > 0) {
                    setStatus('HEALTHY');
                    setStatusText(`Healthy: Found valid demand (${demand.toFixed(2)} Mn) with lifecycle ${lifecycle}.`);
                } else {
                    setStatus('UNKNOWN');
                    setStatusText(`Status: ${lifecycle}, Demand: ${demand}. Manual inspection recommended.`);
                }
            } else {
                setStatus('MISSING');
                setStatusText("No demand output snapshot found for this month.");
            }
        } catch (e: any) {
            setStatus('UNKNOWN');
            setStatusText(`Check Error: ${e.message}`);
        }
    };

    useEffect(() => { checkStatus(); }, [categoryId, monthKey]);

    const handleRebuild = async () => {
        if (!confirm(`Perform FULL REBUILD on ${categoryId}?\n\nThis will DELETE existing snapshots and run the V3 pipeline.`)) return;

        setLoading(true);
        setActionLogs(["Starting Full Rebuild V3..."]);
        try {
            const res = await FullRebuildService.runCategoryFullRebuild({
                categoryId,
                month: monthKey,
                forceDFS: true
            });
            
            if (res.ok) {
                setActionLogs(prev => [...prev, ...res.log, "Rebuild SUCCESS"]);
            } else {
                setActionLogs(prev => [...prev, ...(res.log || []), `Rebuild FAILED: ${res.error}`]);
            }
            await checkStatus();
        } catch (e: any) {
            setActionLogs(prev => [...prev, `EXCEPTION: ${e.message}`]);
        } finally {
            setLoading(false);
        }
    };

    const handleRunProbe = async () => {
        setProbeLoading(true);
        setProbeResult(null);
        try {
            const res = await DebugValidationProbe.run(categoryId);
            setProbeResult(res);
        } catch (e: any) {
            setProbeResult({ logs: [`Error: ${e.message}`], verdict: 'FAIL' });
        } finally {
            setProbeLoading(false);
        }
    };

    const handleSmokeTest = async () => {
        setSmokeLoading(true);
        setProbeResult({ logs: ["Initializing Smoke Test..."], verdict: 'PENDING' });
        
        try {
            const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("DFS_PROXY_TIMEOUT (UI)")), 90000));
            const probe = DebugValidationProbe.run(categoryId);
            
            const res = await Promise.race([probe, timeout]) as any;

            setProbeResult({ 
                logs: res.logs, 
                verdict: res.verdict === 'PASS' ? 'SMOKE_PASS' : 'SMOKE_FAIL',
                result: res.result
            });
        } catch (e: any) {
             console.error("Smoke Test Failed", e);
             setProbeResult({ logs: [`Smoke Exception: ${e.message}`], verdict: 'EXCEPTION' });
        } finally {
            setSmokeLoading(false);
        }
    };

    const handleSafeRecovery = async () => {
        if (!confirm(`Run SNAPSHOT REPAIR for ${categoryId}?\n\nThis attempts to fetch missing volume from Google/Amazon without full rebuild.`)) return;

        setRecoveryLoading(true);
        setActionLogs(["Starting Snapshot Repair..."]);
        
        try {
            const res = await SnapshotRepairService.run(categoryId, monthKey);
            
            if (res.ok) {
                setActionLogs(prev => [...prev, ...res.log]);
            } else {
                setActionLogs(prev => [...prev, ...res.log, `Repair Failed: ${res.error}`]);
            }
            await checkStatus();
        } catch (e: any) {
            setActionLogs(prev => [...prev, `EXCEPTION: ${e.message}`]);
        } finally {
            setRecoveryLoading(false);
        }
    };

    const statusColors = {
        LOADING: 'bg-slate-100 text-slate-400 border-slate-200',
        HEALTHY: 'bg-emerald-100 text-emerald-800 border-emerald-200',
        POISONED: 'bg-red-100 text-red-800 border-red-200',
        MISSING: 'bg-slate-100 text-slate-500 border-slate-200',
        UNKNOWN: 'bg-amber-100 text-amber-800 border-amber-200'
    };

    return (
        <div className="space-y-4">
            {/* Probe & Smoke Tool */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                        <Microscope className="w-4 h-4 text-indigo-500"/> Validation Plumbing Probe
                    </h4>
                    {probeResult && (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                            probeResult.verdict === 'SMOKE_PASS' || probeResult.verdict === 'PASS' ? 'bg-emerald-100 text-emerald-700' : 
                            probeResult.verdict === 'PENDING' ? 'bg-slate-100 text-slate-500' : 'bg-red-100 text-red-700'
                        }`}>
                            {probeResult.verdict}
                        </span>
                    )}
                </div>
                
                <div className="flex items-center justify-between gap-3">
                    <div className="text-[10px] text-slate-400">Diagnose VALID=0 root cause (Read + 1 Write Test)</div>
                    <div className="flex gap-2">
                        <button 
                            onClick={handleSmokeTest}
                            disabled={smokeLoading || probeLoading}
                            className="px-3 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-lg text-[10px] font-bold uppercase hover:bg-indigo-100 disabled:opacity-50 flex items-center gap-1.5 transition-all active:scale-95"
                        >
                            {smokeLoading ? <Loader2 className="w-3 h-3 animate-spin"/> : <Activity className="w-3 h-3"/>}
                            Smoke Test
                        </button>
                        <button 
                            onClick={handleRunProbe}
                            disabled={probeLoading || smokeLoading}
                            className="px-3 py-1.5 bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-[10px] font-bold uppercase hover:bg-slate-200 disabled:opacity-50 flex items-center gap-1.5"
                        >
                            {probeLoading ? <Loader2 className="w-3 h-3 animate-spin"/> : <Stethoscope className="w-3 h-3"/>}
                            Deep Probe
                        </button>
                    </div>
                </div>

                {probeResult && probeResult.result && (
                    <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-lg text-[10px]">
                        <div className="flex gap-4 mb-2 border-b border-slate-200 pb-2">
                            <div><span className="font-bold text-slate-500">Creds:</span> <span className="font-mono">{probeResult.result.credsSource}</span></div>
                            <div><span className="font-bold text-slate-500">Mode:</span> <span className="font-mono">{probeResult.result.mode}</span></div>
                        </div>
                        {probeResult.result.samples && probeResult.result.samples.length > 0 && (
                             <div className="space-y-1">
                                {probeResult.result.samples.map((s: any, i: number) => (
                                    <div key={i} className="flex justify-between font-mono text-slate-600">
                                        <span>{s.keyword}</span>
                                        <span className="font-bold">{s.search_volume}</span>
                                    </div>
                                ))}
                             </div>
                        )}
                    </div>
                )}

                {probeResult && !probeResult.result && (
                    <div className="mt-3 p-3 bg-slate-900 rounded-lg border border-slate-700 font-mono text-[10px] text-emerald-400 max-h-48 overflow-y-auto shadow-inner">
                        <div className="flex justify-between border-b border-slate-700 pb-1 mb-1">
                            <span className="font-bold text-slate-400">Execution Log</span>
                            <span className="text-slate-500">{new Date().toLocaleTimeString()}</span>
                        </div>
                        {probeResult.logs.map((l, i) => (
                            <div key={i} className={`whitespace-pre-wrap ${l.includes('[FAIL]') || l.includes('Exception') ? 'text-red-400 font-bold' : l.includes('[SUCCESS]') ? 'text-emerald-400' : 'text-slate-300'}`}>
                                {l}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Rebuild & Recovery Tool */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                        <Thermometer className="w-4 h-4 text-rose-500"/> Snapshot Repair
                    </h4>
                    <div className={`px-2 py-0.5 rounded text-[10px] font-black uppercase border ${statusColors[status]}`}>
                        {status}
                    </div>
                </div>
                
                <div className="text-[10px] font-mono text-slate-500 mb-4 bg-slate-50 p-2 rounded border border-slate-100">
                    {toReactText(statusText)}
                </div>

                <div className="flex items-center gap-3">
                    <button 
                        onClick={handleSafeRecovery}
                        disabled={recoveryLoading || loading}
                        className="flex-1 px-3 py-2 bg-emerald-600 text-white rounded-lg text-[10px] font-bold uppercase hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-sm transition-all active:scale-95"
                    >
                        {recoveryLoading ? <Loader2 className="w-3 h-3 animate-spin"/> : <Zap className="w-3 h-3 fill-current"/>}
                        Snapshot Repair
                    </button>

                    <button 
                        onClick={handleRebuild}
                        disabled={loading || recoveryLoading}
                        className="flex-1 px-3 py-2 bg-white border border-rose-200 text-rose-600 rounded-lg text-[10px] font-bold uppercase hover:bg-rose-50 disabled:opacity-50 flex items-center justify-center gap-1.5 transition-all"
                    >
                        {loading ? <Loader2 className="w-3 h-3 animate-spin"/> : <RefreshCw className="w-3 h-3"/>}
                        Full Rebuild
                    </button>
                </div>

                {actionLogs.length > 0 && (
                    <div className="mt-3 p-3 bg-slate-50 rounded-lg border border-slate-100 text-[10px] font-mono max-h-48 overflow-y-auto">
                        <div className="font-bold text-slate-600 mb-1 border-b border-slate-200 pb-1">Action Log</div>
                        {actionLogs.map((n: string, i: number) => <div key={i}>• {n}</div>)}
                    </div>
                )}
            </div>
        </div>
    );
};

export const DemandDiagnosticsTab: React.FC<Props> = ({ categoryId, monthKey }) => {
    return (
        <div className="space-y-8 animate-in fade-in duration-500">
             <div className="flex justify-between items-center">
                <h3 className="text-sm font-black text-slate-700 uppercase tracking-widest flex items-center gap-2">
                    <Activity className="w-4 h-4 text-violet-500"/> Demand Diagnostics
                </h3>
            </div>
            
            <SimpleErrorBoundary>
                <RepairTool categoryId={categoryId} monthKey={monthKey} />
            </SimpleErrorBoundary>

            <SimpleErrorBoundary>
                <DemandMetricsDiagnosticsPanel categoryId={categoryId} monthKey={monthKey} />
            </SimpleErrorBoundary>
        </div>
    );
}
