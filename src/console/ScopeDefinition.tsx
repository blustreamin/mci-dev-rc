
import React, { useState, useEffect } from 'react';
import { Check, ArrowRight, ShieldCheck, X, Database, Info, Loader2, CloudOff } from 'lucide-react';
import { CORE_CATEGORIES } from '../constants';
import { RemoteBenchmarkStore } from '../services/remoteBenchmarkStore';
import { CertifiedBenchmarkV3 } from '../types';
import { BenchmarksModal } from '../components/BenchmarksModal';

interface ScopeDefinitionProps {
    onboardingSelection: Record<string, boolean>;
    setOnboardingSelection: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
    scopeSelection: Record<string, { subCategories: string[]; anchors: string[] }>;
    setScopeSelection: React.Dispatch<React.SetStateAction<Record<string, { subCategories: string[]; anchors: string[] }>>>;
    onProceed: () => void;
}

const formatBenchmarkDate = (isoString?: string) => {
    if (!isoString) return '';
    try {
        return new Date(isoString).toLocaleDateString('en-GB', {
            day: 'numeric', month: 'short', year: 'numeric'
        });
    } catch (e) {
        return isoString;
    }
};

export const ScopeDefinition: React.FC<ScopeDefinitionProps> = ({
    onboardingSelection,
    setOnboardingSelection,
    scopeSelection,
    setScopeSelection,
    onProceed
}) => {
    const [expandedScopeCard, setExpandedScopeCard] = useState<string | null>(null);
    const [showBenchmarkModal, setShowBenchmarkModal] = useState(false);
    
    const [liveBenchmark, setLiveBenchmark] = useState<CertifiedBenchmarkV3 | null>(null);
    const [loadingBenchmark, setLoadingBenchmark] = useState(true);
    const [loadStatus, setLoadStatus] = useState<string>('Remote: initializing...');

    useEffect(() => {
        const load = async () => {
            setLoadStatus("Checking Live Benchmark...");
            const status = RemoteBenchmarkStore.getConfigStatus();
            
            if (!status.isReady) {
                setLoadingBenchmark(false);
                setLoadStatus(""); 
                return;
            }

            try {
                const snap = await RemoteBenchmarkStore.fetchLatestSnapshot();
                setLiveBenchmark(snap); 
                if (snap) {
                    setLoadStatus(`Live Benchmark: ${formatBenchmarkDate(snap.certifiedAtISO)}`);
                } else {
                    setLoadStatus("Remote: No snapshot");
                }
            } catch (e: any) {
                console.error("Failed to load remote benchmark", e);
                setLoadStatus("Remote Error");
            } finally {
                setLoadingBenchmark(false);
            }
        };
        load();
    }, []);

    const toggleSelection = (catId: string) => {
        const isCurrentlySelected = onboardingSelection[catId] || false;
        const nextState = !isCurrentlySelected;

        setOnboardingSelection(prev => ({ ...prev, [catId]: nextState }));

        setScopeSelection(prev => {
            const newScope = { ...prev };
            if (nextState) {
                const cat = CORE_CATEGORIES.find(c => c.id === catId);
                if (cat) {
                    newScope[catId] = {
                        subCategories: cat.subCategories.map(sc => sc.name),
                        anchors: cat.subCategories.flatMap(sc => sc.anchors)
                    };
                }
            } else {
                delete newScope[catId];
            }
            return newScope;
        });
    };

    const toggleAnchor = (catId: string, anchor: string) => {
        const currentScope = scopeSelection[catId];
        if (!currentScope) return;
        const isActive = currentScope.anchors.includes(anchor);
        const newAnchors = isActive 
            ? currentScope.anchors.filter(a => a !== anchor)
            : [...currentScope.anchors, anchor];
        
        setScopeSelection(prev => ({
            ...prev,
            [catId]: { ...prev[catId], anchors: newAnchors }
        }));
    };

    const selectedCount = Object.values(onboardingSelection).filter(Boolean).length;

    return (
        <div className="max-w-7xl mx-auto px-4">
            <BenchmarksModal isOpen={showBenchmarkModal} onClose={() => setShowBenchmarkModal(false)} />
            
            <div className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
                <div>
                    <h1 className="text-3xl font-black text-[#0F172A] tracking-tight mb-2">Scope Definition</h1>
                    <p className="text-slate-500 text-lg leading-relaxed">Select categories and refine the analytical lens for Bharat.</p>
                    
                    <div className="mt-2 h-8 flex items-center">
                        {loadingBenchmark ? (
                            <span className="text-xs text-slate-400 flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin"/> {loadStatus}</span>
                        ) : liveBenchmark ? (
                            <button 
                                onClick={() => setShowBenchmarkModal(true)}
                                className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border w-fit cursor-pointer transition-colors shadow-sm bg-teal-50 text-teal-700 border-teal-100 hover:bg-teal-100"
                            >
                                <span className="relative flex h-2 w-2">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-teal-400"></span>
                                  <span className="relative inline-flex rounded-full h-2 w-2 bg-teal-500"></span>
                                </span>
                                <strong>{loadStatus}</strong>
                                <ShieldCheck className="w-3 h-3 ml-1 text-teal-500"/>
                            </button>
                        ) : null}
                    </div>
                </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
                {CORE_CATEGORIES.map(cat => {
                    const isSelected = onboardingSelection[cat.id] || false;
                    const scope = scopeSelection[cat.id];
                    
                    const benchData = liveBenchmark?.categories?.[cat.id] || liveBenchmark?.categories?.[cat.category];
                    
                    let demandValue: number | null = null;
                    if (benchData) {
                        if ((benchData as any).demandIndexMn?.median !== undefined) {
                            demandValue = (benchData as any).demandIndexMn.median;
                        } 
                        else if ((benchData as any).median?.demandIndexMn !== undefined) {
                            demandValue = (benchData as any).median.demandIndexMn;
                        }
                    }

                    return (
                        <div key={cat.id} className={`bg-white rounded-2xl border-2 transition-all duration-200 ${isSelected ? 'border-blue-600 shadow-xl shadow-blue-100' : 'border-slate-200 hover:border-slate-300'}`}>
                            <div className="p-5">
                                <div className="flex justify-between items-start mb-4">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-1">
                                            <button 
                                                onClick={() => toggleSelection(cat.id)}
                                                className={`w-5 h-5 rounded border flex items-center justify-center transition-colors flex-shrink-0 ${isSelected ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300 bg-white hover:border-slate-400'}`}
                                            >
                                                {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                                            </button>
                                            <h3 className="font-bold text-lg text-[#0F172A] leading-tight truncate">{cat.category}</h3>
                                        </div>
                                        <p className="text-sm text-slate-500 line-clamp-2 pl-7">{cat.consumerDescription}</p>
                                    </div>
                                    
                                    {typeof demandValue === 'number' && (
                                        <div className="ml-2 px-2 py-1 rounded text-xs font-black whitespace-nowrap border flex items-center gap-1 shadow-sm bg-teal-50 text-teal-700 border-teal-100">
                                            {demandValue.toFixed(1)}M
                                        </div>
                                    )}
                                </div>

                                {isSelected && scope && (
                                    <div className="pl-7 mt-4 border-t border-slate-100 pt-4">
                                        <div className="flex justify-between items-center mb-2">
                                            <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Scope Refinement</span>
                                            <button 
                                                onClick={() => setExpandedScopeCard(expandedScopeCard === cat.id ? null : cat.id)}
                                                className="text-xs text-blue-600 font-bold hover:text-blue-800"
                                            >
                                                {expandedScopeCard === cat.id ? 'Hide' : 'Expand'}
                                            </button>
                                        </div>
                                        <div className="flex flex-wrap gap-1.5">
                                            {scope.anchors.slice(0, 2).map((a, i) => (
                                                <span key={i} className="px-2 py-1 bg-slate-50 text-slate-600 text-[10px] font-bold border border-slate-100 rounded-full truncate max-w-[100px]">{a}</span>
                                            ))}
                                            {scope.anchors.length > 2 && (
                                                <span className="px-2 py-1 bg-slate-100 text-slate-500 text-[10px] font-bold rounded-full">+{scope.anchors.length - 2} more</span>
                                            )}
                                        </div>

                                        {expandedScopeCard === cat.id && (
                                            <div className="mt-4 space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
                                                {cat.subCategories.map(sub => (
                                                    <div key={sub.name}>
                                                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">{sub.name}</p>
                                                        <div className="flex flex-wrap gap-1.5">
                                                            {sub.anchors.map(anchor => {
                                                                const isActive = scope.anchors.includes(anchor);
                                                                return (
                                                                    <button
                                                                        key={anchor}
                                                                        onClick={() => toggleAnchor(cat.id, anchor)}
                                                                        className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all ${isActive ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'}`}
                                                                    >
                                                                        {anchor}
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="fixed bottom-0 left-0 right-0 p-4 bg-white/90 backdrop-blur-md border-t border-slate-200 flex justify-end items-center gap-4 z-40 shadow-[0_-4px_12px_rgba(0,0,0,0.05)]">
               <div className="text-sm text-slate-500 font-bold uppercase tracking-widest">
                   {selectedCount} Categories Selected
               </div>
               <button 
                   onClick={onProceed}
                   disabled={selectedCount === 0}
                   className="bg-blue-600 text-white px-8 py-3 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-lg hover:shadow-blue-200 transition-all active:scale-95"
               >
                   Proceed to Consumer Needs <ArrowRight className="w-4 h-4" />
               </button>
            </div>
        </div>
    );
};
