
import React, { useState, useMemo } from 'react';
import { 
    Activity, AlertTriangle, ArrowRight, BarChart3, CheckCircle2, 
    Clock, Database, FileText, Filter, HelpCircle, Layout, Lock, 
    RefreshCw, Search, ShieldCheck, Target, TrendingUp, X, Microscope, Archive, Zap, UploadCloud, Server, FileSpreadsheet, PieChart, FileCode
} from 'lucide-react';
import { 
    CategoryBaseline, FetchableData, KeywordMetric, SweepResult, AuditLogEntry, ValidityReport 
} from './types';
import { DemandGraph } from './DemandGraph';
import { BacktestTruthInjector, BacktestSeedV1 } from './src/services/backtestTruthInjector';
import { CsvTruthIngestion, IngestionLog } from './src/services/csvTruthIngestion';
import { KeywordValidityService } from './src/services/keywordValidityService';

interface DemandSweepViewProps {
    categories: CategoryBaseline[];
    results: Record<string, FetchableData<SweepResult>>;
    onRunDemand: (catIds: string[]) => void;
    onRunDeepDive?: (catIds: string[]) => void;
    onRunWarmup?: (catIds: string[]) => void;
}

// ... Helpers ...
const formatNumber = (num: number, decimals = 1) => {
    if (num >= 1000000) return (num / 1000000).toFixed(decimals) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(decimals) + 'K';
    return num.toString();
};

const formatDate = (isoString?: string) => {
    if (!isoString) return 'N/A';
    return new Date(isoString).toLocaleString('en-IN', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
    });
};

const ForensicDrawer: React.FC<{ 
    isOpen: boolean; 
    onClose: () => void; 
    result?: SweepResult;
}> = ({ isOpen, onClose, result }) => {
    if (!isOpen || !result) return null;
    const audit = result.demandAudit;

    return (
        <div className="fixed inset-0 z-50 flex justify-end">
            <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
            <div className="relative w-full max-w-lg bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
                <div className="p-6 border-b border-slate-100 flex justify-between items-start bg-slate-50">
                    <div>
                        <h3 className="text-xl font-black text-slate-900 flex items-center gap-2">
                            <ShieldCheck className="w-5 h-5 text-indigo-600"/> Forensic Report
                        </h3>
                        <p className="text-xs text-slate-500 mt-1 font-mono">{result.runId || 'NO_RUN_ID'}</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full text-slate-500 transition-colors"><X className="w-5 h-5" /></button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-6 space-y-8">
                    
                    {/* Strategy Audit */}
                    <section>
                        <h4 className="text-xs font-bold uppercase text-slate-400 mb-3 tracking-wider flex items-center gap-2">
                            <FileCode className="w-3 h-3"/> Strategy Alignment
                        </h4>
                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
                            <div className="flex justify-between text-xs">
                                <span className="text-slate-500">Strategy Hash:</span>
                                <span className="font-mono font-bold text-slate-700">{audit?.strategyHashUsed?.substring(0, 12)}...</span>
                            </div>
                            <div className="flex justify-between text-xs">
                                <span className="text-slate-500">Keywords In Scope:</span>
                                <span className="font-bold text-slate-900">{audit?.strategyKeywordCount}</span>
                            </div>
                            <div className="flex justify-between text-xs">
                                <span className="text-slate-500">Resolved:</span>
                                <span className="font-bold text-emerald-600">{audit?.resolvedKeywordCount}</span>
                            </div>
                        </div>
                    </section>

                    {/* Volume Table */}
                    {audit?.anchorVolumes && (
                        <section>
                            <h4 className="text-xs font-bold uppercase text-slate-400 mb-3 tracking-wider flex items-center gap-2">
                                <PieChart className="w-3 h-3"/> Anchor Volume Check
                            </h4>
                            <div className="border border-slate-200 rounded-lg overflow-hidden">
                                <table className="w-full text-xs text-left">
                                    <thead className="bg-slate-50 text-slate-500">
                                        <tr>
                                            <th className="p-2">Anchor</th>
                                            <th className="p-2 text-right">Vol</th>
                                            <th className="p-2 text-right">Res%</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {audit.anchorVolumes.map((a: any, i: number) => (
                                            <tr key={i}>
                                                <td className="p-2 font-medium text-slate-700 truncate max-w-[120px]">{a.anchorName}</td>
                                                <td className="p-2 text-right font-mono">{formatNumber(a.totalVolume)}</td>
                                                <td className="p-2 text-right text-slate-500">{((a.resolvedCount / a.keywordCount)*100).toFixed(0)}%</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </section>
                    )}

                    {/* JSON Dump */}
                    <section>
                        <h4 className="text-xs font-bold uppercase text-slate-400 mb-3 tracking-wider">Raw Audit Data</h4>
                        <pre className="bg-slate-900 text-green-400 p-4 rounded-lg text-[10px] overflow-x-auto font-mono">
                            {JSON.stringify(audit, null, 2)}
                        </pre>
                    </section>
                </div>
            </div>
        </div>
    );
};

export const DemandSweepView: React.FC<DemandSweepViewProps> = ({ categories, results, onRunDemand, onRunDeepDive, onRunWarmup }) => {
    const [activeTab, setActiveTab] = useState<string>(categories[0]?.id || '');
    const [showForensic, setShowForensic] = useState(false);
    
    React.useEffect(() => {
        if (!activeTab && categories.length > 0) setActiveTab(categories[0].id);
    }, [categories, activeTab]);

    const activeCategory = categories.find(c => c.id === activeTab);
    const activeResult = activeTab ? results[activeTab] : undefined;

    return (
        <div className="min-h-screen pb-20">
            {/* Header & Tabs */}
            <div className="sticky top-16 z-20 bg-slate-50/95 backdrop-blur border-b border-slate-200">
                <div className="max-w-7xl mx-auto px-4 py-2 flex flex-col md:flex-row items-center justify-between gap-4">
                    <div className="flex gap-2 overflow-x-auto w-full md:w-auto custom-scrollbar pb-1">
                        {categories.map(cat => (
                            <button key={cat.id} onClick={() => setActiveTab(cat.id)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition-all ${activeTab === cat.id ? 'bg-white text-slate-900 shadow-md ring-1 ring-slate-200' : 'text-slate-500 hover:bg-white/50'}`}>
                                {results[cat.id]?.status === 'Success' ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500"/> : <div className="w-2 h-2 rounded-full bg-slate-300" />} {cat.category}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-4 pt-8">
                {/* 2D Demand Graph */}
                <DemandGraph 
                    categories={categories} 
                    results={results} 
                    activeCategoryId={activeCategory?.id || null} 
                    onCategorySelect={(id) => setActiveTab(id)} 
                />

                {(!activeResult || activeResult.status !== 'Success' || !activeResult.data) ? (
                    <div className="text-center py-20 bg-white rounded-xl border border-dashed border-slate-300">
                        <BarChart3 className="w-12 h-12 mx-auto text-slate-300 mb-4" />
                        <h3 className="text-xl font-bold text-slate-900">Demand Intelligence Ready</h3>
                        <button onClick={() => activeCategory && onRunDemand([activeCategory.id])} className="bg-indigo-600 text-white px-6 py-2 rounded-lg font-bold hover:bg-indigo-700 shadow-lg flex items-center gap-2 mx-auto mt-6">
                            <Activity className="w-4 h-4" /> Run Demand Audit
                        </button>
                    </div>
                ) : (
                    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-8">
                        {/* Summary Card */}
                        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                            <div>
                                <h1 className="text-2xl font-black text-slate-900 mb-2">{activeResult.data.category}</h1>
                                <div className="flex flex-wrap gap-4 text-xs text-slate-500 font-medium">
                                    <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {formatDate(activeResult.lastAttempt)}</span>
                                    {/* Fixed: Replaced activeResult.data.strategyHash with valid path activeResult.data.demandAudit?.strategyHashUsed */}
                                    <span className="flex items-center gap-1 font-mono"><Lock className="w-3.5 h-3.5" /> Strategy Hash: {activeResult.data.demandAudit?.strategyHashUsed?.substring(0, 8)}...</span>
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <button onClick={() => setShowForensic(true)} className="text-slate-500 hover:text-slate-900 px-3 py-2 text-xs font-bold flex items-center gap-2 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
                                    <ShieldCheck className="w-4 h-4" /> Forensic
                                </button>
                                <button onClick={() => activeCategory && onRunDemand([activeCategory.id])} className="text-indigo-600 hover:text-indigo-700 px-3 py-2 text-xs font-bold flex items-center gap-2 border border-indigo-100 rounded-lg bg-indigo-50 hover:bg-indigo-100 transition-colors">
                                    <RefreshCw className="w-4 h-4" /> Run Again
                                </button>
                            </div>
                        </div>

                        {/* KPI Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm"><div className="text-xs font-bold text-slate-400 uppercase">Demand Index</div><div className="text-3xl font-black text-slate-900">{activeResult.data.demand_index_mn.toFixed(1)} Mn</div></div>
                            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm"><div className="text-xs font-bold text-slate-400 uppercase">Readiness</div><div className="text-3xl font-black text-slate-900">{activeResult.data.metric_scores.readiness.toFixed(1)} /10</div></div>
                            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm"><div className="text-xs font-bold text-slate-400 uppercase">Spread</div><div className="text-3xl font-black text-slate-900">{activeResult.data.metric_scores.spread.toFixed(1)} /10</div></div>
                        </div>
                        
                        <ForensicDrawer isOpen={showForensic} onClose={() => setShowForensic(false)} result={activeResult.data} />
                    </div>
                )}
            </div>
        </div>
    );
};
