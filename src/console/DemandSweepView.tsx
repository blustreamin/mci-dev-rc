
import React, { useState, useMemo, useEffect } from 'react';
import { 
    Activity, AlertTriangle, ArrowRight, BarChart3, CheckCircle2, 
    TrendingUp, TrendingDown, Minus, Target, Users, Layers,
    RefreshCw, Search, ShieldCheck, Microscope, Zap, Globe,
    ChevronRight, Eye, Loader2, Sparkles, ArrowUpRight, ArrowDownRight,
    PieChart, Hash, Clock, Flame, Shield, AlertCircle, Brain, DollarSign
} from 'lucide-react';
import { 
    CategoryBaseline, FetchableData, SweepResult, DemandInsight 
} from '../types';
import { BenchmarksModal } from '../components/BenchmarksModal';
import { safeNum, safeStr, safeText } from '../utils/safety';
import { toReactText } from '../utils/reactSafe';
import { FORCE_CERTIFY_MODE, DEMAND_BASELINE_MODE } from '../constants/runtimeFlags';
import { DemandRunner } from '../services/demandRunner';
import { WindowingService } from '../services/windowing';
import { JobRunner } from '../services/jobRunner';
import { DemandInsightsService } from '../services/demandInsightsService';
import { useProjectStore } from '../config/ProjectStore';
import { PlatformDB } from '../services/platformDB';

interface DemandSweepViewProps {
    categories: CategoryBaseline[];
    results: Record<string, FetchableData<SweepResult>>;
    onRunDemand: (catIds: string[]) => Promise<void>;
    onRunDeepDive?: (catIds: string[]) => void;
}

const isFiniteNumber = (v: any) => typeof v === 'number' && Number.isFinite(v);
const fmt = (v: number, decimals = 1) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(decimals)}M` : v >= 1_000 ? `${(v / 1_000).toFixed(decimals)}K` : v.toFixed(decimals);
const fmtMn = (v: number) => v >= 1 ? `${v.toFixed(2)} Mn` : v >= 0.01 ? `${(v * 1000).toFixed(0)}K` : `${(v * 1_000_000).toFixed(0)}`;

// --- METRIC GAUGE ---
const MetricGauge: React.FC<{ 
    value: number; max: number; label: string; sublabel: string; 
    color: string; bgColor: string; icon: React.ReactNode 
}> = ({ value, max, label, sublabel, color, bgColor, icon }) => {
    const pct = Math.min(100, (value / max) * 100);
    return (
        <div className={`${bgColor} rounded-2xl p-5 border border-opacity-20`} style={{ borderColor: color }}>
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg" style={{ backgroundColor: `${color}15` }}>{icon}</div>
                    <span className="text-[10px] font-black uppercase tracking-[0.15em]" style={{ color }}>{label}</span>
                </div>
                <span className="text-2xl font-black tracking-tight" style={{ color }}>{value.toFixed(1)}<span className="text-sm font-bold opacity-60">/{max}</span></span>
            </div>
            <div className="h-2 bg-white/60 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-1000 ease-out" style={{ width: `${pct}%`, backgroundColor: color }} />
            </div>
            <p className="text-[10px] font-medium mt-2 opacity-70" style={{ color }}>{sublabel}</p>
        </div>
    );
};

// --- DEMAND HERO CARD ---
const DemandHeroCard: React.FC<{
    category: CategoryBaseline;
    demand: number;
    readiness: number;
    spread: number;
    trend: number;
    trendLabel: string;
    corpusStats: { total: number; valid: number; topKeyword: string; topVolume: number } | null;
}> = ({ category, demand, readiness, spread, trend, trendLabel, corpusStats }) => {
    
    const demandStr = fmtMn(demand);
    const trendIcon = trend > 2 ? <TrendingUp className="w-4 h-4" /> : trend < -2 ? <TrendingDown className="w-4 h-4" /> : <Minus className="w-4 h-4" />;
    const trendColor = trend > 2 ? 'text-emerald-600' : trend < -2 ? 'text-red-500' : 'text-slate-500';
    
    const maturity = readiness >= 7 ? 'Mature' : readiness >= 4 ? 'Developing' : 'Nascent';
    const maturityColor = readiness >= 7 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : readiness >= 4 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-violet-50 text-violet-700 border-violet-200';

    return (
        <div className="bg-white rounded-3xl border border-slate-200 shadow-lg overflow-hidden">
            <div className="px-8 py-5 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-2xl font-black text-white tracking-tight">{toReactText(category.category)}</h2>
                        <p className="text-slate-400 text-sm font-medium mt-1">{toReactText(category.consumerDescription || 'Consumer category analysis')}</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className={`px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border ${maturityColor}`}>
                            {maturity} Market
                        </span>
                        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold ${trendColor} bg-white/10`}>
                            {trendIcon}
                            {trend > 0 ? '+' : ''}{trend.toFixed(1)}% 5Y
                        </div>
                    </div>
                </div>
            </div>
            
            <div className="px-8 py-8">
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                    <div className="lg:col-span-1">
                        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2">Demand Volume</div>
                        <div className="text-5xl font-black text-slate-900 tracking-tighter leading-none">{demandStr}</div>
                        <div className="text-xs text-slate-500 font-medium mt-1">monthly searches</div>
                        {corpusStats && (
                            <div className="mt-4 p-3 bg-slate-50 rounded-xl border border-slate-100">
                                <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Corpus Quality</div>
                                <div className="flex items-center gap-4 text-xs">
                                    <div><span className="font-black text-slate-800">{corpusStats.valid}</span><span className="text-slate-400">/{corpusStats.total} valid</span></div>
                                    <div className="text-slate-300">|</div>
                                    <div className="text-slate-500 font-medium truncate" title={corpusStats.topKeyword}>
                                        Top: <span className="font-bold text-slate-700">{corpusStats.topKeyword}</span> ({fmt(corpusStats.topVolume, 0)})
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                    
                    <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-4">
                        <MetricGauge
                            value={readiness} max={10}
                            label="Engagement Readiness"
                            sublabel={readiness >= 7 ? 'Consumers actively comparing & buying' : readiness >= 4 ? 'Growing intent but needs nurturing' : 'Awareness stage — education needed'}
                            color={readiness >= 7 ? '#059669' : readiness >= 4 ? '#d97706' : '#7c3aed'}
                            bgColor={readiness >= 7 ? 'bg-emerald-50/50' : readiness >= 4 ? 'bg-amber-50/50' : 'bg-violet-50/50'}
                            icon={<Target className="w-4 h-4" style={{ color: readiness >= 7 ? '#059669' : readiness >= 4 ? '#d97706' : '#7c3aed' }} />}
                        />
                        <MetricGauge
                            value={spread} max={10}
                            label="Market Spread"
                            sublabel={spread >= 7 ? 'Well-distributed across segments' : spread >= 4 ? 'Moderate concentration' : 'Highly concentrated — few segments dominate'}
                            color={spread >= 7 ? '#0284c7' : spread >= 4 ? '#ea580c' : '#dc2626'}
                            bgColor={spread >= 7 ? 'bg-sky-50/50' : spread >= 4 ? 'bg-orange-50/50' : 'bg-red-50/50'}
                            icon={<Layers className="w-4 h-4" style={{ color: spread >= 7 ? '#0284c7' : spread >= 4 ? '#ea580c' : '#dc2626' }} />}
                        />
                        <MetricGauge
                            value={Math.abs(trend)} max={50}
                            label="5-Year Momentum"
                            sublabel={trend > 5 ? 'Strong growth trajectory' : trend > 0 ? 'Modest positive movement' : trend > -5 ? 'Flat — needs category activation' : 'Declining — structural headwinds'}
                            color={trend > 5 ? '#059669' : trend > 0 ? '#0284c7' : trend > -5 ? '#6b7280' : '#dc2626'}
                            bgColor={trend > 5 ? 'bg-emerald-50/50' : trend > 0 ? 'bg-sky-50/50' : trend > -5 ? 'bg-slate-50' : 'bg-red-50/50'}
                            icon={trend > 0 ? <TrendingUp className="w-4 h-4" style={{ color: trend > 5 ? '#059669' : '#0284c7' }} /> : <TrendingDown className="w-4 h-4" style={{ color: '#dc2626' }} />}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- STRATEGIC INSIGHTS PANEL ---
const StrategicInsightsPanel: React.FC<{
    category: CategoryBaseline;
    result: SweepResult;
    insights: DemandInsight | null;
    isGenerating: boolean;
}> = ({ category, result, insights, isGenerating }) => {
    const readiness = safeNum(result.metric_scores?.readiness);
    const spread = safeNum(result.metric_scores?.spread);
    
    const quadrant = readiness >= 5 && spread >= 5 ? 'SCALE' : readiness >= 5 && spread < 5 ? 'DEEPEN' : readiness < 5 && spread >= 5 ? 'CONVERT' : 'BUILD';
    const quadrantMeta: Record<string, { title: string; color: string; desc: string }> = {
        SCALE: { title: 'Scale & Dominate', color: '#059669', desc: 'High readiness + broad spread — ready for aggressive market capture' },
        DEEPEN: { title: 'Deepen & Diversify', color: '#0284c7', desc: 'Strong intent but concentrated — expand into adjacent segments' },
        CONVERT: { title: 'Convert & Educate', color: '#d97706', desc: 'Broad awareness but low conversion — invest in consideration content' },
        BUILD: { title: 'Build & Educate', color: '#7c3aed', desc: 'Early stage — focus on awareness, education, and trust building' },
    };
    const q = quadrantMeta[quadrant];

    return (
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-8">
                <div className="flex items-center gap-3 mb-6">
                    <div className="p-2 rounded-xl" style={{ backgroundColor: `${q.color}15` }}>
                        <Brain className="w-5 h-5" style={{ color: q.color }} />
                    </div>
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: q.color }}>Strategic Position</div>
                        <h3 className="text-xl font-black text-slate-900 tracking-tight">{q.title}</h3>
                    </div>
                </div>
                <p className="text-sm text-slate-600 font-medium mb-6">{q.desc}</p>

                {isGenerating && (
                    <div className="flex items-center gap-3 p-4 bg-indigo-50 rounded-xl mb-6">
                        <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
                        <span className="text-xs font-bold text-indigo-700">Generating AI analysis...</span>
                    </div>
                )}

                {insights && (
                    <div className="space-y-6">
                        <div>
                            <div className="flex items-center gap-2 mb-3">
                                <Sparkles className="w-4 h-4 text-indigo-500" />
                                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-500">AI Analysis</span>
                            </div>
                            <h4 className="text-lg font-black text-slate-900 mb-2">{toReactText(insights.title)}</h4>
                            <p className="text-sm text-slate-600 leading-relaxed">{toReactText(insights.executiveSummary)}</p>
                        </div>

                        {insights.breakdown && insights.breakdown.length > 0 && (
                            <div className="space-y-2">
                                {insights.breakdown.map((pt, i) => (
                                    <div key={i} className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl">
                                        <span className="mt-0.5 w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-[10px] font-black shrink-0">{i + 1}</span>
                                        <span className="text-xs text-slate-700 leading-relaxed font-medium">{toReactText(pt)}</span>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
                            <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100">
                                <div className="flex items-center gap-2 mb-2">
                                    <Flame className="w-4 h-4 text-emerald-600" />
                                    <span className="text-[9px] font-black uppercase tracking-widest text-emerald-600">Opportunity</span>
                                </div>
                                <p className="text-xs font-bold text-emerald-900 leading-relaxed">{toReactText(insights.opportunity)}</p>
                            </div>
                            <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100">
                                <div className="flex items-center gap-2 mb-2">
                                    <Shield className="w-4 h-4 text-amber-600" />
                                    <span className="text-[9px] font-black uppercase tracking-widest text-amber-600">Risk Flag</span>
                                </div>
                                <p className="text-xs font-bold text-amber-900 leading-relaxed">{toReactText(insights.riskFlag)}</p>
                            </div>
                            <div className="p-4 bg-indigo-50 rounded-2xl border border-indigo-100">
                                <div className="flex items-center gap-2 mb-2">
                                    <ArrowRight className="w-4 h-4 text-indigo-600" />
                                    <span className="text-[9px] font-black uppercase tracking-widest text-indigo-600">Next Action</span>
                                </div>
                                <p className="text-xs font-bold text-indigo-900 leading-relaxed">
                                    {readiness > 7 ? 'Run Deep Dive analysis' : readiness > 4 ? 'Expand keyword corpus + harvest signals' : 'Build awareness corpus + content mapping'}
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {!insights && !isGenerating && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="p-4 bg-slate-50 rounded-xl">
                            <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Demand Signal</div>
                            <p className="text-xs text-slate-600">{safeNum(result.demand_index_mn) >= 1 ? 'Strong volume base indicates established consumer interest' : safeNum(result.demand_index_mn) >= 0.1 ? 'Moderate search activity — growing awareness' : 'Low volume — early-stage or niche category'}</p>
                        </div>
                        <div className="p-4 bg-slate-50 rounded-xl">
                            <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Market Readiness</div>
                            <p className="text-xs text-slate-600">{readiness >= 7 ? 'Consumers actively in purchase journey' : readiness >= 4 ? 'Intent building — comparison and evaluation phase' : 'Exploration phase — mostly informational queries'}</p>
                        </div>
                        <div className="p-4 bg-slate-50 rounded-xl">
                            <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Coverage Gap</div>
                            <p className="text-xs text-slate-600">{spread >= 7 ? 'Well-covered across sub-segments' : spread >= 4 ? 'Some segments underserved' : 'Heavy concentration risk — diversification needed'}</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

// --- INTENT DISTRIBUTION CARD ---
const IntentDistributionCard: React.FC<{ result: SweepResult }> = ({ result }) => {
    const audit = result.demandAudit;
    if (!audit) return null;
    
    const total = safeNum(result.demandIndexAbsolute);
    const anchors = audit.anchorVolumes || [];
    if (anchors.length === 0) return null;

    const sorted = [...anchors].sort((a, b) => b.totalVolume - a.totalVolume);
    const colors = ['#4f46e5', '#0284c7', '#059669', '#d97706', '#dc2626', '#7c3aed', '#ec4899', '#64748b'];

    return (
        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-8">
            <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-indigo-50 rounded-xl"><PieChart className="w-5 h-5 text-indigo-600" /></div>
                <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-500">Demand Distribution</div>
                    <h3 className="text-lg font-black text-slate-900">Volume by Research Anchor</h3>
                </div>
            </div>

            <div className="h-4 rounded-full overflow-hidden flex mb-6 bg-slate-100">
                {sorted.map((a, i) => {
                    const pct = total > 0 ? (a.totalVolume / total) * 100 : 0;
                    if (pct < 1) return null;
                    return <div key={a.anchorName} className="h-full transition-all" style={{ width: `${pct}%`, backgroundColor: colors[i % colors.length] }} title={`${a.anchorName}: ${pct.toFixed(1)}%`} />;
                })}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {sorted.map((a, i) => {
                    const pct = total > 0 ? (a.totalVolume / total) * 100 : 0;
                    return (
                        <div key={a.anchorName} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                            <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: colors[i % colors.length] }} />
                            <div className="flex-1 min-w-0">
                                <div className="text-xs font-bold text-slate-800 truncate">{a.anchorName.replace(/_/g, ' ')}</div>
                                <div className="text-[10px] text-slate-500">{a.keywordCount} keywords</div>
                            </div>
                            <div className="text-right shrink-0">
                                <div className="text-sm font-black text-slate-800">{fmt(a.totalVolume, 0)}</div>
                                <div className="text-[10px] text-slate-400">{pct.toFixed(1)}%</div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

// --- MAIN VIEW ---
export const DemandSweepView: React.FC<DemandSweepViewProps> = ({ categories, results, onRunDemand, onRunDeepDive }) => {
    const projectStore = useProjectStore();
    const [showBenchmarks, setShowBenchmarks] = useState(false);
    const [recomputing, setRecomputing] = useState(false);
    const [localInsights, setLocalInsights] = useState<Record<string, DemandInsight>>({});
    const [generatingInsights, setGeneratingInsights] = useState<Set<string>>(new Set());
    const [corpusStats, setCorpusStats] = useState<Record<string, any>>({});

    const sortedData = useMemo(() => {
        return categories.map(cat => {
            const res = results[cat.id]?.data;
            const status = results[cat.id]?.status || 'Pending';
            const error = results[cat.id]?.error?.message;
            return {
                cat, res,
                demand: res ? safeNum(res.demand_index_mn) : 0,
                readiness: res ? safeNum(res.metric_scores?.readiness) : 0,
                spread: res ? safeNum(res.metric_scores?.spread) : 0,
                trend: res ? safeNum(res.trend_5y?.value_percent) : 0,
                trendLabel: res ? safeStr(res.trend_5y?.trend_label, 'Stable') : 'Stable',
                status, error,
            };
        }).sort((a, b) => b.demand - a.demand);
    }, [categories, results]);

    const activeItem = sortedData[0];

    useEffect(() => {
        if (!activeItem) return;
        PlatformDB.getCorpus(activeItem.cat.id).then(corpus => {
            if (corpus && corpus.rows) {
                const valid = corpus.rows.filter((r: any) => (r.volume || 0) > 0);
                const topRow = valid.sort((a: any, b: any) => (b.volume || 0) - (a.volume || 0))[0];
                setCorpusStats(prev => ({
                    ...prev,
                    [activeItem.cat.id]: {
                        total: corpus.rows.length,
                        valid: valid.length,
                        topKeyword: topRow?.keyword_text || '-',
                        topVolume: topRow?.volume || 0,
                    }
                }));
            }
        });
    }, [activeItem?.cat.id]);

    useEffect(() => {
        if (!activeItem?.res || !activeItem.res.demand_index_mn) return;
        const catId = activeItem.cat.id;
        if (localInsights[catId] || generatingInsights.has(catId)) return;

        setGeneratingInsights(prev => new Set(prev).add(catId));
        const month = activeItem.res.trend_5y?.windowId || new Date().toISOString().slice(0, 7);
        
        DemandInsightsService.generate(catId, activeItem.res, month)
            .then(insight => {
                if (insight) setLocalInsights(prev => ({ ...prev, [catId]: insight }));
            })
            .finally(() => setGeneratingInsights(prev => { const n = new Set(prev); n.delete(catId); return n; }));
    }, [activeItem?.res, activeItem?.cat.id]);

    const handleRecompute = async () => {
        if (!activeItem) return;
        setRecomputing(true);
        try { await onRunDemand([activeItem.cat.id]); } finally { setRecomputing(false); }
    };

    const handleDeepDive = (catId: string) => { if (onRunDeepDive) onRunDeepDive([catId]); };

    const projectName = projectStore.hasProject ? projectStore.project?.projectName : null;
    const geoName = projectStore.hasProject ? projectStore.countryName : 'India';

    return (
        <div className="max-w-7xl mx-auto px-4 pb-32">
            <div className="pt-8 mb-8 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
                <div>
                    <h1 className="text-4xl font-black text-slate-900 tracking-tight mb-2">Demand Landscape</h1>
                    <p className="text-slate-500 font-medium text-lg leading-relaxed max-w-2xl">
                        {projectName ? `Market demand intelligence for ${projectName} in ${geoName}` : `Cross-category consumer demand intelligence`}
                    </p>
                </div>
                <div className="flex gap-2">
                    <button onClick={handleRecompute} disabled={recomputing} className="flex items-center gap-2 px-5 py-2.5 bg-slate-900 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg disabled:opacity-50">
                        {recomputing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Recompute Demand
                    </button>
                    <button onClick={() => setShowBenchmarks(true)} className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-50 transition-all shadow-sm">
                        <ShieldCheck className="w-4 h-4" /> Benchmarks
                    </button>
                </div>
            </div>

            {(!activeItem || !activeItem.res || activeItem.demand === 0) && activeItem?.status !== 'Running' && (
                <div className="bg-white rounded-3xl border border-slate-200 p-12 text-center mb-8">
                    <BarChart3 className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                    <h3 className="text-xl font-black text-slate-800 mb-2">No Demand Data Yet</h3>
                    <p className="text-slate-500 mb-6 max-w-md mx-auto">Run a demand sweep to compute demand volume, engagement readiness, and market spread metrics from your DFS-verified keyword corpus.</p>
                    <button onClick={handleRecompute} disabled={recomputing} className="px-6 py-3 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 transition-all shadow-lg disabled:opacity-50">
                        {recomputing ? 'Computing...' : 'Run Demand Sweep'}
                    </button>
                </div>
            )}

            {activeItem?.status === 'Running' && (
                <div className="bg-indigo-50 border border-indigo-100 rounded-3xl p-8 mb-8 flex items-center gap-4">
                    <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
                    <div>
                        <h3 className="text-lg font-black text-indigo-900">Computing Demand Metrics...</h3>
                        <p className="text-sm text-indigo-600">Reading corpus, calculating demand index, readiness score, and market spread.</p>
                    </div>
                </div>
            )}

            {activeItem?.res && activeItem.demand > 0 && (
                <div className="space-y-6">
                    <DemandHeroCard
                        category={activeItem.cat}
                        demand={activeItem.demand}
                        readiness={activeItem.readiness}
                        spread={activeItem.spread}
                        trend={activeItem.trend}
                        trendLabel={activeItem.trendLabel}
                        corpusStats={corpusStats[activeItem.cat.id] || null}
                    />

                    <StrategicInsightsPanel
                        category={activeItem.cat}
                        result={activeItem.res}
                        insights={activeItem.res.demand_insights || localInsights[activeItem.cat.id] || null}
                        isGenerating={generatingInsights.has(activeItem.cat.id)}
                    />

                    <IntentDistributionCard result={activeItem.res} />

                    {sortedData.length > 1 && (
                        <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                            <div className="px-8 py-6 border-b border-slate-100 flex items-center gap-3">
                                <div className="p-2 bg-slate-100 rounded-xl"><BarChart3 className="w-5 h-5 text-slate-600" /></div>
                                <h2 className="text-lg font-black text-slate-900 tracking-tight">Category Comparison</h2>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left">
                                    <thead className="bg-slate-50/80">
                                        <tr className="border-b border-slate-200">
                                            <th className="p-4 pl-8 text-[10px] font-black text-slate-400 uppercase tracking-widest">Category</th>
                                            <th className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Demand</th>
                                            <th className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Readiness</th>
                                            <th className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Spread</th>
                                            <th className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Trend</th>
                                            <th className="p-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50">
                                        {sortedData.map(item => (
                                            <tr key={item.cat.id} className="hover:bg-slate-50 transition-colors">
                                                <td className="p-4 pl-8 text-sm font-bold text-slate-900">{toReactText(item.cat.category)}</td>
                                                <td className="p-4 text-right font-mono text-xs font-bold">{item.demand > 0 ? fmtMn(item.demand) : '-'}</td>
                                                <td className="p-4 text-right font-mono text-xs font-bold">{item.readiness > 0 ? `${item.readiness.toFixed(1)}/10` : '-'}</td>
                                                <td className="p-4 text-right font-mono text-xs font-bold">{item.spread > 0 ? `${item.spread.toFixed(1)}/10` : '-'}</td>
                                                <td className="p-4 text-center">
                                                    {item.demand > 0 ? (
                                                        <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-black ${item.trend > 2 ? 'bg-emerald-50 text-emerald-700' : item.trend < -2 ? 'bg-red-50 text-red-700' : 'bg-slate-50 text-slate-500'}`}>
                                                            {item.trend > 0 ? '+' : ''}{item.trend.toFixed(1)}%
                                                        </span>
                                                    ) : '-'}
                                                </td>
                                                <td className="p-4 text-right">
                                                    <div className="flex justify-end gap-2">
                                                        <button onClick={() => onRunDemand([item.cat.id])} className="p-2 text-slate-400 hover:text-indigo-600 rounded-lg transition-colors"><RefreshCw className="w-4 h-4" /></button>
                                                        <button onClick={() => handleDeepDive(item.cat.id)} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-[10px] font-bold uppercase hover:bg-indigo-700">Deep Dive</button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {activeItem && (
                        <div className="bg-gradient-to-r from-indigo-600 to-violet-600 rounded-3xl p-8 flex items-center justify-between">
                            <div>
                                <h3 className="text-xl font-black text-white mb-1">Ready for Deep Dive?</h3>
                                <p className="text-indigo-200 text-sm">Get granular consumer need analysis, signal mapping, and strategic playbooks.</p>
                            </div>
                            <button onClick={() => handleDeepDive(activeItem.cat.id)} className="px-6 py-3 bg-white text-indigo-700 rounded-xl text-sm font-black uppercase tracking-widest hover:bg-indigo-50 transition-all shadow-lg flex items-center gap-2">
                                Launch Deep Dive <ArrowRight className="w-4 h-4" />
                            </button>
                        </div>
                    )}
                </div>
            )}

            <BenchmarksModal isOpen={showBenchmarks} onClose={() => setShowBenchmarks(false)} />
        </div>
    );
};
