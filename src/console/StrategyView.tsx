
import React, { useState, useEffect, useRef } from 'react';
import { 
    Target, Play, ShieldCheck, Cloud, Loader2, Bug, CheckCircle2, 
    Calendar, ClipboardCheck, Cpu, Info, Check 
} from 'lucide-react';
import { CategoryBaseline, FetchableData, PreSweepData, CategorySnapshotDoc } from '../types';
import { CORE_CATEGORIES } from '../constants';
import { CategoryOutputCard } from '../components/CategoryOutputCard';
import { CategorySnapshotBuilder } from '../services/categorySnapshotBuilder';
import { OutputSnapshotStore } from '../services/outputSnapshotStore';
import { SnapshotResolver } from '../services/snapshotResolver';
import { RuntimeCache } from '../services/runtimeCache';
import { WindowingService } from '../services/windowing';
import { SeedStore } from '../services/seedStore';

interface StrategyViewProps {
    categories: CategoryBaseline[];
    results: Record<string, FetchableData<PreSweepData>>;
    onRun: (ids?: string[], snapshotId?: string) => void;
    onUpdateResult: (catId: string, newData: PreSweepData) => void;
    onRunDemand: (catIds: string[]) => void;
    onRunDeepDive?: (catIds: string[]) => void;
    onRunPlaybook?: (catIds: string[]) => void;
    onboardingSelection: Record<string, boolean>;
    setOnboardingSelection: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}

const SnapshotWidget: React.FC<{ category?: CategoryBaseline }> = ({ category }) => {
    const [snapshot, setSnapshot] = useState<CategorySnapshotDoc | null>(null);
    const [loading, setLoading] = useState(false);
    const [statusMsg, setStatusMsg] = useState('');
    const [debugMode, setDebugMode] = useState(false);

    const loadSnapshot = async () => {
        if (!category) return;
        setLoading(true);
        // Use Resolver to get active state for widget
        const res = await SnapshotResolver.resolveActiveSnapshot(category.id, "IN", "en");
        if (res.ok && res.snapshot) {
            setSnapshot(res.snapshot);
            console.log(`[SNAPSHOT_WIDGET] Resolved ${category.id}: ${res.snapshot.snapshot_id} (${res.snapshot.lifecycle})`);
        } else {
            // Only create draft if truly nothing exists — this should be rare for established categories
            console.log(`[SNAPSHOT_WIDGET] No snapshot resolved for ${category.id}. Creating draft...`);
            const draftRes = await CategorySnapshotBuilder.ensureDraft(category.id, "IN", "en");
            if (draftRes.ok) setSnapshot(draftRes.data);
            else setStatusMsg(`Error: ${(draftRes as any).error}`);
        }
        setLoading(false);
    };

    useEffect(() => {
        const fetch = async () => {
            if (category) loadSnapshot();
            else setSnapshot(null);
        };
        fetch();
        // Subscribe to global cache refresh
        return RuntimeCache.subscribe(fetch);
    }, [category]);

    const handleAction = async (action: 'hydrate' | 'validate' | 'certify') => {
        if (!snapshot || !category) return;
        
        // Guard: Don't hydrate or validate a certified snapshot
        if (action !== 'certify' && ['CERTIFIED', 'CERTIFIED_LITE', 'CERTIFIED_FULL'].includes(snapshot.lifecycle)) {
            setStatusMsg(`Cannot ${action} a ${snapshot.lifecycle} snapshot. Create a new draft first.`);
            return;
        }

        setLoading(true);
        setStatusMsg(`${action.toUpperCase()} running...`);
        
        let res: { ok: true; data?: any } | { ok: false; error: string };
        if (action === 'hydrate') res = await CategorySnapshotBuilder.hydrate(snapshot.snapshot_id, category.id, "IN", "en");
        else if (action === 'validate') res = await CategorySnapshotBuilder.validate(snapshot.snapshot_id, category.id, "IN", "en");
        else res = await CategorySnapshotBuilder.certify(snapshot.snapshot_id, category.id, "IN", "en");

        if (res.ok) {
            setStatusMsg(`${action} Success!`);
            await loadSnapshot(); // Reload to see new state
        } else {
            setStatusMsg(`Error: ${(res as any).error}`);
        }
        setLoading(false);
    };

    if (!category) return <div className="p-4 text-center text-slate-400 text-xs">Select category to manage snapshot</div>;

    if (!snapshot && loading) return <div className="p-4 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-indigo-500"/></div>;

    return (
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-4 relative">
            <button onClick={() => setDebugMode(!debugMode)} className="absolute top-2 right-2 p-1 text-slate-300 hover:text-slate-500">
                <Bug className="w-3 h-3"/>
            </button>

            <div className="flex justify-between items-center">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
                    <Cloud className="w-4 h-4 text-indigo-500"/> Snapshot: {snapshot?.lifecycle || 'UNKNOWN'}
                </h4>
                <div className="text-[10px] text-slate-400 font-mono">{snapshot?.snapshot_id}</div>
            </div>

            {snapshot && (
                <div className="grid grid-cols-4 gap-2 text-center text-[10px]">
                    <div className="bg-slate-50 p-2 rounded">
                        <div className="font-bold text-slate-700">{snapshot.stats.anchors_total}</div>
                        <div className="text-slate-400">Anchors</div>
                    </div>
                    <div className="bg-slate-50 p-2 rounded">
                        <div className="font-bold text-slate-700">{snapshot.stats.keywords_total}</div>
                        <div className="text-slate-400">Keywords</div>
                    </div>
                    <div className="bg-emerald-50 p-2 rounded">
                        <div className="font-bold text-emerald-700">{snapshot.stats.valid_total}</div>
                        <div className="text-emerald-400">Valid</div>
                    </div>
                    <div className="bg-amber-50 p-2 rounded">
                        <div className="font-bold text-amber-700">{snapshot.stats.zero_total}</div>
                        <div className="text-amber-400">Zero</div>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-3 gap-2">
                <button 
                    onClick={() => handleAction('hydrate')} 
                    disabled={loading || snapshot?.lifecycle === 'CERTIFIED'}
                    className="px-2 py-1.5 bg-blue-50 text-blue-700 text-[10px] font-bold rounded hover:bg-blue-100 disabled:opacity-50"
                >
                    Hydrate (300)
                </button>
                <button 
                    onClick={() => handleAction('validate')} 
                    disabled={loading || snapshot?.lifecycle === 'DRAFT' || snapshot?.lifecycle === 'CERTIFIED'}
                    className="px-2 py-1.5 bg-indigo-50 text-indigo-700 text-[10px] font-bold rounded hover:bg-indigo-100 disabled:opacity-50"
                >
                    Validate (DFS)
                </button>
                <button 
                    onClick={() => handleAction('certify')} 
                    disabled={loading || snapshot?.lifecycle !== 'VALIDATED'}
                    className="px-2 py-1.5 bg-emerald-50 text-emerald-700 text-[10px] font-bold rounded hover:bg-emerald-100 disabled:opacity-50"
                >
                    Certify
                </button>
            </div>
            
            {statusMsg && <div className="text-xs text-center text-slate-500 animate-pulse">{statusMsg}</div>}

            {debugMode && snapshot && (
                <div className="mt-4 p-2 bg-slate-900 text-green-400 text-[9px] font-mono rounded overflow-auto max-h-32">
                    <pre>{JSON.stringify(snapshot, null, 2)}</pre>
                </div>
            )}
        </div>
    );
};

export const StrategyView: React.FC<StrategyViewProps> = ({ 
    categories, results, onRun, onRunDemand, onRunDeepDive, onRunPlaybook, onboardingSelection, setOnboardingSelection, onUpdateResult 
}) => {
    const [expandedCat, setExpandedCat] = useState<string | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [genStatus, setGenStatus] = useState('');
    const [monthId, setMonthId] = useState(WindowingService.getCurrentMonthWindowId());
    const [csvAvailability, setCsvAvailability] = useState<Record<string, boolean>>({});
    
    // Use project categories if provided, otherwise fall back to CORE_CATEGORIES
    const availableCategories = categories.length > 0 ? categories : CORE_CATEGORIES;
    const selectedCategories = availableCategories.filter(c => onboardingSelection[c.id]);
    const activeCategory = selectedCategories.length > 0 ? selectedCategories[0] : undefined;
    const isProjectMode = categories.length > 0;

    // Load persisted output if available
    useEffect(() => {
        const loadOutputs = async () => {
            for (const cat of selectedCategories) {
                // If local state doesn't have it, check DB
                if (!results[cat.id]) {
                    const output = await OutputSnapshotStore.getLatestOutputSnapshot(cat.id);
                    if (output && output.strategy) {
                        onUpdateResult(cat.id, output.strategy);
                    }
                }
            }
        };
        loadOutputs();
    }, [selectedCategories, results]);

    useEffect(() => {
        const checkAvailability = async () => {
            const map: Record<string, boolean> = {};
            for (const cat of availableCategories) {
                const meta = await SeedStore.getSeedMeta(cat.id, monthId);
                map[cat.id] = meta?.status === 'PROCESSED';
            }
            setCsvAvailability(map);
        };
        checkAvailability();
    }, [monthId, availableCategories]);

    const toggleSelection = (catId: string) => {
        setOnboardingSelection(prev => ({ ...prev, [catId]: !prev[catId] }));
    };

    const handleRunStrategy = async () => {
        const traceId = `STRAT_GEN_${Date.now()}`;
        const ids = selectedCategories.map(c => c.id);
        
        console.log(`[STRATEGY_UI][CLICK] ${ids.length} isProjectMode=${isProjectMode}`);
        
        if (ids.length === 0) {
            alert("No categories selected.");
            return;
        }

        setIsGenerating(true);

        try {
            if (isProjectMode) {
                // PROJECT MODE: Skip snapshot resolution, run directly
                setGenStatus(`Generating for ${ids.length} categories...`);
                onRun(ids);
                
                setTimeout(() => {
                    setGenStatus('Outputs Queued');
                    setIsGenerating(false);
                }, 2000);
            } else {
                // LEGACY MODE: Resolve snapshots first (original behaviour)
                setGenStatus('Resolving snapshots...');
                const validIds: string[] = [];
                
                for (const cat of selectedCategories) {
                    console.log(`[STRATEGY_UI][CAT_START] ${cat.id}`);
                    const resolution = await SnapshotResolver.resolveActiveSnapshot(cat.id, 'IN', 'en');
                    
                    if (!resolution.ok) {
                        console.error(`[STRATEGY_UI] Snapshot Missing for ${cat.id}`);
                        continue; 
                    }
                    
                    validIds.push(cat.id);
                    console.log(`[STRATEGY_UI][CAT_DONE] ${cat.id}`);
                }

                if (validIds.length === 0) {
                    alert("No valid snapshots found. Please Hydrate & Validate in Integrity Console.");
                    setIsGenerating(false);
                    return;
                }

                setGenStatus(`Generating for ${validIds.length} categories...`);
                onRun(validIds); 
                
                setTimeout(() => {
                    setGenStatus('Outputs Queued');
                    setIsGenerating(false);
                }, 2000);
            }

        } catch (e: any) {
             console.error("[STRATEGY_UI][ERR] generate_output_failed", { traceId, error: e.message });
             setGenStatus('Generation Failed');
             setIsGenerating(false);
        }
    };

    return (
        <div className="max-w-7xl mx-auto px-4 pb-20">
            {/* Header */}
            <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4 pt-2">
                <div>
                    <h1 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-3">
                        <Target className="w-6 h-6 text-indigo-600"/> Consumer Need Intelligence
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">
                        {isProjectMode 
                            ? `${selectedCategories.length} ${selectedCategories.length === 1 ? 'category' : 'categories'} · AI-powered consumer need extraction`
                            : 'Select categories to analyze consumer needs'
                        }
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    {isProjectMode && (
                        <div className="flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-lg border border-slate-200">
                            <Calendar className="w-3.5 h-3.5 text-slate-400"/>
                            <input 
                                type="month" 
                                value={monthId} 
                                onChange={(e) => setMonthId(e.target.value)}
                                className="bg-transparent border-none text-xs font-bold text-slate-900 focus:ring-0 p-0 cursor-pointer"
                            />
                        </div>
                    )}
                    <button 
                        onClick={handleRunStrategy}
                        disabled={selectedCategories.length === 0 || isGenerating}
                        className="flex items-center gap-2 px-5 py-3 bg-indigo-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-indigo-700 disabled:opacity-50 shadow-sm transition-all"
                    >
                        {isGenerating ? <Loader2 className="w-4 h-4 animate-spin"/> : <Play className="w-4 h-4 fill-current"/>}
                        {isGenerating ? (genStatus || 'Generating...') : 'Generate Consumer Need Analysis'}
                    </button>
                </div>
            </div>

            {genStatus && isGenerating && (
                <div className="bg-slate-900 rounded-2xl px-5 py-4 mb-6 flex items-center gap-3">
                    <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                    <span className="text-xs font-bold text-white">{genStatus}</span>
                </div>
            )}

            <div className="space-y-6">
                {selectedCategories.length === 0 && (
                    <div className="text-center py-20 text-slate-300 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
                        <Target className="w-12 h-12 mx-auto mb-4 opacity-20"/>
                        <p className="text-lg font-bold text-slate-400">No categories selected for generation.</p>
                        <p className="text-sm text-slate-400 mt-1">Create a project to get started.</p>
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
                        onRunDeepDive={onRunDeepDive ? () => onRunDeepDive([cat.id]) : undefined}
                        onRunPlaybook={onRunPlaybook ? () => onRunPlaybook([cat.id]) : undefined}
                    />
                ))}
            </div>
        </div>
    );
};
