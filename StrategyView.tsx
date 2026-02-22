
import React, { useState, useEffect } from 'react';
import { 
    ChevronDown, ChevronUp, Target, CheckCircle2, AlertCircle, X, 
    FileText, Layers, BrainCircuit, BarChart3, ShieldCheck, 
    Calendar, Play, Check, ClipboardCheck, Cpu, Database, Info
} from 'lucide-react';
import { CategoryBaseline, FetchableData, PreSweepData } from './types';
import { CORE_CATEGORIES } from './constants';
import { WindowingService } from './src/services/windowing';
import { SeedStore } from './src/services/seedStore';
import { CategoryOutputCard } from './src/components/CategoryOutputCard';

interface StrategyViewProps {
    categories: CategoryBaseline[];
    results: Record<string, FetchableData<PreSweepData>>;
    onRun: () => void;
    onUpdateResult: (catId: string, newData: PreSweepData) => void;
    onRunDemand: (catIds: string[]) => void;
    onboardingSelection: Record<string, boolean>;
    setOnboardingSelection: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}

export const StrategyView: React.FC<StrategyViewProps> = ({ 
    results, onRun, onRunDemand, onboardingSelection, setOnboardingSelection 
}) => {
    const [expandedCat, setExpandedCat] = useState<string | null>(null);
    const [monthId, setMonthId] = useState(WindowingService.getCurrentMonthWindowId());
    const [csvAvailability, setCsvAvailability] = useState<Record<string, boolean>>({});

    useEffect(() => {
        const checkAvailability = async () => {
            const map: Record<string, boolean> = {};
            for (const cat of CORE_CATEGORIES) {
                const meta = await SeedStore.getSeedMeta(cat.id, monthId);
                map[cat.id] = meta?.status === 'PROCESSED';
            }
            setCsvAvailability(map);
        };
        checkAvailability();
    }, [monthId]);

    const toggleSelection = (catId: string) => {
        setOnboardingSelection(prev => ({ ...prev, [catId]: !prev[catId] }));
    };

    const selectedCategories = CORE_CATEGORIES.filter(c => onboardingSelection[c.id]);

    return (
        <div className="max-w-7xl mx-auto px-4 pb-20">
            {/* Strategy Configuration Card */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-8 animate-in fade-in slide-in-from-top-4">
                <div className="flex flex-col lg:flex-row justify-between items-start gap-8 mb-8">
                    <div className="flex-1">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
                                <Target className="w-8 h-8 text-indigo-600"/> 
                                Strategy Configuration
                            </h2>
                            <div className="flex items-center gap-2 bg-slate-50 p-2 rounded-lg border border-slate-200">
                                <Calendar className="w-4 h-4 text-slate-400"/>
                                <span className="text-[10px] font-bold text-slate-500 uppercase">Target Month:</span>
                                <input 
                                    type="month" 
                                    value={monthId} 
                                    onChange={(e) => setMonthId(e.target.value)}
                                    className="bg-transparent border-none text-xs font-bold text-slate-900 focus:ring-0 p-0 cursor-pointer"
                                />
                            </div>
                        </div>
                        
                        <p className="text-slate-500 text-sm max-w-2xl leading-relaxed">
                            Establish the strategic foundation for demand analysis. The system will deconstruct selected categories into canonical intent anchors using Gemini 3 Pro reasoning.
                        </p>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
                            <div className="bg-slate-50 p-4 rounded-lg border border-slate-100">
                                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                                    <ClipboardCheck className="w-3.5 h-3.5 text-indigo-500"/> Generation Checklist
                                </h4>
                                <ul className="space-y-2">
                                    {['6–12 Intent Anchors per category', '45 keywords target per anchor', 'Deterministic intent tagging', 'Full consumer landscape mapping'].map((item, i) => (
                                        <li key={i} className="text-xs text-slate-600 flex items-center gap-2">
                                            <div className="w-1 h-1 rounded-full bg-indigo-400" /> {item}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                            <div className="bg-indigo-50/50 p-4 rounded-lg border border-indigo-100">
                                <h4 className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                                    <Cpu className="w-3.5 h-3.5"/> Pipeline Settings
                                </h4>
                                <div className="space-y-2">
                                    <div className="flex justify-between text-xs">
                                        <span className="text-slate-500">Model:</span>
                                        <span className="font-bold text-indigo-700">Gemini 3 Pro (Thinking)</span>
                                    </div>
                                    <div className="flex justify-between text-xs">
                                        <span className="text-slate-500">Logic:</span>
                                        <span className="font-bold text-indigo-700">V1 Stable Path</span>
                                    </div>
                                    <div className="flex justify-between text-xs">
                                        <span className="text-slate-500">Thinking:</span>
                                        <span className="font-bold text-indigo-700">32K Budget</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="shrink-0 w-full lg:w-auto">
                        <button 
                            onClick={onRun}
                            disabled={selectedCategories.length === 0}
                            className="w-full bg-indigo-600 text-white px-8 py-5 rounded-xl font-black text-sm hover:bg-indigo-700 shadow-xl shadow-indigo-100 flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:-translate-y-0.5 active:translate-y-0 uppercase tracking-widest"
                        >
                            <Play className="w-5 h-5 fill-current"/>
                            Generate Strategy ({selectedCategories.length})
                        </button>
                        <div className="mt-3 text-center text-[10px] text-slate-400 flex items-center justify-center gap-1.5 font-bold uppercase tracking-tighter">
                            <ShieldCheck className="w-3 h-3"/> Enterprise Privacy Enforced
                        </div>
                    </div>
                </div>

                <div className="space-y-3 pt-6 border-t border-slate-100">
                    <div className="flex items-center justify-between">
                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Targeted Category Scope</div>
                        <div className="text-[10px] text-slate-400 italic flex items-center gap-1">
                            <Info className="w-3 h-3"/> Click to toggle selection
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {CORE_CATEGORIES.map(cat => {
                            const isSelected = !!onboardingSelection[cat.id];
                            const hasCsv = csvAvailability[cat.id];
                            return (
                                <button
                                    key={cat.id}
                                    onClick={() => toggleSelection(cat.id)}
                                    className={`
                                        group relative px-4 py-2 rounded-full text-[11px] font-bold border transition-all flex items-center gap-2
                                        ${isSelected 
                                            ? 'bg-slate-900 text-white border-slate-900 shadow-lg shadow-slate-200' 
                                            : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                                        }
                                    `}
                                >
                                    {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]"/>}
                                    {cat.category}
                                    <span className={`
                                        ml-1 px-1.5 py-0.5 rounded-[4px] text-[8px] tracking-tight uppercase font-black
                                        ${isSelected 
                                            ? (hasCsv ? 'bg-emerald-500/30 text-emerald-100' : 'bg-amber-500/30 text-amber-100')
                                            : (hasCsv ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400')
                                        }
                                    `}>
                                        {hasCsv ? 'CSV' : 'LLM'}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Results Grid */}
            <div className="space-y-8">
                {selectedCategories.length === 0 && (
                    <div className="text-center py-20 text-slate-300 bg-slate-50 rounded-3xl border-4 border-dashed border-slate-200">
                        <Target className="w-16 h-16 mx-auto mb-4 opacity-20"/>
                        <p className="text-xl font-medium tracking-tight">No categories selected for generation.</p>
                    </div>
                )}

                {selectedCategories.map(cat => (
                    <CategoryOutputCard 
                        key={cat.id}
                        category={cat}
                        strategyResult={results[cat.id]}
                        isExpanded={expandedCat === cat.id}
                        onToggle={() => setExpandedCat(expandedCat === cat.id ? null : cat.id)}
                        onRunDemand={() => onRunDemand([cat.id])}
                    />
                ))}
            </div>
        </div>
    );
};
