
import React, { useState, useEffect } from 'react';
import { Database, Plus, RefreshCw, Layers, ShieldCheck, AlertTriangle, Loader2 } from 'lucide-react';
import { CORE_CATEGORIES } from '../../constants';
import { DateUtils } from '../../utils/dateUtils';
import { SignalCorpusService } from '../../services/signalCorpusService';
import { SignalCorpusDiagnostics, SignalCorpusDiagnosticsResult } from '../../services/signalCorpusDiagnostics';
import { toReactText } from '../../utils/reactSafe';

interface SignalCorpusPanelProps {
    categoryId?: string;
    monthKey?: string;
}

export const SignalCorpusPanel: React.FC<SignalCorpusPanelProps> = ({ categoryId: propCat, monthKey: propMonth }) => {
    const [localCat, setLocalCat] = useState(CORE_CATEGORIES[0].id);
    const [localMonth, setLocalMonth] = useState(DateUtils.getCurrentMonthKey());
    
    const activeCategory = propCat || localCat;
    const activeMonth = propMonth || localMonth;

    const [limit, setLimit] = useState(90);
    const [minTrust, setMinTrust] = useState(70);
    const [cap, setCap] = useState(40);
    
    const [status, setStatus] = useState<SignalCorpusDiagnosticsResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [opLoading, setOpLoading] = useState(false);
    const [msg, setMsg] = useState('');

    const loadStatus = async () => {
        setLoading(true);
        try {
            const res = await SignalCorpusDiagnostics.probeSnapshot(activeCategory, activeMonth);
            setStatus(res);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadStatus();
    }, [activeCategory, activeMonth]);

    const handleCreate = async () => {
        setOpLoading(true);
        setMsg('');
        try {
            const res = await SignalCorpusService.createSnapshot(activeCategory, activeMonth, {
                limit,
                minTrust,
                platformCapRatio: cap / 100
            });
            
            if (res.ok) {
                setMsg(`Success: Created ${res.snapshotId} with ${res.stats?.count} signals.`);
                loadStatus();
            } else {
                setMsg(`Error: ${res.error}`);
            }
        } catch (e: any) {
            setMsg(`Exception: ${e.message}`);
        } finally {
            setOpLoading(false);
        }
    };

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-4">
            <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest flex items-center gap-2">
                    <Layers className="w-4 h-4 text-violet-500"/> Signal Corpus Manager
                </h3>
                <div className="flex items-center gap-2">
                    {msg && <span className="text-xs text-indigo-600 font-bold">{msg}</span>}
                </div>
            </div>

            <div className="p-5">
                <div className="flex flex-wrap gap-4 mb-6 items-end">
                    {/* Selectors only if uncontrolled */}
                    {!propCat && (
                        <>
                            <div className="space-y-1">
                                <label className="text-[10px] font-bold text-slate-500 uppercase">Category</label>
                                <select 
                                    value={localCat} 
                                    onChange={e => setLocalCat(e.target.value)}
                                    className="block w-40 text-xs font-bold border-slate-300 rounded p-2"
                                >
                                    {CORE_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.category}</option>)}
                                </select>
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] font-bold text-slate-500 uppercase">Month</label>
                                <input 
                                    type="month" 
                                    value={localMonth} 
                                    onChange={e => setLocalMonth(e.target.value)}
                                    className="block w-32 text-xs font-bold border-slate-300 rounded p-1.5"
                                />
                            </div>
                        </>
                    )}

                    <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-500 uppercase">Limit</label>
                        <input 
                            type="number" 
                            value={limit} 
                            onChange={e => setLimit(Number(e.target.value))}
                            className="block w-16 text-xs font-bold border-slate-300 rounded p-1.5"
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-500 uppercase">Min Trust</label>
                        <input 
                            type="number" 
                            value={minTrust} 
                            onChange={e => setMinTrust(Number(e.target.value))}
                            className="block w-16 text-xs font-bold border-slate-300 rounded p-1.5"
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-500 uppercase">Cap %</label>
                        <input 
                            type="number" 
                            value={cap} 
                            onChange={e => setCap(Number(e.target.value))}
                            className="block w-16 text-xs font-bold border-slate-300 rounded p-1.5"
                        />
                    </div>
                    <button 
                        onClick={handleCreate}
                        disabled={opLoading}
                        className="bg-violet-600 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-violet-700 disabled:opacity-50 flex items-center gap-2 mb-[1px]"
                    >
                        {opLoading ? <Loader2 className="w-3 h-3 animate-spin"/> : <RefreshCw className="w-3 h-3"/>}
                        {status?.exists ? 'Refresh Snapshot' : 'Create Snapshot'}
                    </button>
                </div>

                <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 flex items-center gap-6 text-xs">
                    {loading ? (
                        <span className="text-slate-400 flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin"/> Loading Status...</span>
                    ) : status?.exists ? (
                        <>
                            <div className="flex items-center gap-2">
                                <ShieldCheck className="w-4 h-4 text-emerald-500"/>
                                <span className="font-bold text-slate-700">Snapshot Active</span>
                            </div>
                            <div className="h-4 w-px bg-slate-200"/>
                            <div>
                                <span className="text-slate-500">ID:</span> <span className="font-mono font-bold">{status.snapshotId}</span>
                            </div>
                            <div>
                                <span className="text-slate-500">Chunks:</span> <span className="font-bold">{status.chunks}</span>
                            </div>
                            <div>
                                <span className="text-slate-500">Signals:</span> <span className="font-bold text-indigo-600">{status.signals}</span>
                            </div>
                            <div>
                                <span className="text-slate-500">Updated:</span> <span className="font-mono">{status.lastUpdated ? new Date(status.lastUpdated).toLocaleDateString() : '-'}</span>
                            </div>
                        </>
                    ) : (
                        <div className="flex items-center gap-2 text-slate-400 italic">
                            <AlertTriangle className="w-4 h-4"/> No snapshot found for this configuration.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
