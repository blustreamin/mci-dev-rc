
import React, { useState, useEffect } from 'react';
import { CORE_CATEGORIES } from '../constants';
import { DateUtils } from '../utils/dateUtils';
import { runDemandMetricsDiagnostics, DemandMetricsDiagnosticReport } from '../services/demandMetricsDiagnostics';
import { Loader2, Activity, CheckCircle2, AlertTriangle, XCircle, Play, Database, Lock, TrendingUp, Settings } from 'lucide-react';

interface DemandMetricsDiagnosticsPanelProps {
    categoryId?: string;
    monthKey?: string;
}

function fmt(num: any, digits = 2): string {
  return Number.isFinite(num) ? Number(num).toFixed(digits) : "—";
}

const VerdictBadge = ({ verdict }: { verdict: string }) => {
    const colors = {
        PASS: 'bg-emerald-100 text-emerald-800 border-emerald-200',
        WARN: 'bg-amber-100 text-amber-800 border-amber-200',
        FAIL: 'bg-red-100 text-red-800 border-red-200',
        UNKNOWN: 'bg-slate-100 text-slate-800 border-slate-200'
    }[verdict] || 'bg-slate-100';

    return (
        <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider border ${colors}`}>
            {verdict}
        </span>
    );
};

export const DemandMetricsDiagnosticsPanel: React.FC<DemandMetricsDiagnosticsPanelProps> = ({ 
    categoryId: propCat, 
    monthKey: propMonth 
}) => {
    // If props provided, use them. Else local state.
    const [localCat, setLocalCat] = useState(CORE_CATEGORIES[0].id);
    const [localMonth, setLocalMonth] = useState(DateUtils.getCurrentMonthKey());
    
    const activeCategory = propCat || localCat;
    const activeMonth = propMonth || localMonth;

    const [report, setReport] = useState<DemandMetricsDiagnosticReport | null>(null);
    const [loading, setLoading] = useState(false);

    // Auto-refresh when props change if controlled
    useEffect(() => {
        if (propCat && propMonth) {
            setReport(null); 
            // Optional: Auto-run or just wait for button click?
            // Usually diagnostic tools wait for user intent to avoid spamming reads.
        }
    }, [propCat, propMonth]);

    const handleRun = async () => {
        setLoading(true);
        try {
            const res = await runDemandMetricsDiagnostics(activeCategory, activeMonth);
            setReport(res);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-6">
            {/* Controls - Only show selectors if not controlled */}
            <div className="flex items-center gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                {!propCat && (
                    <div className="flex items-center gap-2">
                        <label className="text-xs font-bold text-slate-500 uppercase">Target:</label>
                        <select 
                            value={localCat} 
                            onChange={e => setLocalCat(e.target.value)}
                            className="text-xs font-bold border-slate-300 rounded-lg p-2 bg-slate-50"
                        >
                            {CORE_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.category}</option>)}
                        </select>
                        <input 
                            type="month" 
                            value={localMonth}
                            onChange={e => setLocalMonth(e.target.value)}
                            className="text-xs font-bold border-slate-300 rounded-lg p-2 bg-slate-50"
                        />
                    </div>
                )}
                
                {propCat && (
                     <div className="text-xs font-bold text-slate-500 flex items-center gap-2">
                        <span>Target: {activeCategory}</span>
                        <span className="text-slate-300">|</span>
                        <span>{activeMonth}</span>
                     </div>
                )}

                <button 
                    onClick={handleRun}
                    disabled={loading}
                    className="ml-auto px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-black uppercase tracking-widest hover:bg-indigo-700 flex items-center gap-2 disabled:opacity-50"
                >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin"/> : <Play className="w-4 h-4 fill-current"/>}
                    Run Diagnostics
                </button>
            </div>

            {report && (
                <div className="animate-in fade-in slide-in-from-bottom-2 space-y-4">
                    
                    {/* High Level Verdict */}
                    <div className="flex items-center justify-between bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                        <div className="flex items-center gap-3">
                            <Activity className="w-5 h-5 text-slate-400"/>
                            <span className="text-sm font-bold text-slate-700">Diagnostic Result</span>
                        </div>
                        <VerdictBadge verdict={report.verdict} />
                    </div>

                    {/* RCA Summary */}
                    {report.rca.length > 0 && (
                        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                            <h4 className="text-xs font-black text-amber-800 uppercase tracking-widest mb-2 flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4"/> Potential Root Causes
                            </h4>
                            <ul className="space-y-1 ml-5 list-disc text-xs text-amber-900">
                                {report.rca.map((r, i) => <li key={i}>{r}</li>)}
                            </ul>
                        </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        
                        {/* 1. Corpus */}
                        <div className="bg-white p-4 rounded-xl border border-slate-200">
                            <div className="flex justify-between mb-3">
                                <h5 className="text-xs font-bold flex items-center gap-2 text-slate-700">
                                    <Database className="w-4 h-4 text-blue-500"/> Active Corpus
                                </h5>
                                <VerdictBadge verdict={report.checks.corpus.verdict} />
                            </div>
                            <div className="space-y-2 text-xs">
                                <div className="flex justify-between">
                                    <span className="text-slate-500">Snapshot ID</span>
                                    <span className="font-mono">{report.checks.corpus.snapshotId || 'NONE'}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-500">Lifecycle</span>
                                    <span className="font-bold">{report.checks.corpus.lifecycle || '-'}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-500">Valid Keywords</span>
                                    <span className={`font-bold ${report.checks.corpus.validTotal === 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                                        {report.checks.corpus.validTotal}
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-500">Zero Volume</span>
                                    <span className="font-mono">{report.checks.corpus.zeroTotal}</span>
                                </div>
                            </div>
                        </div>

                        {/* 2. Output & Cache */}
                        <div className="bg-white p-4 rounded-xl border border-slate-200">
                            <div className="flex justify-between mb-3">
                                <h5 className="text-xs font-bold flex items-center gap-2 text-slate-700">
                                    <Activity className="w-4 h-4 text-violet-500"/> Demand Output
                                </h5>
                                <VerdictBadge verdict={report.checks.demandOutput.verdict} />
                            </div>
                            <div className="space-y-2 text-xs">
                                {(!report.checks.demandOutput.metrics) ? (
                                    <div className="text-sm text-gray-500">
                                        No valid demand metrics yet. Snapshot is being recomputed.
                                    </div>
                                ) : (
                                    <>
                                        <div className="flex justify-between">
                                            <span className="text-slate-500">Demand Index</span>
                                            <span className={`font-bold ${report.checks.demandOutput.metrics.demand === 0 ? 'text-red-600' : 'text-slate-900'}`}>
                                                {fmt(report.checks.demandOutput.metrics.demand, 2)} Mn
                                            </span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-slate-500">Cache Logic</span>
                                            <span className={`font-bold ${report.checks.cacheLock.isPoisoned ? 'text-red-600' : 'text-slate-600'}`}>
                                                {report.checks.cacheLock.reason}
                                            </span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-slate-500">Linked Corpus</span>
                                            <span className="font-mono text-[10px]">{report.checks.demandOutput.linkedCorpusId || 'NONE'}</span>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* 3. Trend Lock */}
                        <div className="bg-white p-4 rounded-xl border border-slate-200">
                            <div className="flex justify-between mb-3">
                                <h5 className="text-xs font-bold flex items-center gap-2 text-slate-700">
                                    <TrendingUp className="w-4 h-4 text-pink-500"/> Trend Lock
                                </h5>
                                <VerdictBadge verdict={report.checks.trendLock.verdict} />
                            </div>
                            <div className="space-y-2 text-xs">
                                <div className="flex justify-between">
                                    <span className="text-slate-500">Lock Exists</span>
                                    <span className="font-bold">{report.checks.trendLock.lockExists ? 'YES' : 'NO'}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-slate-500">Value</span>
                                    <span className="font-mono">{report.checks.trendLock.value ?? '-'}%</span>
                                </div>
                                {report.checks.trendLock.lockedAt && (
                                    <div className="text-[10px] text-slate-400 mt-1 text-right">
                                        Locked: {new Date(report.checks.trendLock.lockedAt).toLocaleString()}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* 4. Configuration */}
                        <div className="bg-white p-4 rounded-xl border border-slate-200">
                            <div className="flex justify-between mb-3">
                                <h5 className="text-xs font-bold flex items-center gap-2 text-slate-700">
                                    <Settings className="w-4 h-4 text-slate-400"/> Runtime Config
                                </h5>
                                <VerdictBadge verdict={report.checks.config.verdict} />
                            </div>
                            <div className="space-y-2 text-xs">
                                <div className="flex justify-between">
                                    <span className="text-slate-500">Force Certify Mode</span>
                                    <span className={`font-bold ${report.checks.config.forceCertifyMode ? 'text-red-600' : 'text-emerald-600'}`}>
                                        {report.checks.config.forceCertifyMode ? 'ENABLED' : 'DISABLED'}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
