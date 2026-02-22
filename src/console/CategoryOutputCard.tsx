
import React from 'react';
import { 
    BrainCircuit, Play, Microscope, Zap, CheckCircle2, 
    ChevronDown, ChevronUp, AlertCircle, Loader2, TrendingUp,
    Target, Activity, ShieldAlert, Clock, HelpCircle, Layers
} from 'lucide-react';
import { CategoryBaseline, FetchableData, PreSweepData, AnalystSynthesisSection, AnalystPoint } from '../types';
import { safeText as safeTextUtil } from '../utils/safety';
import { toReactText } from '../utils/reactSafe';

// Crash-proof normalization helper
const normalizePreSweepData = (raw: any) => {
    const d = raw || {};
    const toArr = (v: any) => Array.isArray(v) ? v : [];
    const toStr = (v: any) => typeof v === 'string' ? v : '';

    return {
        summary: toStr(d.summary || d.executive_summary || (toArr(d.strategicNote)[0]) || ""),
        strategicNote: toArr(d.strategicNote),
        
        // Strict Analyst Structure
        strict_synthesis: d.strict_synthesis || {},

        // Anchor Intelligence
        anchor_intelligence: toArr(d.anchor_intelligence).length > 0 
            ? toArr(d.anchor_intelligence) 
            : toArr(d.intentMap).flatMap((im: any) => toArr(im?.anchors).map((a: any) => ({
                anchor_id: toStr(a?.anchor || "Unnamed Anchor"),
                summary: toStr(a?.consumer_problems?.[0] || ""),
                evidence: toArr(a?.evidence),
                keyword_count: 0
            }))),
            
        selected_keywords: toArr(d.selected_keywords),
    };
};

// Analyst Point Renderer extracted
const AnalystPointRow: React.FC<{ point: AnalystPoint, color: string }> = ({ point, color }) => {
    const impactColors: Record<string, string> = {
        HIGH: 'text-red-600 bg-red-50 border-red-100',
        MEDIUM: 'text-amber-600 bg-amber-50 border-amber-100',
        LOW: 'text-slate-500 bg-slate-50 border-slate-100'
    };

    return (
        <div className="group mb-3 last:mb-0">
            <div className="flex items-start gap-3">
                <div className={`w-5 h-5 rounded-full bg-white border border-${color}-200 text-${color}-600 flex items-center justify-center text-[10px] font-black shrink-0 mt-0.5 shadow-sm`}>
                    {toReactText(point.id)}
                </div>
                <div className="flex-1">
                    <p className="text-xs font-bold text-slate-800 leading-snug mb-1">
                        {toReactText(point.statement)}
                    </p>
                    <div className="flex flex-wrap gap-2 items-center">
                        {point.evidence && point.evidence.length > 0 && (
                            <div className="flex gap-1 items-center">
                                {point.evidence.slice(0, 3).map((e, i) => (
                                    <span key={i} className="text-[9px] px-1.5 py-0.5 bg-slate-50 border border-slate-100 rounded text-slate-500 font-medium truncate max-w-[100px]">
                                        {toReactText(e)}
                                    </span>
                                ))}
                            </div>
                        )}
                        <span className={`text-[8px] font-black px-1.5 py-0.5 rounded border uppercase ${impactColors[safeTextUtil(point.impact)] || impactColors.MEDIUM}`}>
                            {toReactText(point.impact)} Impact
                        </span>
                    </div>
                </div>
            </div>
            <div className={`h-px bg-${color}-50 my-3 ml-8 group-last:hidden`} />
        </div>
    );
};

interface CategoryOutputCardProps {
    category: CategoryBaseline;
    strategyResult?: FetchableData<PreSweepData>;
    isExpanded: boolean;
    onToggle: () => void;
    onRunDemand: () => void;
    onRunDeepDive?: () => void;
    onRunPlaybook?: () => void;
}

export const CategoryOutputCard: React.FC<CategoryOutputCardProps> = ({
    category,
    strategyResult,
    isExpanded,
    onToggle,
    onRunDemand,
    onRunDeepDive,
    onRunPlaybook
}) => {
    const rawData = strategyResult?.data;
    const isLoading = strategyResult?.status === 'Running';
    const isFailed = strategyResult?.status === 'Failed';
    const isSuccess = strategyResult?.status === 'Success' && rawData;

    const data = normalizePreSweepData(rawData);

    // Strict Synthesis Card (No Legacy Fallback)
    const SynthesisCard = ({ title, sectionData, icon: Icon, color }: { 
        title: string, 
        sectionData?: AnalystSynthesisSection, 
        icon: any, 
        color: string
    }) => {
        
        if (!sectionData || sectionData.meta.status !== 'OK' || !sectionData.points || sectionData.points.length === 0) {
            const reason = sectionData?.meta?.reason || "Analysis pending or blocked.";
            return (
                <div className="p-5 rounded-2xl border bg-slate-50 border-slate-200 h-full flex flex-col items-center justify-center text-center opacity-75">
                    <div className={`p-2 rounded-full bg-${color}-50 mb-2`}>
                        <Icon className={`w-4 h-4 text-${color}-400`} />
                    </div>
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">{toReactText(title)}</h4>
                    <div className="text-[10px] text-slate-400 italic max-w-[200px]">{toReactText(reason)}</div>
                </div>
            );
        }

        return (
            <div className={`p-5 rounded-2xl border transition-all h-full bg-white border-${color}-100 shadow-sm hover:border-${color}-300`}>
                <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-50">
                    <div className={`p-1.5 rounded-lg bg-${color}-50 text-${color}-600`}>
                        <Icon className="w-3.5 h-3.5" />
                    </div>
                    <h4 className={`text-[10px] font-black uppercase tracking-widest text-${color}-700`}>{toReactText(title)}</h4>
                    <span className="ml-auto bg-slate-50 px-1.5 py-0.5 rounded text-[8px] font-bold text-slate-400 border border-slate-100">
                        {sectionData.points.length} INSIGHTS
                    </span>
                </div>
                
                <div className="space-y-1">
                    {sectionData.points.map((point, i) => (
                        <AnalystPointRow key={i} point={point} color={color} />
                    ))}
                </div>
            </div>
        );
    };

    return (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden hover:shadow-md transition-all">
            <div 
                className="p-5 flex items-center justify-between cursor-pointer bg-slate-50/50 hover:bg-slate-50 transition-colors"
                onClick={onToggle}
            >
                <div className="flex items-center gap-4">
                    <div className={`p-2 rounded-lg ${isSuccess ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-200 text-slate-500'}`}>
                        <BrainCircuit className="w-5 h-5"/>
                    </div>
                    <div>
                        <h3 className="text-sm font-black text-slate-900">{toReactText(category.category)}</h3>
                        <div className="flex items-center gap-2 mt-1">
                            {isLoading && <span className="text-[10px] font-bold text-blue-600 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin"/> Generating Consumer Need Analysis...</span>}
                            {isFailed && <span className="text-[10px] font-bold text-red-600 flex items-center gap-1"><AlertCircle className="w-3 h-3"/> Consumer Need Analysis Failed</span>}
                            {isSuccess && <span className="text-[10px] font-bold text-emerald-600 flex items-center gap-1"><CheckCircle2 className="w-3 h-3"/> Consumer Need Analysis Ready</span>}
                            {!strategyResult && <span className="text-[10px] font-bold text-slate-400">Not Run</span>}
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    {isSuccess && (
                        <div className="flex gap-1 mr-4">
                            <button 
                                onClick={(e) => { e.stopPropagation(); onRunDemand(); }}
                                className="p-2 bg-white border border-slate-200 rounded-lg hover:border-emerald-300 hover:text-emerald-600 text-slate-400 shadow-sm transition-all"
                                title="Run Demand"
                            >
                                <Play className="w-4 h-4 fill-current"/>
                            </button>
                            {onRunDeepDive && (
                                <button 
                                    onClick={(e) => { e.stopPropagation(); onRunDeepDive(); }}
                                    className="p-2 bg-white border border-slate-200 rounded-lg hover:border-violet-300 hover:text-violet-600 text-slate-400 shadow-sm transition-all"
                                    title="Run Deep Dive"
                                >
                                    <Microscope className="w-4 h-4"/>
                                </button>
                            )}
                            {onRunPlaybook && (
                                <button 
                                    onClick={(e) => { e.stopPropagation(); onRunPlaybook(); }}
                                    className="p-2 bg-white border border-slate-200 rounded-lg hover:border-amber-300 hover:text-amber-600 text-slate-400 shadow-sm transition-all"
                                    title="Generate Playbook"
                                >
                                    <Zap className="w-4 h-4 fill-current"/>
                                </button>
                            )}
                        </div>
                    )}
                    {isExpanded ? <ChevronUp className="w-5 h-5 text-slate-400"/> : <ChevronDown className="w-5 h-5 text-slate-400"/>}
                </div>
            </div>

            {isExpanded && isSuccess && (
                <div className="p-6 border-t border-slate-100 bg-white animate-in slide-in-from-top-2">
                    {/* Intelligence Synthesis Layout */}
                    <div className="mb-10">
                        <div className="flex items-center gap-2 mb-6">
                            <Activity className="w-4 h-4 text-indigo-600" />
                            <h4 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">Consumer Need Intelligence</h4>
                            <div className="flex-1 h-px bg-slate-100" />
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            <SynthesisCard 
                                title="Consumer Problems" 
                                sectionData={data.strict_synthesis.CONSUMER_PROBLEMS}
                                icon={AlertCircle} 
                                color="red" 
                            />
                            <SynthesisCard 
                                title="Core Aspirations" 
                                sectionData={data.strict_synthesis.CORE_ASPIRATIONS}
                                icon={Target} 
                                color="emerald" 
                            />
                            <SynthesisCard 
                                title="Usage Routines" 
                                sectionData={data.strict_synthesis.USAGE_ROUTINES}
                                icon={Clock} 
                                color="blue" 
                            />
                            <SynthesisCard 
                                title="Search Triggers" 
                                sectionData={data.strict_synthesis.SEARCH_TRIGGERS}
                                icon={Zap} 
                                color="amber" 
                            />
                            <SynthesisCard 
                                title="Purchase Barriers" 
                                sectionData={data.strict_synthesis.PURCHASE_BARRIERS}
                                icon={ShieldAlert} 
                                color="rose" 
                            />
                            <SynthesisCard 
                                title="Emerging Trends" 
                                sectionData={data.strict_synthesis.EMERGING_TRENDS}
                                icon={TrendingUp} 
                                color="indigo" 
                            />
                        </div>

                        {/* Need Gaps Special Handling */}
                        <div className="mt-6">
                             <div className="grid grid-cols-1">
                                <SynthesisCard 
                                    title="Category Need Gaps" 
                                    sectionData={data.strict_synthesis.CATEGORY_NEED_GAPS}
                                    icon={HelpCircle} 
                                    color="orange" 
                                />
                             </div>
                        </div>
                    </div>

                    {/* Anchor Intelligence (Kept light for now) */}
                    <div className="mb-6">
                        <div className="flex items-center gap-2 mb-6">
                            <Layers className="w-4 h-4 text-indigo-600" />
                            <h4 className="text-xs font-black text-slate-400 uppercase tracking-[0.2em]">Consumer Intent Statements</h4>
                            <div className="flex-1 h-px bg-slate-100" />
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {data.anchor_intelligence.map((intel: any, i: number) => (
                                <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:border-indigo-100 transition-colors">
                                    <h5 className="font-black text-[10px] text-indigo-900 uppercase tracking-widest mb-3 pb-2 border-b border-slate-100 flex justify-between items-center">
                                        {toReactText(intel.anchor_id) || "Strategic Pillar"}
                                        <span className="text-[9px] text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded">{toReactText(intel.keyword_count)} KW</span>
                                    </h5>
                                    <div>
                                        <div className="text-[10px] text-slate-500 leading-relaxed mb-3">
                                            <p className="pl-2 border-l border-slate-100 mb-1">{toReactText(intel.summary)}</p>
                                        </div>
                                        <div className="flex flex-wrap gap-1">
                                            {(Array.isArray(intel.evidenceWithVolume) && intel.evidenceWithVolume.length > 0 
                                                ? intel.evidenceWithVolume 
                                                : (Array.isArray(intel.evidence) ? intel.evidence : []).map((kw: string) => ({ keyword: kw, volume: 0 }))
                                            ).slice(0, 12).map((item: any, k: number) => {
                                                const kw = typeof item === 'string' ? item : item.keyword;
                                                const vol = typeof item === 'string' ? 0 : (item.volume || 0);
                                                const volDisplay = vol >= 1000 ? `${(vol/1000).toFixed(vol >= 10000 ? 0 : 1)}K` : vol > 0 ? String(vol) : '';
                                                return (
                                                    <span key={k} className="px-1.5 py-0.5 bg-slate-50 text-slate-500 text-[9px] rounded border border-slate-100 inline-flex items-center gap-1">
                                                        {toReactText(kw)}
                                                        {volDisplay && <span className="text-indigo-500 font-bold">{volDisplay}</span>}
                                                    </span>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
