
import React, { useState, useMemo, useEffect } from 'react';
import { 
    Activity, AlertTriangle, ArrowRight, BarChart3, CheckCircle2, 
    Clock, Database, Filter, Lock, 
    RefreshCw, Search, ShieldCheck, Microscope, Zap, 
    ChevronLeft, ChevronRight, Eye, EyeOff, List, Grid, Sliders, Search as SearchIcon,
    Loader2, Sparkles
} from 'lucide-react';
import { 
    CategoryBaseline, FetchableData, SweepResult, DemandInsight 
} from '../types';
import { DemandGraph } from '../components/DemandGraph';
import { DemandIndexVsReadinessChart } from '../components/DemandIndexVsReadinessChart'; // New Import
import { BenchmarksModal } from '../components/BenchmarksModal';
import { DemandMetricsAdapter } from '../services/demandMetricsAdapter';
import { CORE_CATEGORIES } from '../constants';
import { safeNum, safeStr, safeText, assertMetricShape } from '../utils/safety';
import { toReactText } from '../utils/reactSafe';
import { FORCE_CERTIFY_MODE, DEMAND_BASELINE_MODE } from '../constants/runtimeFlags';
import { DemandRunner } from '../services/demandRunner';
import { WindowingService } from '../services/windowing';
import { DemandProvenanceAudit } from '../services/demandProvenanceAudit';
import { logCountsConsistency } from '../services/corpusCounts';
import { JobRunner } from '../services/jobRunner';
import { DemandInsightsService } from '../services/demandInsightsService';

interface DemandSweepViewProps {
    categories: CategoryBaseline[];
    results: Record<string, FetchableData<SweepResult>>;
    onRunDemand: (catIds: string[]) => Promise<void>;
    onRunDeepDive?: (catIds: string[]) => void;
    onRunWarmup?: (catIds: string[]) => void;
}

// --- HELPERS ---
const isFiniteNumber = (v: any) => typeof v === 'number' && Number.isFinite(v);

const canRenderDemandInsights = (m: SweepResult) => {
    return !!m && 
        isFiniteNumber(m.demand_index_mn) && 
        isFiniteNumber(m.metric_scores?.readiness) && 
        isFiniteNumber(m.metric_scores?.spread);
}

// --- DETERMINISTIC SUMMARY COMPONENT ---

const DemandAnalystSummary: React.FC<{ 
    category: CategoryBaseline; 
    result: SweepResult; 
    rank: number;
    totalCategories: number;
    isLoading: boolean;
}> = ({ category, result, rank, totalCategories, isLoading }) => {
    // Local state for client-side generation if missing from snapshot
    const [localInsights, setLocalInsights] = useState<DemandInsight | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);

    // Reset local insights when category changes
    useEffect(() => {
        setLocalInsights(null);
        setIsGenerating(false);
    }, [category.id]);

    // Lazy Load Trigger
    useEffect(() => {
        // If no persisted insights, no local insights, not currently loading, and we have valid metrics:
        if (!result.demand_insights && !localInsights && !isGenerating && canRenderDemandInsights(result)) {
            
            // Proof Log
            console.log(`[DEMAND_INSIGHTS_STATUS] category=${category.id} canRender=true source=${result.indexSource || "unknown"}`);
            if (process.env.NODE_ENV === 'development') {
                console.log("[DEMAND_INSIGHTS_DEBUG] keys=", Object.keys(result || {}));
            }

            setIsGenerating(true);
            const month = result.trend_5y?.windowId || new Date().toISOString().slice(0, 7);
            
            DemandInsightsService.generate(category.id, result, month)
                .then(insight => {
                    if (insight) setLocalInsights(insight);
                })
                .catch(err => {
                    console.warn(`[DEMAND_INSIGHTS] Lazy gen failed for ${category.id}`, err);
                })
                .finally(() => setIsGenerating(false));
        }
    }, [result, category.id, localInsights, isGenerating]);

    // Resolve insights source: Persisted > Local > Null
    const insights = result.demand_insights || localInsights;
    const isLazyLoading = isGenerating && !insights;

    // Defensive extraction (Fallbacks)
    const demand = safeNum(result.demand_index_mn);
    const readiness = safeNum(result.metric_scores?.readiness);
    const spread = safeNum(result.metric_scores?.spread);
    const trend = safeNum(result.trend_5y?.value_percent);
    const trendLabel = safeStr(result.trend_5y?.trend_label, 'Stable');

    // Title Logic (Legacy Fallback)
    let title = insights?.title || "Balanced Opportunity";
    if (!insights) {
        if (rank <= 3 && readiness <= 5) title = "High Demand, Low Maturity Opportunity";
        else if (readiness >= 7 && spread >= 7) title = "Ready Market with Broad Coverage";
        else if (readiness >= 7 && spread < 5) title = "Ready but Concentrated Market";
        else if (rank > 10 && trend > 10) title = "Early Momentum Category";
    }

    // Badge Logic
    const primaryOpp = insights?.opportunity || (readiness <= 5 ? "Education + discovery funnel" : (readiness <= 7 ? "Consideration + comparison" : "Conversion + retention"));
    const riskFlag = insights?.riskFlag || (spread < 4 ? "Concentration risk" : (demand < 0.3 ? "Low scale" : (trend < -5 ? "Declining interest" : "No major risks")));
    const nextAction = readiness > 7 ? "Open Deep Dive" : "Inspect Keywords";

    const executiveSummary = insights?.executiveSummary || 
        `${toReactText(category.category)} ranks #${rank} by Demand Index. Demand is ${demand.toFixed(2)} Mn with readiness ${readiness.toFixed(1)}/10 and spread ${spread.toFixed(1)}/10. The 5Y trend is ${trend.toFixed(1)}% (${toReactText(trendLabel)}).`;

    return (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-6 animate-in fade-in slide-in-from-top-4 duration-500 relative overflow-hidden">
            {(isLoading || isLazyLoading) && (
                <div className="absolute inset-0 bg-white/40 backdrop-blur-[1px] flex items-center justify-center z-10">
                    <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
                </div>
            )}
            
            <div className="flex flex-col lg:flex-row justify-between gap-6">
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                        {insights ? <Sparkles className="w-3.5 h-3.5 text-indigo-500"/> : null}
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-500">
                            {insights ? 'AI Demand Insights' : 'Analyst Summary'}
                        </span>
                        <div className="h-px flex-1 bg-slate-100" />
                    </div>
                    <h3 className="text-xl font-black text-slate-900 mb-2 tracking-tight">
                        {toReactText(title)}
                    </h3>
                    <p className="text-sm text-slate-600 leading-relaxed font-medium">
                        {toReactText(executiveSummary)}
                    </p>
                    {insights?.breakdown && (
                        <div className="mt-3 space-y-1">
                            {insights.breakdown.map((pt, i) => (
                                <div key={i} className="flex items-start gap-2 text-xs text-slate-500">
                                    <span className="mt-1.5 w-1 h-1 rounded-full bg-indigo-400 shrink-0"/>
                                    <span>{toReactText(pt)}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                
                <div className="flex flex-wrap lg:flex-nowrap gap-3 shrink-0 items-start">
                    <div className="bg-emerald-50 border border-emerald-100 px-3 py-2 rounded-xl text-center min-w-[120px] max-w-[180px]">
                        <div className="text-[8px] font-black text-emerald-600 uppercase mb-1">Primary Opportunity</div>
                        <div className="text-[10px] font-bold text-emerald-900 leading-tight">{toReactText(primaryOpp)}</div>
                    </div>
                    <div className="bg-amber-50 border border-amber-100 px-3 py-2 rounded-xl text-center min-w-[120px] max-w-[180px]">
                        <div className="text-[8px] font-black text-amber-600 uppercase mb-1">Risk Flag</div>
                        <div className="text-[10px] font-bold text-amber-900 leading-tight">{toReactText(riskFlag)}</div>
                    </div>
                    <div className="bg-indigo-50 border border-indigo-100 px-3 py-2 rounded-xl text-center min-w-[120px]">
                        <div className="text-[8px] font-black text-indigo-600 uppercase mb-1">Next Action</div>
                        <div className="text-[10px] font-bold text-indigo-900">{toReactText(nextAction)}</div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export const DemandSweepView: React.FC<DemandSweepViewProps> = ({ categories, results, onRunDemand, onRunDeepDive }) => {
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [showBenchmarks, setShowBenchmarks] = useState(false);
    const [sortKey, setSortKey] = useState<'demand' | 'readiness' | 'spread' | 'trend'>('demand');
    const [showOnlyReady, setShowOnlyReady] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    
    // Provenance State for Active Item
    const [activeProvenance, setActiveProvenance] = useState<{ fingerprint: string, ok: boolean } | null>(null);
    const [repairing, setRepairing] = useState(false);

    // Defensive sorting and selection
    const sortedData = useMemo(() => {
        return categories.map(cat => {
            const res = results[cat.id]?.data;
            const status = results[cat.id]?.status || 'Pending';
            const error = results[cat.id]?.error?.message;
            
            // Apply safeNum to all metrics to prevent object leaks
            const demand = res ? safeNum(res.demand_index_mn) : 0;
            const readiness = res ? safeNum(res.metric_scores?.readiness) : 0;
            const spread = res ? safeNum(res.metric_scores?.spread) : 0;
            const trend = res ? safeNum(res.trend_5y?.value_percent, -999) : -999;

            return { cat, res, demand, readiness, spread, trend, status, error };
        }).filter(item => {
            if (showOnlyReady && item.status !== 'Success') return false;
            if (searchQuery && !item.cat.category.toLowerCase().includes(searchQuery.toLowerCase())) return false;
            return true;
        }).sort((a, b) => {
            if (sortKey === 'demand') return b.demand - a.demand;
            if (sortKey === 'readiness') return b.readiness - a.readiness;
            if (sortKey === 'spread') return b.spread - a.spread;
            if (sortKey === 'trend') return b.trend - a.trend;
            return 0;
        });
    }, [categories, results, sortKey, showOnlyReady, searchQuery]);

    const activeItem = useMemo(() => {
        if (selectedId) {
            const found = sortedData.find(i => i.cat.id === selectedId);
            if (found) return found;
        }
        return sortedData[0];
    }, [selectedId, sortedData]);

    const activeRank = useMemo(() => {
        if (!activeItem) return 0;
        const index = sortedData.findIndex(i => i.cat.id === activeItem.cat.id);
        return index !== -1 ? index + 1 : 0;
    }, [activeItem, sortedData]);

    // Provenance Check Effect
    useEffect(() => {
        if (!activeItem) return;
        
        const checkProvenance = async () => {
            try {
                const month = WindowingService.getCurrentMonthWindowId();
                const audit = await DemandProvenanceAudit.auditCategory(activeItem.cat.id, month);
                if (audit.ok && audit.fingerprint) {
                    setActiveProvenance({ fingerprint: audit.fingerprint, ok: true });
                    // LOG CONSISTENCY
                    if (audit.counts) {
                        logCountsConsistency("DemandSweep", activeItem.cat.id, audit.counts);
                    }
                } else {
                    setActiveProvenance({ fingerprint: 'ERROR', ok: false });
                }
            } catch (e) {
                setActiveProvenance({ fingerprint: 'EXCEPTION', ok: false });
            }
        };
        
        checkProvenance();
    }, [activeItem]);

    const handleAdvance = (dir: 'next' | 'prev') => {
        if (sortedData.length === 0) return;
        const idx = sortedData.findIndex(i => i.cat.id === activeItem?.cat.id);
        let nextIdx = dir === 'next' ? idx + 1 : idx - 1;
        if (nextIdx >= sortedData.length) nextIdx = 0;
        if (nextIdx < 0) nextIdx = sortedData.length - 1;
        setSelectedId(sortedData[nextIdx].cat.id);
    };

    const handleResetData = () => {
        if (confirm("Reset local demand data?")) {
            localStorage.clear();
            window.location.reload();
        }
    };
    
    const handleRunDeepDive = (categoryId: string) => {
        console.log(`[DEEPDIVE_NAV_CLICK] categoryId=${categoryId} month=${WindowingService.getCurrentMonthWindowId()} source=DemandSweepView`);
        if (onRunDeepDive) {
            onRunDeepDive([categoryId]);
        }
    };

    const handleRepair = async () => {
        if (!activeItem) return;
        
        const catId = activeItem.cat.id;
        const month = WindowingService.getCurrentMonthWindowId();
        const snapId = activeProvenance?.fingerprint || "NONE";

        // [AUDIT] 1. User Intent
        console.log(`[DEMAND_REPAIR_CLICK] categoryId=${catId} month=${month} corpusSnap=${snapId}`);
        
        if (!confirm("This will recompute demand metrics from the current corpus snapshot and overwrite the latest output for this month.")) return;
        
        setRepairing(true);

        try {
            // [AUDIT] 2. Dispatching
            console.log(`[DEMAND_REPAIR_DISPATCHING] kind=DEMAND_REPAIR categoryId=${catId} month=${month}`);
            
            await onRunDemand([catId]);
            
            // [AUDIT] 3. Proof of Job
            let jobId = "UNKNOWN";
            try {
                // Peek at recent jobs to confirm dispatch
                const recent = await JobRunner.getRecentJobs(3);
                const match = recent.find(j => j.categoryId === catId && ['PENDING','RUNNING','COMPLETED'].includes(j.status));
                if (match) jobId = match.jobId;
            } catch (err) { /* best effort */ }

            console.log(`[DEMAND_REPAIR_DISPATCHED] jobId=${jobId} kind=RUN_DEMAND categoryId=${catId} month=${month}`);

        } catch (e: any) {
             console.error(`[DEMAND_REPAIR_ERROR] code=DISPATCH_FAIL message=${e.message} categoryId=${catId} month=${month}`);
             alert(`Repair Failed: ${e.message}`);
        } finally {
            setRepairing(false);
        }
    };

    const isMismatch = useMemo(() => {
        if (!activeItem || !activeItem.res) return true;
        if (!activeProvenance || !activeProvenance.ok) return true; // Treat unknown as mismatch for safety
        
        return activeItem.res.corpusFingerprint !== activeProvenance.fingerprint;
    }, [activeItem, activeProvenance]);

    // SUPPRESSION GUARD (P0 Zero-Risk)
    // Hides the alert if we are in benchmark/baseline mode, where mismatch is expected (synthetic/static data).
    const shouldSuppressSyncAlert = useMemo(() => {
        // 1. Runtime Flag Check
        if (DEMAND_BASELINE_MODE) {
             // Reduced noise log
             return true;
        }

        // 2. Data Source Check
        if (activeItem?.res) {
            const src = activeItem.res.demand_insights?.source || activeItem.res.indexSource;
            if (src === 'MARKET_WEIGHTED_V1' || src === 'BENCHMARK' || src === 'BENCHMARK_ONLY') {
                 return true;
            }
        }
        
        return false;
    }, [activeItem]);

    return (
        <div className="max-w-7xl mx-auto px-4 pb-32">
            
            {FORCE_CERTIFY_MODE && (
                <div className="bg-red-500 text-white text-xs font-bold text-center py-2 rounded-b-xl mb-4 shadow-lg animate-pulse">
                    ⚠️ FORCE CERTIFY MODE ENABLED (DEV ONLY) - DATA MAY BE SYNTHETIC
                </div>
            )}

            {/* Header Area */}
            <div className="pt-8 mb-8 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
                <div>
                    <h1 className="text-4xl font-black text-slate-900 tracking-tight mb-2">Demand Landscape</h1>
                    <p className="text-slate-500 font-medium text-lg leading-relaxed max-w-2xl">
                        Cross-category intelligence for Bharat grooming demand.
                    </p>
                </div>
                <div className="flex gap-2">
                    <button 
                        onClick={() => setShowBenchmarks(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-white border border-indigo-100 text-indigo-600 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-indigo-50 transition-all shadow-sm"
                    >
                        <ShieldCheck className="w-4 h-4"/> Demand Benchmarks
                    </button>
                    <button 
                        onClick={handleResetData}
                        className="p-2 bg-white border border-red-100 text-red-500 rounded-xl hover:bg-red-50 transition-all shadow-sm"
                    >
                        <RefreshCw className="w-4 h-4"/>
                    </button>
                </div>
            </div>

            {/* Filters Row */}
            <div className="bg-white border border-slate-200 rounded-[2rem] p-4 mb-6 shadow-sm flex flex-col gap-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3 overflow-x-auto no-scrollbar pb-1 flex-1">
                        <button 
                            onClick={() => setSelectedId(null)}
                            className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all border ${!selectedId ? 'bg-slate-900 text-white border-slate-900' : 'bg-slate-50 text-slate-400 border-transparent hover:bg-slate-100'}`}
                        >
                            All Categories
                        </button>
                        {CORE_CATEGORIES.map(cat => (
                            <button 
                                key={cat.id}
                                onClick={() => setSelectedId(cat.id)}
                                className={`px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all border ${selectedId === cat.id ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' : 'bg-white text-slate-500 border-slate-100 hover:border-slate-300'}`}
                            >
                                {toReactText(cat.category)}
                            </button>
                        ))}
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                        <div className="relative">
                            <SearchIcon className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                            <input 
                                type="text" 
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                placeholder="Search..."
                                className="pl-9 pr-4 py-2 bg-slate-50 border-none rounded-xl text-xs font-bold w-40 focus:ring-2 focus:ring-indigo-500"
                            />
                        </div>
                        <select 
                            value={sortKey} 
                            onChange={e => setSortKey(e.target.value as any)}
                            className="bg-slate-50 border-none rounded-xl text-xs font-bold p-2 focus:ring-2 focus:ring-indigo-500"
                        >
                            <option value="demand">Sort: Demand</option>
                            <option value="readiness">Sort: Readiness</option>
                            <option value="spread">Sort: Spread</option>
                            <option value="trend">Sort: 5Y Trend</option>
                        </select>
                        <label className="flex items-center gap-2 cursor-pointer bg-slate-50 px-3 py-2 rounded-xl">
                            <input 
                                type="checkbox" 
                                checked={showOnlyReady} 
                                onChange={e => setShowOnlyReady(e.target.checked)}
                                className="rounded text-indigo-600"
                            />
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Ready Only</span>
                        </label>
                    </div>
                </div>
            </div>

            {/* A) NEW: RANKED DOT PLOT (Primary Visualization) */}
            <div className="mb-8">
                <DemandGraph 
                    categories={selectedId ? categories.filter(c => c.id === selectedId) : categories} 
                    results={results} 
                    activeCategoryId={activeItem?.cat.id || null} 
                    onCategorySelect={setSelectedId} 
                    sortKey={sortKey}
                />
            </div>
            
            {/* New Demand vs Readiness Chart */}
            <div className="mb-8">
                <DemandIndexVsReadinessChart 
                     categories={selectedId ? categories.filter(c => c.id === selectedId) : categories}
                     results={results}
                     activeCategoryId={activeItem?.cat.id || null}
                     onCategorySelect={setSelectedId}
                />
            </div>

            {/* B) Analyst Summary Card */}
            {activeItem?.res && activeItem.demand > 0 && (
                <DemandAnalystSummary 
                    category={activeItem.cat} 
                    result={activeItem.res} 
                    rank={activeRank}
                    totalCategories={sortedData.length}
                    isLoading={results[activeItem.cat.id]?.status === 'Running'}
                />
            )}
            
            {/* Sync / Repair Block */}
            {activeItem?.cat.id && (isMismatch || !activeItem.res) && !shouldSuppressSyncAlert && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-8 flex flex-col md:flex-row items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <AlertTriangle className="w-5 h-5 text-amber-600" />
                        <div>
                            <h4 className="text-sm font-bold text-amber-900">Demand Sync Alert</h4>
                            <p className="text-xs text-amber-700">
                                {activeItem.res ? "Persisted demand metrics mismatch corpus state." : "Demand metrics missing for this month."}
                            </p>
                            <div className="mt-1 text-[9px] font-mono text-amber-600 opacity-75">
                                Output: {activeItem.res?.corpusFingerprint?.substring(0,16) || 'NONE'} | Corpus: {activeProvenance?.fingerprint?.substring(0,16) || 'UNKNOWN'}
                            </div>
                        </div>
                    </div>
                    <button 
                        onClick={handleRepair} 
                        disabled={repairing}
                        className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold uppercase tracking-widest flex items-center gap-2 shadow-sm transition-all disabled:opacity-50"
                    >
                        {repairing ? <Loader2 className="w-3 h-3 animate-spin"/> : <RefreshCw className="w-3 h-3"/>}
                        Recompute / Repair From Corpus
                    </button>
                </div>
            )}

            {/* B.2) Error Banner */}
            {activeItem?.error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-8 flex items-center gap-3">
                     <AlertTriangle className="w-5 h-5 text-red-600" />
                     <div>
                         <h4 className="text-sm font-bold text-red-800">Computation Failed</h4>
                         <p className="text-xs text-red-600">{toReactText(activeItem.error)}</p>
                     </div>
                </div>
            )}

            {/* C) Comparative Matrix Table */}
            <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-xl overflow-hidden mb-8">
                <div className="px-8 py-6 bg-slate-50/50 border-b border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-white rounded-xl shadow-sm border border-slate-200">
                            <List className="w-5 h-5 text-indigo-600"/>
                        </div>
                        <h2 className="text-lg font-black text-slate-900 tracking-tight uppercase">Comparative Matrix</h2>
                    </div>
                    
                    <div className="flex items-center gap-1">
                        <button 
                            onClick={() => handleAdvance('prev')}
                            className="p-2 hover:bg-white rounded-xl transition-all text-slate-400 hover:text-indigo-600"
                        >
                            <ChevronLeft className="w-5 h-5" />
                        </button>
                        <button 
                            onClick={() => handleAdvance('next')}
                            className="p-2 hover:bg-white rounded-xl transition-all text-slate-400 hover:text-indigo-600"
                        >
                            <ChevronRight className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-slate-50/80 sticky top-0 z-10">
                            <tr className="border-b border-slate-200">
                                <th className="p-4 pl-8 text-[10px] font-black text-slate-400 uppercase tracking-widest">Category</th>
                                <th className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Demand (Mn)</th>
                                <th className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Readiness</th>
                                <th className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Spread</th>
                                <th className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">5Y Trend</th>
                                <th className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Status</th>
                                <th className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {sortedData.map(item => {
                                const isActive = activeItem?.cat.id === item.cat.id;
                                const hasValidData = item.res && item.demand > 0;
                                const displayStatus = hasValidData ? 'Ready' : (item.status === 'Success' ? 'NEEDS_DEMAND' : item.status);
                                const statusColor = displayStatus === 'Ready' ? 'text-emerald-600' : (displayStatus === 'NEEDS_DEMAND' ? 'text-amber-500' : 'text-slate-300');

                                return (
                                    <tr 
                                        key={item.cat.id} 
                                        onClick={() => setSelectedId(item.cat.id)}
                                        className={`group cursor-pointer transition-all ${isActive ? 'bg-indigo-50/70 border-l-4 border-l-indigo-600' : 'hover:bg-slate-50'}`}
                                    >
                                        <td className="p-4 pl-8">
                                            <div className="text-sm font-bold text-slate-900 group-hover:text-indigo-600">{toReactText(item.cat.category)}</div>
                                        </td>
                                        <td className="p-4 text-right font-mono text-xs font-bold text-slate-700">
                                            {hasValidData ? item.demand.toFixed(2) + ' Mn' : '—'}
                                        </td>
                                        <td className="p-4 text-right font-mono text-xs font-bold text-slate-700">
                                            {hasValidData ? `${safeNum(item.readiness).toFixed(1)}/10` : '—'}
                                        </td>
                                        <td className="p-4 text-right font-mono text-xs font-bold text-slate-700">
                                            {hasValidData ? `${safeNum(item.spread).toFixed(1)}/10` : '—'}
                                        </td>
                                        <td className="p-4 text-center">
                                            {hasValidData ? (
                                                <div className={`inline-flex px-2 py-0.5 rounded text-[10px] font-black border ${item.trend > 5 ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : (item.trend < -5 ? 'bg-red-50 text-red-700 border-red-100' : 'bg-slate-50 text-slate-500 border-slate-100')}`}>
                                                    {item.trend > 0 ? '+' : ''}{safeNum(item.trend).toFixed(1)}%
                                                </div>
                                            ) : '—'}
                                        </td>
                                        <td className="p-4 text-right">
                                            <div className={`inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest ${statusColor}`}>
                                                {displayStatus === 'Ready' ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3"/>}
                                                {toReactText(displayStatus)}
                                            </div>
                                        </td>
                                        <td className="p-4 text-right">
                                            <div className="flex justify-end gap-2">
                                                <button onClick={(e) => { e.stopPropagation(); onRunDemand([item.cat.id]); }} className="p-2 text-indigo-600 hover:bg-white rounded-lg transition-colors" title="Run Demand Audit"><RefreshCw className="w-4 h-4"/></button>
                                                {/* Deep Dive Button Fix: Always enabled, navigates to V2 for context check */}
                                                <button 
                                                    onClick={(e) => { e.stopPropagation(); handleRunDeepDive(item.cat.id); }} 
                                                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[10px] font-bold uppercase tracking-wide transition-all shadow-sm" 
                                                    title="Open Deep Dive V2"
                                                >
                                                    Deep Dive
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            <BenchmarksModal isOpen={showBenchmarks} onClose={() => setShowBenchmarks(false)} />
        </div>
    );
};
