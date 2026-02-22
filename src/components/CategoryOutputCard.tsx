import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
    BrainCircuit, Play, Microscope, Zap, CheckCircle2, 
    ChevronDown, ChevronUp, AlertCircle, Loader2, TrendingUp,
    Target, Activity, ShieldAlert, Clock, HelpCircle, Layers, Quote, List
} from 'lucide-react';
import { CategoryBaseline, FetchableData, PreSweepData, AnalystSynthesisSection, AnalystPoint } from '../types';
import { safeText as safeTextUtil } from '../utils/safety';
import { toReactText } from '../utils/reactSafe';
import { selectAnchorKeywordChips } from '../utils/anchorSemantics';
import { repairAnalystPoint, repairAnchorIntelligence } from '../utils/consumerNeedsRepair';

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

const ScoreBadge: React.FC<{ score: number }> = ({ score }) => {
    let color = 'bg-slate-100 text-slate-600 border-slate-200';
    if (score >= 4.5) color = 'bg-red-50 text-red-700 border-red-200'; // Critical
    else if (score >= 3.5) color = 'bg-amber-50 text-amber-700 border-amber-200'; // High
    else if (score >= 2.5) color = 'bg-blue-50 text-blue-700 border-blue-200'; // Medium
    
    return (
        <span className={`text-[10px] font-black px-2 py-0.5 rounded border uppercase ${color}`}>
            Score: {score}/5
        </span>
    );
};

// Analyst Point Renderer extracted
const AnalystPointRow: React.FC<{ point: AnalystPoint, color: string, keywordPool: any[], categoryId: string }> = ({ point, color, keywordPool, categoryId }) => {
    const [expanded, setExpanded] = useState(false); 

    // 1. Repair Logic (Stable)
    const safePoint = useMemo(() => repairAnalystPoint(point), [point]);
    
    // 2. Anchor Chips (Dynamic)
    const chips = useMemo(() => selectAnchorKeywordChips({
        anchorTitle: safePoint.statement,
        anchorContext: safePoint.context || "",
        keywordPool: keywordPool,
        categoryId: categoryId
    }), [safePoint.statement, keywordPool, categoryId]);

    const toggle = (e: React.MouseEvent) => {
        e.stopPropagation();
        const next = !expanded;
        setExpanded(next);
        if (next) console.log(`[CN_CARD_UI] expand insightId=${safePoint.id}`);
        else console.log(`[CN_CARD_UI] collapse insightId=${safePoint.id}`);
    };

    return (
        <div className="group mb-4 last:mb-0 bg-slate-50/50 p-3 rounded-xl border border-slate-100 hover:border-slate-200 hover:shadow-sm transition-all">
            <div className="flex items-start gap-3 cursor-pointer" onClick={toggle}>
                <div className={`w-6 h-6 rounded-lg bg-white border border-${color}-200 text-${color}-600 flex items-center justify-center text-[10px] font-black shrink-0 mt-0.5 shadow-sm`}>
                    {toReactText(safePoint.id)}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start gap-2">
                        <h5 className="text-sm font-bold text-slate-800 leading-snug">
                            {toReactText(safePoint.statement)}
                        </h5>
                        <div className="shrink-0">
                            {safePoint.score ? (
                                <ScoreBadge score={safePoint.score} />
                            ) : (
                                <span className="text-[9px] font-bold text-slate-400 bg-white px-1.5 py-0.5 rounded border border-slate-200">
                                    {toReactText(safePoint.impact || 'MEDIUM')}
                                </span>
                            )}
                        </div>
                    </div>
                    
                    {safePoint.context && (
                        <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                            {toReactText(safePoint.context)}
                        </p>
                    )}

                    <div className="flex items-center gap-2 mt-2">
                        {chips.length > 0 && (
                            <div className="flex gap-1 items-center overflow-hidden">
                                {chips.slice(0, 3).map((e, i) => (
                                    <span key={i} className="text-[9px] px-1.5 py-0.5 bg-white border border-slate-200 rounded text-slate-500 font-medium truncate max-w-[100px]">
                                        {toReactText(e)}
                                    </span>
                                ))}
                                {chips.length > 3 && <span className="text-[9px] text-slate-400">+{chips.length - 3}</span>}
                            </div>
                        )}
                        <span className="ml-auto text-slate-300">
                            {expanded ? <ChevronUp className="w-4 h-4"/> : <ChevronDown className="w-4 h-4"/>}
                        </span>
                    </div>
                </div>
            </div>

            {expanded && (
                <div className="mt-3 pl-9 space-y-3 animate-in fade-in slide-in-from-top-1 overflow-y-auto max-h-[60vh] custom-scrollbar">
                    
                    {/* Rationale */}
                    {safePoint.score_rationale && safePoint.score_rationale.length > 0 && (
                        <div className="bg-white p-3 rounded-lg border border-slate-100">
                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">
                                <Activity className="w-3 h-3"/> Why this score?
                            </div>
                            <ul className="list-disc pl-4 space-y-1">
                                {safePoint.score_rationale.map((r, i) => (
                                    <li key={i} className="text-xs text-slate-600">{toReactText(r)}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Consumer Statements */}
                    {safePoint.consumer_statements && safePoint.consumer_statements.length > 0 && (
                        <div className={`bg-${color}-50/30 p-3 rounded-lg border border-${color}-100`}>
                            <div className={`text-[10px] font-bold text-${color}-600 uppercase tracking-wider mb-2 flex items-center gap-1`}>
                                <Quote className="w-3 h-3"/> Consumer Voice
                            </div>
                            <div className="space-y-2">
                                {safePoint.consumer_statements.map((s, i) => (
                                    <div key={i} className="flex gap-2 text-xs">
                                        <span className={`text-${color}-400 font-serif text-lg leading-none`}>“</span>
                                        <div className="flex-1">
                                            <p className="text-slate-700 italic leading-relaxed text-wrap">{toReactText(s.statement)}</p>
                                            {(s.who || s.situation) && (
                                                <div className="text-[10px] text-slate-400 mt-0.5">
                                                    — {toReactText(s.who)} {s.situation ? `• ${toReactText(s.situation)}` : ''}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    
                    {/* Full Keyword Chips */}
                    {chips.length > 0 && (
                        <div className="pt-2 border-t border-slate-100">
                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-2">Signal Keywords</p>
                            <div className="flex flex-wrap gap-1.5">
                                {chips.map((kw, i) => (
                                    <span key={i} className="px-2 py-1 bg-slate-50 border border-slate-200 rounded text-[10px] font-medium text-slate-600">
                                        {kw}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

// Extracted SynthesisCard to prevent re-creation on every render (Fix for auto-collapse bug)
const SynthesisCard: React.FC<{ 
    title: string, 
    sectionData?: AnalystSynthesisSection, 
    icon: any, 
    color: string,
    keywordPool: any[], 
    categoryId: string
}> = ({ title, sectionData, icon: Icon, color, keywordPool, categoryId }) => {
    
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
                    <AnalystPointRow 
                        key={i} 
                        point={point} 
                        color={color} 
                        keywordPool={keywordPool} 
                        categoryId={categoryId} 
                    />
                ))}
            </div>
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
    const hasLogged = useRef(false);

    const data = normalizePreSweepData(rawData);

    // Verification Log
    useEffect(() => {
        if (isExpanded && isSuccess && data.anchor_intelligence?.length > 0) {
            if (!hasLogged.current) {
                console.log("[CONSUMER_INTENT_KEYWORDS] anchorScoped=true collisionsRemoved=true");
                hasLogged.current = true;
            }
        }
    }, [isExpanded, isSuccess, data.anchor_intelligence]);

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
                                keywordPool={data.selected_keywords}
                                categoryId={category.id}
                            />
                            <SynthesisCard 
                                title="Core Aspirations" 
                                sectionData={data.strict_synthesis.CORE_ASPIRATIONS}
                                icon={Target} 
                                color="emerald"
                                keywordPool={data.selected_keywords}
                                categoryId={category.id}
                            />
                            <SynthesisCard 
                                title="Usage Routines" 
                                sectionData={data.strict_synthesis.USAGE_ROUTINES}
                                icon={Clock} 
                                color="blue"
                                keywordPool={data.selected_keywords}
                                categoryId={category.id}
                            />
                            <SynthesisCard 
                                title="Search Triggers" 
                                sectionData={data.strict_synthesis.SEARCH_TRIGGERS}
                                icon={Zap} 
                                color="amber"
                                keywordPool={data.selected_keywords}
                                categoryId={category.id}
                            />
                            <SynthesisCard 
                                title="Purchase Barriers" 
                                sectionData={data.strict_synthesis.PURCHASE_BARRIERS}
                                icon={ShieldAlert} 
                                color="rose"
                                keywordPool={data.selected_keywords}
                                categoryId={category.id}
                            />
                            <SynthesisCard 
                                title="Emerging Trends" 
                                sectionData={data.strict_synthesis.EMERGING_TRENDS}
                                icon={TrendingUp} 
                                color="indigo"
                                keywordPool={data.selected_keywords}
                                categoryId={category.id}
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
                                    keywordPool={data.selected_keywords}
                                    categoryId={category.id}
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
                            {data.anchor_intelligence.map((intel: any, i: number) => {
                                // 1. Repair (Deterministic)
                                const safeIntel = repairAnchorIntelligence(intel);
                                
                                // 2. Chip Selection (Anchor-Specific)
                                const chips = selectAnchorKeywordChips({
                                    anchorTitle: toReactText(safeIntel.anchor_id),
                                    anchorContext: toReactText(safeIntel.context),
                                    keywordPool: data.selected_keywords,
                                    categoryId: category.id
                                });

                                return (
                                <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:border-indigo-100 transition-colors">
                                    <h5 className="font-black text-[10px] text-indigo-900 uppercase tracking-widest mb-3 pb-2 border-b border-slate-100 flex justify-between items-center">
                                        {toReactText(safeIntel.anchor_id) || "Strategic Pillar"}
                                        <span className="text-[9px] text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded">{toReactText(safeIntel.keyword_count)} KW</span>
                                    </h5>
                                    <div>
                                        <div className="text-[10px] text-slate-500 leading-relaxed mb-3">
                                            <p className="pl-2 border-l border-slate-100 mb-1">{toReactText(safeIntel.summary)}</p>
                                        </div>

                                        {/* NEW: Anchor Context */}
                                        {safeIntel.context && (
                                            <div className="mb-3">
                                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Anchor Context</p>
                                                <p className="text-xs text-slate-600 leading-relaxed">{toReactText(safeIntel.context)}</p>
                                            </div>
                                        )}
                                        
                                        {/* NEW: Why It Matters */}
                                        {safeIntel.whyItMatters && safeIntel.whyItMatters.length > 0 && (
                                            <div className="mb-3">
                                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Why it matters</p>
                                                <ul className="list-disc pl-3 space-y-1">
                                                    {safeIntel.whyItMatters.map((item: string, k: number) => (
                                                        <li key={k} className="text-xs text-slate-600">{toReactText(item)}</li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}

                                        {/* NEW: Example Statements */}
                                        {safeIntel.exampleStatements && safeIntel.exampleStatements.length > 0 && (
                                            <div className="mb-4 bg-slate-50 p-2 rounded-lg border border-slate-100">
                                                <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider mb-1">Consumer Voice</p>
                                                <div className="space-y-1">
                                                    {safeIntel.exampleStatements.map((stmt: string, k: number) => (
                                                        <p key={k} className="text-xs text-slate-500 italic">"{toReactText(stmt)}"</p>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        <div className="flex flex-wrap gap-1">
                                            {chips.map((kw: string, k: number) => (
                                                <span key={k} className="px-1.5 py-0.5 bg-slate-50 text-slate-500 text-[9px] rounded border border-slate-100">
                                                    {toReactText(kw)}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )})}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
