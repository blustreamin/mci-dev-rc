
import React, { useState } from 'react';
import { Check, ArrowRight, LayoutGrid, ShieldCheck } from 'lucide-react';
import { CORE_CATEGORIES } from './constants';
import { CERTIFIED_BENCHMARK } from './certifiedBenchmark';
import { verifyV3Wiring } from './geminiService';

interface ScopeDefinitionProps {
    onboardingSelection: Record<string, boolean>;
    setOnboardingSelection: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
    scopeSelection: Record<string, { subCategories: string[]; anchors: string[] }>;
    setScopeSelection: React.Dispatch<React.SetStateAction<Record<string, { subCategories: string[]; anchors: string[] }>>>;
    onProceed: () => void;
}

export const ScopeDefinition: React.FC<ScopeDefinitionProps> = ({
    onboardingSelection,
    setOnboardingSelection,
    scopeSelection,
    setScopeSelection,
    onProceed
}) => {
    // UI-only state, does not need persistence
    const [expandedScopeCard, setExpandedScopeCard] = useState<string | null>(null);

    const toggleSelection = (catId: string) => {
        const isCurrentlySelected = onboardingSelection[catId] || false;
        const nextState = !isCurrentlySelected;

        // 1. Update Onboarding Selection
        setOnboardingSelection(prev => ({
            ...prev,
            [catId]: nextState
        }));

        // 2. Sync Scope Selection (Initialize on select, Clear on deselect)
        setScopeSelection(prev => {
            const newScope = { ...prev };
            if (nextState) {
                // Selected: Initialize with all subcats and anchors
                const cat = CORE_CATEGORIES.find(c => c.id === catId);
                if (cat) {
                    newScope[catId] = {
                        subCategories: cat.subCategories.map(sc => sc.name),
                        anchors: cat.subCategories.flatMap(sc => sc.anchors)
                    };
                }
            } else {
                // Deselected: Remove from scope
                delete newScope[catId];
            }
            return newScope;
        });
    };

    const toggleAnchor = (catId: string, anchor: string) => {
        const currentScope = scopeSelection[catId];
        if (!currentScope) return; // Should not happen if selected

        const isActive = currentScope.anchors.includes(anchor);
        const newAnchors = isActive 
            ? currentScope.anchors.filter(a => a !== anchor)
            : [...currentScope.anchors, anchor];
        
        setScopeSelection(prev => ({
            ...prev,
            [catId]: { ...prev[catId], anchors: newAnchors }
        }));
    };

    const runVerify = async () => {
        const logs = await verifyV3Wiring();
        console.log(logs.join('\n'));
        alert(logs.join('\n'));
    };

    const selectedCount = Object.values(onboardingSelection).filter(Boolean).length;

    return (
        <div className="max-w-7xl mx-auto px-4">
            <div className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
                <div>
                    <h1 className="text-3xl font-black text-slate-900 tracking-tight mb-2">Scope Definition</h1>
                    <p className="text-slate-500 text-lg">Select categories and refine the analysis scope for India.</p>
                    <div className="mt-2 flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-100 w-fit">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                        </span>
                        <strong>Live Source of Truth:</strong> 50× Certified Benchmark v3
                        <button onClick={runVerify} className="ml-2 text-emerald-500 hover:text-emerald-800" title="Verify v3 Wiring">
                            <ShieldCheck className="w-3 h-3"/>
                        </button>
                    </div>
                </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {CORE_CATEGORIES.map(cat => {
                    const isSelected = onboardingSelection[cat.id] || false;
                    const scope = scopeSelection[cat.id];
                    
                    // Use Certified Benchmark Data if available
                    const benchmark = CERTIFIED_BENCHMARK.categories[cat.category];
                    const demandValue = benchmark 
                        ? benchmark.median.demandIndexMn.toFixed(2) 
                        : cat.demandIndex;

                    return (
                        <div key={cat.id} className={`bg-white rounded-xl border-2 transition-all duration-200 ${isSelected ? 'border-indigo-600 shadow-xl shadow-indigo-100' : 'border-slate-200 hover:border-slate-300'}`}>
                            <div className="p-5">
                                <div className="flex justify-between items-start mb-4">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-1">
                                            <button 
                                                onClick={() => toggleSelection(cat.id)}
                                                className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${isSelected ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-300 bg-white hover:border-slate-400'}`}
                                            >
                                                {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                                            </button>
                                            <h3 className="font-bold text-lg text-slate-900 leading-tight">{cat.category}</h3>
                                        </div>
                                        <p className="text-sm text-slate-500 line-clamp-2 pl-7">{cat.consumerDescription}</p>
                                    </div>
                                    <div className="bg-slate-50 px-2 py-1 rounded text-xs font-bold text-slate-600 whitespace-nowrap border border-slate-100">
                                        {demandValue} Mn
                                    </div>
                                </div>

                                {isSelected && scope && (
                                    <div className="pl-7 mt-4 border-t border-slate-100 pt-4">
                                        <div className="flex justify-between items-center mb-2">
                                            <span className="text-xs font-bold uppercase text-slate-400">Analysis Scope</span>
                                            <button 
                                                onClick={() => setExpandedScopeCard(expandedScopeCard === cat.id ? null : cat.id)}
                                                className="text-xs text-indigo-600 font-bold hover:text-indigo-800"
                                            >
                                                {expandedScopeCard === cat.id ? 'Collapse' : 'Refine'}
                                            </button>
                                        </div>
                                        <div className="flex flex-wrap gap-1.5">
                                            {scope.anchors.slice(0, 3).map((a, i) => (
                                                <span key={i} className="px-2 py-1 bg-slate-100 text-slate-600 text-[10px] font-medium rounded-full truncate max-w-[120px]">{a}</span>
                                            ))}
                                            {scope.anchors.length > 3 && (
                                                <span className="px-2 py-1 bg-slate-50 text-slate-400 text-[10px] font-medium rounded-full">+{scope.anchors.length - 3}</span>
                                            )}
                                        </div>

                                        {expandedScopeCard === cat.id && (
                                            <div className="mt-4 space-y-3 animate-in fade-in slide-in-from-top-2">
                                                {cat.subCategories.map(sub => (
                                                    <div key={sub.name}>
                                                        <p className="text-xs font-bold text-slate-800 mb-1.5">{sub.name}</p>
                                                        <div className="flex flex-wrap gap-1.5">
                                                            {sub.anchors.map(anchor => {
                                                                const isActive = scope.anchors.includes(anchor);
                                                                return (
                                                                    <button
                                                                        key={anchor}
                                                                        onClick={() => toggleAnchor(cat.id, anchor)}
                                                                        className={`px-2.5 py-1 rounded-full text-[10px] font-medium border transition-colors ${isActive ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300'}`}
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

            <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-slate-200 flex justify-end items-center gap-4 z-40 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
               <div className="text-sm text-slate-500 font-medium">
                   {selectedCount} categories selected
               </div>
               <button 
                   onClick={onProceed}
                   disabled={selectedCount === 0}
                   className="bg-slate-900 text-white px-6 py-3 rounded-xl font-bold text-sm hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-lg hover:shadow-xl transition-all"
               >
                   Proceed to Strategy <ArrowRight className="w-4 h-4" />
               </button>
            </div>
        </div>
    );
};
