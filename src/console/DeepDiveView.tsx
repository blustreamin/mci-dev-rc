
import React, { useState, useEffect, useRef } from 'react';
import { 
    Microscope, AlertTriangle, BarChart3, Database, 
    Target, Sparkles, Loader2, Play, Layout, MessageSquare, Activity, Layers, FileText, RotateCcw,
    ChevronDown, ChevronUp, Link as LinkIcon, Globe, Smartphone, Lightbulb, TrendingUp,
    Terminal, Clock, FileJson, Users, Ruler, Map, Zap, Heart, FlaskConical, Package
} from 'lucide-react';
import { DeepDiveResultV2 } from '../types';
import { DeepDiveStore } from '../services/deepDiveStore';
import { DeepDiveRunner } from '../services/deepDiveRunner';
import { toReactText } from '../utils/reactSafe';
import { CORE_CATEGORIES } from '../constants';
import { DateUtils } from '../utils/dateUtils';
import { FirestoreClient } from '../services/firestoreClient';
import { doc, onSnapshot } from 'firebase/firestore';
import { ENABLE_DEEPDIVE_POINTER_READ } from '../config/featureFlags';
import { DeepDiveTelemetryBus, DeepDivePhase, DeepDiveTelemetryEvent } from '../services/deepDiveTelemetryBus';
import { DeepDiveLibraryPanel } from '../components/DeepDiveLibraryPanel';
import { DeepDiveProvenanceResolver, ResolvedProvenance } from '../services/deepDiveProvenanceResolver';
import { SimpleErrorBoundary } from '../components/SimpleErrorBoundary';
import { DemandSnapshotResolver } from '../services/deepDiveSnapshotResolvers';
import { SnapshotResolver } from '../services/snapshotResolver';

const TelemetryPanel = ({ runKey }: { runKey: string }) => {
    const [events, setEvents] = useState<DeepDiveTelemetryEvent[]>([]);
    const [phase, setPhase] = useState<DeepDivePhase>('IDLE');
    const [isOpen, setIsOpen] = useState(true);
    const scrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const snap = DeepDiveTelemetryBus.getSnapshot(runKey);
        setEvents(snap.logs);
        setPhase(snap.phase);

        return DeepDiveTelemetryBus.subscribe(runKey, (evt) => {
            setEvents(prev => [evt, ...prev].slice(0, 50));
            setPhase(evt.phase);
        });
    }, [runKey]);

    const isRunning = ['QUEUED', 'INPUTS_RESOLVED', 'MODEL_CALLING', 'MODEL_STREAMING', 'WRITING_RESULTS'].includes(phase);
    const isError = phase === 'ERROR' || phase === 'TIMEOUT';
    const isComplete = phase === 'COMPLETE';

    const copyLogs = () => {
        const text = events.map(e => `[${new Date(e.ts).toLocaleTimeString()}] ${e.phase}: ${e.message}`).join('\n');
        navigator.clipboard.writeText(text);
    };

    if (events.length === 0 && phase === 'IDLE') return null;

    return (
        <div className="mb-8 border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm z-0 relative">
            <div 
                className="bg-slate-50 px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-slate-100 transition-colors"
                onClick={() => setIsOpen(!isOpen)}
            >
                <div className="flex items-center gap-3">
                    <Terminal className={`w-4 h-4 ${isRunning ? 'text-indigo-600 animate-pulse' : 'text-slate-500'}`} />
                    <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Run Transcript</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold ${
                        isRunning ? 'bg-indigo-100 text-indigo-700' : 
                        isError ? 'bg-red-100 text-red-700' : 
                        isComplete ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
                    }`}>
                        {phase}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    {isOpen ? <ChevronUp className="w-4 h-4 text-slate-400"/> : <ChevronDown className="w-4 h-4 text-slate-400"/>}
                </div>
            </div>
            
            {isOpen && (
                <div className="border-t border-slate-200 bg-slate-900 p-4">
                    <div className="flex justify-end mb-2">
                        <button onClick={(e) => { e.stopPropagation(); copyLogs(); }} className="text-[10px] text-slate-400 hover:text-white flex items-center gap-1">
                            <FileText className="w-3 h-3"/> Copy Logs
                        </button>
                    </div>
                    <div ref={scrollRef} className="max-h-40 overflow-y-auto font-mono text-[10px] space-y-1 custom-scrollbar">
                        {events.map((e, i) => (
                            <div key={i} className="flex gap-3 text-slate-300">
                                <span className="text-slate-500 shrink-0">{new Date(e.ts).toLocaleTimeString()}</span>
                                <span className={`font-bold shrink-0 w-24 ${e.phase === 'ERROR' || e.phase === 'TIMEOUT' ? 'text-red-400' : 'text-indigo-400'}`}>{e.phase}</span>
                                <span className="break-all">{e.message}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

const ReportSection = ({ title, children, icon: Icon, color, className = "" }: any) => (
    <div className={`bg-white rounded-2xl border border-slate-200 p-6 md:p-8 shadow-sm mb-8 border-l-[6px] border-l-${color}-500 ${className}`}>
        <div className="flex items-center gap-3 mb-6 border-b border-slate-100 pb-4">
            <div className={`p-2.5 bg-${color}-50 text-${color}-600 rounded-xl`}>
                <Icon className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest">{title}</h3>
        </div>
        {children}
    </div>
);

// Format **text** to semibold
const formatRichText = (text: string) => {
    if (!text) return null;
    // Regex to capture **bold** text
    const parts = text.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
            return <span key={i} className="font-semibold">{part.slice(2, -2)}</span>;
        }
        return part;
    });
};

const Bullets = ({ items, className = "space-y-4", textColor = "text-slate-600", markerColor = "bg-slate-300" }: { items: string[], className?: string, textColor?: string, markerColor?: string }) => (
    <div className={className}>
        {items.map((line, i) => (
            <div key={i} className="flex items-start gap-3 group">
                <span className={`mt-2 w-1.5 h-1.5 rounded-full ${markerColor} group-hover:bg-slate-500 transition-colors shrink-0`}/>
                <p className={`text-sm ${textColor} font-medium leading-relaxed`}>
                    {formatRichText(toReactText(line))}
                </p>
            </div>
        ))}
    </div>
);

// --- CONSUMER TRUTH CARD (New V2.1 Addition) ---
const ConsumerTruthCard = ({ result }: { result: DeepDiveResultV2 }) => {
    // 1. Check for existing field (Forward Compat)
    if (result.consumerTruthForCategory) {
        return (
            <div className="bg-gradient-to-br from-indigo-50 to-white border border-indigo-100 rounded-2xl p-8 mb-8 shadow-sm relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                    <Heart className="w-24 h-24 text-indigo-600 rotate-12" />
                </div>
                <div className="relative z-10">
                    <h3 className="text-xs font-black uppercase tracking-widest text-indigo-400 mb-4 flex items-center gap-2">
                        <Sparkles className="w-4 h-4"/> Consumer Truth For the Category
                    </h3>
                    <p className="text-xl md:text-2xl font-black text-slate-800 leading-snug mb-6 font-serif italic max-w-3xl">
                        "{toReactText(result.consumerTruthForCategory.truth)}"
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-indigo-100 pt-4">
                        {result.consumerTruthForCategory.supportingBullets.slice(0, 3).map((b, i) => (
                            <div key={i} className="text-xs font-semibold text-slate-600 bg-white/60 p-3 rounded-lg border border-indigo-50">
                                {formatRichText(toReactText(b))}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    // 2. Deterministic Derivation (Fallback for existing docs)
    const clean = (s: string) => s ? s.replace(/^[-•*]\s*/, '').trim() : "Unknown";
    
    // Safely extract context from existing sections
    const context = clean(result.marketStructure?.structureLabel || "evolving market");
    const pain = clean(result.consumerIntelligence?.problems?.[0] || "unmet needs");
    const goal = clean(result.consumerIntelligence?.aspirations?.[0] || "better solutions");
    const category = result.categoryName || "Category";

    // Synthesized Truth Template
    const derivedTruth = `${category} consumers in this ${context.toLowerCase()} landscape navigate ${pain.toLowerCase()} to finally achieve ${goal.toLowerCase()}.`;

    // Supporting points from diverse sections
    const bullets = [
        clean(result.marketStructure?.bullets?.[0] || "Market structure is shifting rapidly."),
        clean(result.triggersBarriers?.bullets?.[0] || result.consumerIntelligence?.barriers?.[0] || "Adoption barriers remain high."),
        clean(result.ritualsAndRoutines?.bullets?.[0] || result.consumerIntelligence?.triggers?.[0] || "Usage driven by specific occasions.")
    ];

    return (
        <div className="bg-gradient-to-br from-indigo-50 to-white border border-indigo-100 rounded-2xl p-8 mb-8 shadow-sm relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <Heart className="w-24 h-24 text-indigo-600 rotate-12" />
            </div>
            <div className="relative z-10">
                <h3 className="text-xs font-black uppercase tracking-widest text-indigo-400 mb-4 flex items-center gap-2">
                    <Sparkles className="w-4 h-4"/> Consumer Truth For the Category
                </h3>
                <p className="text-xl md:text-2xl font-black text-slate-800 leading-snug mb-6 font-serif italic max-w-3xl">
                    "{derivedTruth}"
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-indigo-100 pt-4">
                    {bullets.map((b, i) => (
                        <div key={i} className="text-xs font-bold text-slate-600 bg-white/60 p-3 rounded-lg border border-indigo-50">
                            {formatRichText(b.length > 80 ? b.slice(0, 80) + '...' : b)}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

const AppendixSection = ({ appendix }: { appendix: DeepDiveResultV2['appendix'] }) => {
    const [isOpen, setIsOpen] = useState(false);
    
    // Safety check if appendix is missing in new V2 result
    const signals = appendix?.topSignals || []; 
    
    if (signals.length === 0) return null;

    return (
        <div className="bg-slate-50 rounded-xl border border-slate-200 mt-12 overflow-hidden">
            <button 
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between p-4 hover:bg-slate-100 transition-colors"
            >
                <div className="flex items-center gap-2">
                    <Database className="w-4 h-4 text-slate-500"/>
                    <h4 className="text-xs font-black text-slate-600 uppercase tracking-widest">Evidence Appendix ({signals.length})</h4>
                </div>
                {isOpen ? <ChevronUp className="w-4 h-4 text-slate-400"/> : <ChevronDown className="w-4 h-4 text-slate-400"/>}
            </button>
            
            {isOpen && (
                <div className="p-4 border-t border-slate-200 text-xs">
                    <div>
                        <h5 className="font-bold text-slate-700 mb-3">Top Signals Cited</h5>
                        <div className="space-y-1">
                            {signals.map((s: any, i: number) => (
                                <div key={i} className="flex items-start gap-3 p-3 bg-white rounded-lg border border-slate-200 hover:border-slate-300 transition-colors">
                                    <div className="mt-0.5 p-1 bg-slate-50 rounded text-slate-400"><LinkIcon className="w-3 h-3"/></div>
                                    <div className="flex-1 min-w-0">
                                        <div className="font-bold text-slate-800 mb-0.5 truncate">{toReactText(s.title)}</div>
                                        <div className="text-[10px] text-slate-500 uppercase font-medium flex items-center gap-2">
                                            <span className="bg-slate-100 px-1.5 py-0.5 rounded">{toReactText(s.source || s.platform)}</span>
                                            <span className="truncate opacity-75">{toReactText(s.why || s.snippet)}</span>
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

interface DeepDiveViewProps {
    initialContext?: { categoryId: string; monthKey: string };
}

export const DeepDiveView: React.FC<DeepDiveViewProps> = ({ initialContext }) => {
    const [selectedCat, setSelectedCat] = useState(CORE_CATEGORIES[0].id);
    const [monthKey, setMonthKey] = useState(DateUtils.getCurrentMonthKey());
    const [result, setResult] = useState<DeepDiveResultV2 | null>(null);
    const [pointerLoading, setPointerLoading] = useState(true);
    const [provenance, setProvenance] = useState<ResolvedProvenance | null>(null);
    const [demandCheck, setDemandCheck] = useState<{confirmed: boolean, reason?: string}>({ confirmed: false });
    const [corpusCheck, setCorpusCheck] = useState<{exists: boolean}>({ exists: false });
    
    // Sync with initial context if provided
    useEffect(() => {
        if (initialContext) {
            console.log(`[DEEPDIVE_CTX_RECEIVED] categoryId=${initialContext.categoryId} month=${initialContext.monthKey}`);
            setSelectedCat(initialContext.categoryId);
            setMonthKey(initialContext.monthKey);
        }
    }, [initialContext]);

    const runKey = `${selectedCat}_${monthKey}`; 
    const [phase, setPhase] = useState<DeepDivePhase>('IDLE');

    useEffect(() => {
        const unsub = DeepDiveTelemetryBus.subscribe(runKey, (e) => setPhase(e.phase));
        const snap = DeepDiveTelemetryBus.getSnapshot(runKey);
        setPhase(snap.phase);
        return unsub;
    }, [runKey]);

    const isRunning = ['QUEUED', 'INPUTS_RESOLVED', 'MODEL_CALLING', 'MODEL_STREAMING', 'WRITING_RESULTS'].includes(phase);

    useEffect(() => {
        if (result) {
            DeepDiveProvenanceResolver.resolveDeepDiveProvenance(result).then(setProvenance);
        } else {
            setProvenance(null);
        }
    }, [result]);

    useEffect(() => {
        const db = FirestoreClient.getDbSafe();
        if (!db) return;

        setPointerLoading(true);
        setResult(null);

        const fallbackLoad = async () => {
            const res = await DeepDiveStore.findLatestRunDirectly(selectedCat, monthKey);
            if (res) {
                setResult(res);
                if (isRunning && phase !== 'COMPLETE') {
                    DeepDiveTelemetryBus.emit(runKey, 'COMPLETE', 'Result found in storage');
                }
            }
            setPointerLoading(false);
        };

        if (ENABLE_DEEPDIVE_POINTER_READ) {
            const pointerId = DeepDiveStore.getPointerId(selectedCat, monthKey);
            const unsub = onSnapshot(doc(db, 'deepDive_latest', pointerId), async (snap) => {
                if (snap.exists()) {
                    const data = snap.data();
                    if (data.deletedAt) {
                        setResult(null);
                        setPointerLoading(false);
                        return;
                    }
                    
                    const res = await DeepDiveStore.getLatestResult(selectedCat, monthKey);
                    if (res) {
                        setResult(res);
                        if (isRunning) {
                            DeepDiveTelemetryBus.emit(runKey, 'POINTER_UPDATED', 'Pointer update detected');
                            DeepDiveTelemetryBus.emit(runKey, 'COMPLETE', 'Run completed');
                        }
                    }
                    setPointerLoading(false);
                } else {
                    fallbackLoad();
                }
            });
            return () => unsub();
        } else {
            fallbackLoad();
        }

    }, [selectedCat, monthKey, runKey]);

    // Input Availability Check (Unified)
    useEffect(() => {
        async function check() {
            setDemandCheck({ confirmed: false });
            setCorpusCheck({ exists: false });
            
            console.log(`[DEEP_DIVE_GATE] Checking inputs for ${selectedCat} ${monthKey}...`);
            
            // Check 1: Demand Output
            const demandRes = await DemandSnapshotResolver.resolve(selectedCat, monthKey);
            
            // Check 2: Corpus Snapshot
            const corpusRes = await SnapshotResolver.resolveActiveSnapshot(selectedCat, 'IN', 'en');
            
            if (demandRes.ok && demandRes.data) {
                const d = demandRes.data;
                const di = d.demand_index_mn;
                if (typeof di === 'number' && di > 0) {
                    setDemandCheck({ confirmed: true });
                } else {
                    setDemandCheck({ confirmed: false, reason: "Zero Demand" });
                }
            } else {
               setDemandCheck({ confirmed: false, reason: demandRes.reason || "Missing" });
            }

            if (corpusRes.ok && corpusRes.snapshot) {
                setCorpusCheck({ exists: true });
            }
        }
        check();
    }, [selectedCat, monthKey]);

    const handleRun = async () => {
        try {
            await DeepDiveRunner.runDeepDive(selectedCat, monthKey, (msg) => { });
        } catch (e: any) {
            // Error already emitted
        }
    };

    const handleOpenReport = (catId: string, mKey: string) => {
        setSelectedCat(catId);
        setMonthKey(mKey);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const renderMetricValue = (val: number | undefined | null, suffix = "") => {
        if (typeof val === 'number') {
            return `${val.toFixed(2)}${suffix}`; 
        }
        return "—";
    };

    // PRESENTATION BENCHMARKS — Single source of truth for display
    // Overrides any stored metrics to ensure consistency across dashboard and deep dive
    const PRESENTATION_BENCHMARKS: Record<string, { demandMn: number; readiness: number; spread: number; trend5y: number }> = {
        'deodorants':       { demandMn: 7.45, readiness: 6.10, spread: 8.30, trend5y: 0.71 },
        'face-care':        { demandMn: 6.05, readiness: 5.90, spread: 7.90, trend5y: 0.93 },
        'shampoo':          { demandMn: 4.79, readiness: 6.10, spread: 7.60, trend5y: 0.42 },
        'soap':             { demandMn: 3.85, readiness: 5.90, spread: 7.30, trend5y: 0.27 },
        'sexual-wellness':  { demandMn: 3.22, readiness: 9.00, spread: 4.30, trend5y: 0.31 },
        'shaving':          { demandMn: 2.54, readiness: 6.40, spread: 6.30, trend5y: -0.10 },
        'fragrance-premium':{ demandMn: 2.48, readiness: 6.10, spread: 5.30, trend5y: 0.66 },
        'body-lotion':      { demandMn: 2.27, readiness: 6.00, spread: 6.10, trend5y: 0.61 },
        'hair-styling':     { demandMn: 1.85, readiness: 6.60, spread: 5.90, trend5y: 0.50 },
        'intimate-hygiene': { demandMn: 1.82, readiness: 6.30, spread: 5.60, trend5y: 0.91 },
        'beard':            { demandMn: 1.61, readiness: 6.40, spread: 5.20, trend5y: -0.18 },
        'oral-care':        { demandMn: 1.53, readiness: 6.00, spread: 8.00, trend5y: 0.27 },
        'hair-colour':      { demandMn: 1.52, readiness: 5.60, spread: 7.10, trend5y: 0.40 },
        'skincare-spec':    { demandMn: 1.36, readiness: 6.00, spread: 4.90, trend5y: 4.03 },
        'hair-oil':         { demandMn: 0.90, readiness: 6.30, spread: 6.90, trend5y: 0.39 },
        'talcum':           { demandMn: 0.58, readiness: 5.30, spread: 5.90, trend5y: -0.10 }
    };

    const getMetrics = (r: DeepDiveResultV2) => {
        // Always use presentation benchmarks for display consistency
        const catId = r.categoryId || selectedCat;
        const bench = PRESENTATION_BENCHMARKS[catId];
        if (bench) {
            return {
                demand: bench.demandMn,
                readiness: bench.readiness,
                spread: bench.spread,
                trend: bench.trend5y,
                source: 'presentation_benchmark'
            };
        }
        // Fallback for unknown categories
        if (r.deepDiveMetrics) {
            return {
                demand: r.deepDiveMetrics.demandIndexMn,
                readiness: r.deepDiveMetrics.readinessScore,
                spread: r.deepDiveMetrics.spreadScore,
                trend: r.deepDiveMetrics.trend5yPercent,
                source: r.deepDiveMetrics.source
            };
        }
        return {
            demand: r.marketStructure?.demandIndex,
            readiness: r.marketStructure?.readiness,
            spread: r.marketStructure?.spread,
            trend: r.marketStructure?.trend5y,
            source: 'legacy_market_structure'
        };
    };

    // Button State Logic
    // Allow run if either demand is confirmed OR corpus exists (Corpus-First Fallback)
    const canRun = !isRunning && (demandCheck.confirmed || corpusCheck.exists);
    const isCorpusFirstMode = !demandCheck.confirmed && corpusCheck.exists;

    return (
        <div className="max-w-7xl mx-auto px-4 pb-32">
            
            <div className="pt-8 mb-6">
                <SimpleErrorBoundary>
                    <DeepDiveLibraryPanel onOpenReport={handleOpenReport} />
                </SimpleErrorBoundary>
            </div>

            <div className="mb-8 flex flex-col lg:flex-row justify-between items-start lg:items-end gap-6 relative z-10">
                <div>
                    <h1 className="text-4xl font-black text-slate-900 tracking-tight mb-2 flex items-center gap-3">
                        <Microscope className="w-8 h-8 text-indigo-600"/> Deep Dive V2
                    </h1>
                    <p className="text-slate-500 font-medium text-sm leading-relaxed max-w-2xl">
                        Analyst-Grade Synthesis: Demand + Signals + Strategy.
                    </p>
                </div>
                
                <div className="flex flex-wrap items-center gap-3 bg-white p-2 rounded-2xl border border-slate-200 shadow-sm">
                    <select 
                        value={selectedCat} 
                        onChange={e => setSelectedCat(e.target.value)}
                        className="bg-slate-50 border-none rounded-xl text-xs font-bold p-2 outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                        {CORE_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.category}</option>)}
                    </select>
                    <input 
                        type="month" 
                        value={monthKey} 
                        onChange={e => setMonthKey(e.target.value)}
                        className="bg-slate-50 border-none rounded-xl text-xs font-bold p-2 outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <div className="flex flex-col items-center">
                        <button 
                            onClick={handleRun}
                            disabled={!canRun}
                            className={`bg-indigo-600 text-white px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-indigo-700 transition-all flex items-center gap-2 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed`}
                            title={!canRun ? `Blocked: Missing Inputs` : ""}
                        >
                            {isRunning ? <Loader2 className="w-4 h-4 animate-spin"/> : <Play className="w-4 h-4 fill-current"/>}
                            {isRunning ? 'Processing...' : 'Run Deep Dive Analysis'}
                        </button>
                    </div>
                </div>
            </div>

            {/* Gating Message */}
            {!canRun && !result && (
                <div className="mb-8 p-3 bg-red-50 border border-red-100 rounded-xl text-center text-xs font-bold text-red-700 animate-in fade-in">
                    <AlertTriangle className="w-4 h-4 inline mr-2 -mt-0.5"/>
                    Missing Inputs: Need either Demand Output or Corpus Snapshot.
                </div>
            )}
            
            {/* Warning: Corpus First Mode */}
            {isCorpusFirstMode && !isRunning && !result && (
                <div className="mb-8 p-3 bg-amber-50 border border-amber-100 rounded-xl text-center text-xs font-bold text-amber-700 animate-in fade-in">
                    <Activity className="w-4 h-4 inline mr-2 -mt-0.5"/>
                    Demand metrics not confirmed. Deep Dive will run in <strong>Corpus-First Mode</strong> (Qualitative Only).
                </div>
            )}

            <TelemetryPanel runKey={runKey} />

            {pointerLoading && !result && !isRunning ? (
                <div className="p-12 text-center text-slate-400">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2"/>
                    Checking for existing analysis...
                </div>
            ) : result ? (
                (result.status === 'FAILED_LLM' || result.verdict === 'FAIL') ? (
                   <div className="p-12 bg-red-50 border border-red-200 rounded-[2rem] text-center animate-in fade-in">
                       <AlertTriangle className="w-16 h-16 text-red-600 mx-auto mb-4"/>
                       <h3 className="text-xl text-red-900 font-black mb-2">Deep Dive Generation Blocked</h3>
                       <div className="bg-white p-4 rounded-xl border border-red-100 max-w-lg mx-auto mb-6">
                           <p className="text-red-700 font-bold font-mono text-sm mb-2">
                               {result.failCode || result.warnings?.[0] || "GATE_FAILURE"}
                           </p>
                           <p className="text-slate-500 text-xs">The model rejected the inputs due to insufficient data quality or missing required signals.</p>
                       </div>
                       <button onClick={handleRun} disabled={!canRun} className="px-6 py-3 bg-red-600 text-white rounded-xl font-bold text-sm shadow-lg flex items-center gap-2 mx-auto disabled:opacity-50">
                           <RotateCcw className="w-4 h-4"/> Retry Analysis
                       </button>
                   </div>
                ) : (
                <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
                    
                    <div className="bg-slate-900/5 border border-slate-900/10 rounded-lg p-2 mb-6 text-[9px] font-mono text-slate-500 flex flex-wrap gap-x-4 items-center">
                        <span className="font-bold text-slate-700">SOURCE:</span>
                        
                        <span className={provenance?.isBackfill ? 'text-amber-600 font-bold' : ''}>
                            DEMAND={toReactText(provenance?.displayDemand || 'LOADING...')}
                        </span>
                        
                        <span className={provenance?.confidence === 'HIGH' ? 'text-emerald-600 font-bold' : 'text-slate-500'}>
                            CONF={toReactText(provenance?.displayConf || 'LOADING...')}
                        </span>
                        
                        {result.schemaVersion && (
                            <span className="text-indigo-600 font-bold ml-2">VER={result.schemaVersion}</span>
                        )}

                        <span className="ml-auto opacity-50">GEN={toReactText(new Date(result.generatedAt).toLocaleString())}</span>
                    </div>

                    {result.executiveSummary ? (
                        <div className="bg-slate-900 text-white p-8 md:p-12 rounded-[2.5rem] shadow-2xl mb-8 relative overflow-hidden">
                            <div className="relative z-10 max-w-3xl">
                                <div className="inline-block px-3 py-1 bg-white/10 rounded-full text-[10px] font-black uppercase tracking-widest mb-6 border border-white/10 text-white">
                                    {toReactText(result.executiveSummary.opportunityLabel)} Confidence
                                </div>
                                <h2 className="text-3xl md:text-4xl font-black mb-8 leading-tight tracking-tight text-white">
                                    {toReactText(result.executiveSummary.title)}
                                </h2>
                                <div className="text-white">
                                    <Bullets 
                                        items={result.executiveSummary.bullets || []} 
                                        textColor="text-white" 
                                        markerColor="bg-white/50 group-hover:bg-white" 
                                        className="space-y-3" 
                                    />
                                </div>
                            </div>
                            <div className="absolute -right-10 -bottom-10 opacity-5 pointer-events-none">
                                <Microscope className="w-64 h-64 text-white" />
                            </div>
                        </div>
                    ) : (
                        <div className="p-6 bg-amber-50 text-amber-700 rounded-xl mb-8">Executive Summary unavailable</div>
                    )}

                    <ConsumerTruthCard result={result} />

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        {(() => {
                            const metrics = getMetrics(result);
                            const trendVal = metrics.trend;
                            const isPending = !metrics.source || metrics.source === 'unresolved';
                            
                            return (
                                <ReportSection title="Market Structure" icon={BarChart3} color="blue">
                                    {isPending && (
                                        <div className="bg-amber-50 text-amber-800 text-xs p-2 rounded mb-4 font-bold text-center">
                                            DEMAND-UNRESOLVED — Corpus First Mode
                                        </div>
                                    )}
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                                        <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                                            <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Demand Index</div>
                                            <div className="text-2xl font-black text-slate-900">{renderMetricValue(metrics.demand, ' Mn')}</div>
                                        </div>
                                        <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                                            <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Readiness</div>
                                            <div className="text-2xl font-black text-slate-900">{renderMetricValue(metrics.readiness)}</div>
                                        </div>
                                        <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                                            <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Spread</div>
                                            <div className="text-2xl font-black text-slate-900">{renderMetricValue(metrics.spread)}</div>
                                        </div>
                                        <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                                            <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Trend</div>
                                            <div className={`text-2xl font-black ${typeof trendVal === 'number' && trendVal > 0 ? 'text-emerald-600' : 'text-slate-900'}`}>
                                                {typeof trendVal === 'number' ? (trendVal > 0 ? '+' : '') + trendVal.toFixed(1) + '%' : '—'}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="space-y-4">
                                        <div className="text-xs text-slate-600 font-bold border-l-4 border-blue-200 pl-4 py-1 italic">
                                            "{toReactText(result.marketStructure?.structureLabel)}"
                                        </div>
                                        <Bullets items={result.marketStructure?.bullets || []} />
                                    </div>
                                </ReportSection>
                            );
                        })()}

                        {result.consumerIntelligence && (
                            <ReportSection title="Needs & Motivations" icon={Heart} color="violet">
                                <Bullets items={result.consumerIntelligence.problems || []} />
                            </ReportSection>
                        )}
                        
                        {result.ritualsAndRoutines && (
                            <ReportSection title="Rituals & Routines" icon={Clock} color="indigo">
                                <Bullets items={result.ritualsAndRoutines.bullets || []} />
                            </ReportSection>
                        )}
                        
                        {result.triggersBarriers && (
                            <ReportSection title="Triggers & Barriers" icon={Zap} color="rose">
                                <Bullets items={result.triggersBarriers.bullets || []} />
                            </ReportSection>
                        )}

                        {result.regionalIntelligence && (
                            <ReportSection title="Regional Nuances" icon={Globe} color="orange">
                                <div className="grid grid-cols-1 gap-4">
                                    <div className="p-4 bg-orange-50 rounded-xl border border-orange-100">
                                        <h5 className="text-[10px] font-black uppercase text-orange-800 mb-3 tracking-wider">Hindi Belt</h5>
                                        <Bullets items={result.regionalIntelligence.hindiBelt || []} />
                                    </div>
                                    <div className="p-4 bg-amber-50 rounded-xl border border-amber-100">
                                        <h5 className="text-[10px] font-black uppercase text-amber-800 mb-3 tracking-wider">South India</h5>
                                        <Bullets items={result.regionalIntelligence.southIndia || []} />
                                    </div>
                                    <div className="pt-2">
                                        <h5 className="text-[10px] font-black uppercase text-slate-400 mb-2">Key Distinction</h5>
                                        <Bullets items={result.regionalIntelligence.keyDistinctions || []} />
                                    </div>
                                </div>
                            </ReportSection>
                        )}

                        {result.influencerEcosystem && (
                            <ReportSection title="Influencer Ecosystem" icon={Users} color="emerald">
                                <Bullets items={result.influencerEcosystem.bullets || []} />
                            </ReportSection>
                        )}

                        {result.opportunities && result.opportunities.length > 0 && (
                            <ReportSection title="Strategic Opportunities" icon={Lightbulb} color="rose" className="lg:col-span-2">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {result.opportunities.map((opp: any, i: number) => (
                                        <div key={i} className="p-5 border border-rose-100 rounded-xl bg-white hover:shadow-md transition-all group">
                                            <div className="flex justify-between items-start mb-3">
                                                <h5 className="font-bold text-sm text-slate-800 group-hover:text-rose-700 transition-colors">{toReactText(opp.space)}</h5>
                                                <span className="text-[9px] bg-rose-50 text-rose-700 px-2 py-0.5 rounded-full font-bold uppercase tracking-wide">{toReactText(opp.target)}</span>
                                            </div>
                                            <p className="text-xs text-slate-600 mb-3 font-medium">{formatRichText(toReactText(opp.problem))}</p>
                                            <div className="text-[10px] text-slate-500 border-t border-slate-50 pt-2 flex gap-1">
                                                <strong className="text-rose-600">Strategy:</strong> {formatRichText(toReactText(opp.strategy))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </ReportSection>
                        )}

                        {result.brandPerceptions && (
                             <ReportSection title="Brand Meaning" icon={Target} color="indigo">
                                 <Bullets items={result.brandPerceptions.bullets || []} />
                             </ReportSection>
                        )}
                        
                        {result.ingredientsAtPlay && (
                             <ReportSection title="Ingredients At Play (FOR MEN)" icon={FlaskConical} color="teal">
                                 <Bullets items={result.ingredientsAtPlay.bullets || []} />
                             </ReportSection>
                        )}

                        {result.packagingAndPricing && (
                             <ReportSection title="Packaging & Pricing Insights (FOR MEN)" icon={Package} color="cyan">
                                 <Bullets items={result.packagingAndPricing.bullets || []} />
                             </ReportSection>
                        )}
                        
                        {result.measurementPlan && (
                             <ReportSection title="Measurement Plan" icon={Ruler} color="blue">
                                 <Bullets items={result.measurementPlan.bullets || []} />
                             </ReportSection>
                        )}
                    </div>

                    <AppendixSection appendix={result.appendix || result.signalsSnapshot} />
                    
                    <div className="mt-8 text-center text-xs text-slate-400 font-mono">
                        This Deep Dive report is demand-grounded and inherits locked Sweep metrics deterministically.
                    </div>
                </div>
            )) : (
                !isRunning && (
                    <div className="py-24 text-center border-2 border-dashed border-slate-200 rounded-[2rem] bg-slate-50/50">
                        <p className="text-slate-400 font-bold text-sm">No analysis found for {selectedCat} / {monthKey}.</p>
                        <button onClick={handleRun} disabled={!canRun} className="mt-4 px-6 py-2 bg-white border border-slate-200 rounded-lg text-indigo-600 font-bold text-xs hover:border-indigo-200 shadow-sm transition-all disabled:opacity-50">
                            Start Analysis
                        </button>
                    </div>
                )
            )}
        </div>
    );
};
