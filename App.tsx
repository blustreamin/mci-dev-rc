
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { StrategyView } from './StrategyView';
import { DemandSweepView } from './DemandSweepView';
import { ScopeDefinition } from './ScopeDefinition';
import { TaskExecutionModal } from './src/console/TaskExecutionModal';
import { AuditView } from './src/console/AuditView';
import { ImageLabView } from './src/console/ImageLabView';
import { WorkflowGear, FetchableData, PreSweepData, SweepResult, DeepDiveResult, AuditLogEntry, MasterJob, RunContext, ApiResponse } from './types';
import { CORE_CATEGORIES } from './constants';
import { runPreSweepIntelligence, runCategorySweep, runSingleDeepDive } from './geminiService';
import { loadState, saveState, clearState, setCachedResult } from './persistenceService';
import { JobRunner } from './src/services/jobRunner';
import { Target, BarChart3, Microscope, RotateCcw, LayoutDashboard, ShieldCheck, Image as ImageIcon } from 'lucide-react';

const App: React.FC = () => {
    const [isHydrating, setIsHydrating] = useState(true);
    const [activeGear, setActiveGear] = useState<string>('ONBOARDING');
    const [activeJobId, setActiveJobId] = useState<string | null>(null);
    const [showAudit, setShowAudit] = useState(false);

    const [onboardingSelection, setOnboardingSelection] = useState<Record<string, boolean>>({});
    const [scopeSelection, setScopeSelection] = useState<any>({});
    
    const [strategyResults, setStrategyResults] = useState<Record<string, FetchableData<PreSweepData>>>({});
    const [demandResults, setDemandResults] = useState<Record<string, FetchableData<SweepResult>>>({});
    const [deepDiveResults, setDeepDiveResults] = useState<Record<string, FetchableData<DeepDiveResult>>>({});

    useEffect(() => {
        const init = async () => {
            const loaded = await loadState();
            if (loaded?.appState) {
                const s = loaded.appState;
                setActiveGear(s.activeGear || 'ONBOARDING');
                setOnboardingSelection(s.onboardingSelection || {});
                setScopeSelection(s.scopeSelection || {});
                setStrategyResults(s.strategyResults || {});
                setDemandResults(s.demandResults || {});
                setDeepDiveResults(s.deepDiveResults || {});
            }
            setIsHydrating(false);
        };
        init();
    }, []);

    useEffect(() => {
        if (isHydrating) return;
        saveState({ activeGear, onboardingSelection, scopeSelection, strategyResults, demandResults, deepDiveResults, isHydrating });
    }, [activeGear, onboardingSelection, scopeSelection, strategyResults, demandResults, deepDiveResults, isHydrating]);

    // --- Task Runners ---

    const startJob = async (type: any, catId: string) => {
        const job = await JobRunner.createJob(type, catId, 'v1');
        setActiveJobId(job.jobId);
        return job;
    };

    const runStrategy = async () => {
        const cats = CORE_CATEGORIES.filter(c => onboardingSelection[c.id]);
        if (cats.length === 0) return;
        
        const cat = cats[0]; 
        const job = await startJob('BUILD_STRATEGY', cat.id);

        try {
            await JobRunner.runStep(job, 'Calling Model', async () => {
                const logFn = (l: AuditLogEntry) => JobRunner.updateJob(job, { logs: [...(job.logs||[]), l.message] });
                const res = await runPreSweepIntelligence(cat, 'India', logFn, new AbortController().signal);
                setStrategyResults(prev => ({...prev, [cat.id]: res}));
                if (res.data) await setCachedResult(`preSweep::${cat.id}`, res.data);
            });
            await JobRunner.updateJob(job, { status: 'COMPLETED', progress: 100, message: 'Done' });
        } catch (e) {
            console.error(e);
        }
    };

    const runDemand = async (ids: string[]) => {
        const cat = CORE_CATEGORIES.find(c => c.id === ids[0]);
        if (!cat) return;
        const job = await startJob('RUN_DEMAND', cat.id);

        try {
            await JobRunner.runStep(job, 'Calling Model', async () => {
                const logFn = (l: AuditLogEntry) => JobRunner.updateJob(job, { logs: [...(job.logs||[]), l.message], progress: 50 });
                const res = await runCategorySweep(cat, null, 'India', logFn, new AbortController().signal, undefined, { jobId: job.jobId, runId: 'v1', windowId: 'now', registryHash: '', keywordBaseHash: '', budget: {} as any });
                // FIX: Cast result to resolve local vs src/types mismatch in root App.tsx
                setDemandResults(prev => ({...prev, [cat.id]: res as FetchableData<SweepResult>}));
            });
            await JobRunner.updateJob(job, { status: 'COMPLETED', progress: 100, message: 'Done' });
            setTimeout(() => setActiveGear('DEMAND'), 500);
        } catch (e) {
            console.error(e);
        }
    };

    const runDeepDive = async (ids: string[]) => {
        const catId = ids[0];
        const job = await startJob('RUN_DEEP_DIVE', catId);
        const demandData = demandResults[catId]?.data;

        try {
            await JobRunner.runStep(job, 'Calling Model', async () => {
                const res = await runSingleDeepDive(catId, 'v1', demandData);
                // FIX: Cast result to resolve local vs src/types mismatch in root App.tsx
                setDeepDiveResults(prev => ({...prev, [catId]: res as unknown as FetchableData<DeepDiveResult>}));
            });
            await JobRunner.updateJob(job, { status: 'COMPLETED', progress: 100, message: 'Analysis Ready' });
            setTimeout(() => setActiveGear('DEEP_DIVE'), 500);
        } catch (e) {
            console.error(e);
        }
    };

    const handleReset = async () => {
        if (confirm("Reset everything?")) {
            await clearState();
            window.location.reload();
        }
    };

    if (isHydrating) return <div>Loading...</div>;
    if (showAudit) return <AuditView onBack={() => setShowAudit(false)} />;

    return (
        <div className="min-h-screen bg-slate-50/50 pb-20 font-sans text-slate-900">
            <TaskExecutionModal 
                jobId={activeJobId} 
                isOpen={!!activeJobId}
                onClose={() => setActiveJobId(null)}
                onCancel={() => setActiveJobId(null)}
                onMinimize={() => {}}
                onRestore={() => {}}
                job={null} 
            />
            
            <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
                <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-2"><div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-black text-sm">MC</div><span className="font-bold text-lg tracking-tight">Men's Care Intelligence <span className="ml-2 px-2 py-0.5 bg-indigo-100 text-indigo-700 text-[10px] rounded-full uppercase">V1 Stable</span></span></div>
                    <div className="flex items-center gap-4">
                        <button onClick={() => setShowAudit(!showAudit)} className="text-slate-500 hover:text-indigo-600 flex items-center gap-2 text-xs font-bold px-3 py-1.5 border rounded-lg">
                            <ShieldCheck className="w-4 h-4"/> Audit
                        </button>
                        <button onClick={handleReset} className="p-2 text-slate-400 hover:text-red-600 rounded-lg hover:bg-slate-50 transition-colors"><RotateCcw className="w-4 h-4" /></button>
                    </div>
                </div>
            </header>

            <main className="pt-8">
                {/* Navigation */}
                <div className="flex flex-wrap items-center justify-center gap-1 bg-white p-1 rounded-xl border border-slate-200 shadow-sm mb-6 w-fit mx-auto">
                    {[
                        { gear: 'ONBOARDING', icon: LayoutDashboard, label: 'Scope' },
                        { gear: 'STRATEGY', icon: Target, label: 'Strategy' },
                        { gear: 'DEMAND', icon: BarChart3, label: 'Demand' },
                        { gear: 'DEEP_DIVE', icon: Microscope, label: 'Deep Dive' },
                        { gear: 'IMAGE_LAB', icon: ImageIcon, label: 'Image Lab' },
                    ].map(({ gear, icon: Icon, label }) => (
                        <button key={gear} onClick={() => setActiveGear(gear)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${activeGear === gear ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`}>
                            <Icon className="w-4 h-4" /><span className="hidden md:inline">{label}</span>
                        </button>
                    ))}
                </div>

                <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                    {activeGear === 'ONBOARDING' && (
                        <ScopeDefinition 
                            onboardingSelection={onboardingSelection} 
                            setOnboardingSelection={setOnboardingSelection}
                            scopeSelection={scopeSelection}
                            setScopeSelection={setScopeSelection}
                            onProceed={() => setActiveGear('STRATEGY')}
                        />
                    )}
                    {activeGear === 'STRATEGY' && (
                        <StrategyView 
                            categories={[]} 
                            results={strategyResults} 
                            onRun={runStrategy} 
                            onRunDemand={runDemand} 
                            onboardingSelection={onboardingSelection} 
                            setOnboardingSelection={setOnboardingSelection} 
                            onUpdateResult={()=>{}} 
                        />
                    )}
                    {activeGear === 'DEMAND' && (
                        <DemandSweepView 
                            categories={CORE_CATEGORIES.filter(c => onboardingSelection[c.id])} 
                            results={demandResults} 
                            onRunDemand={runDemand} 
                            onRunDeepDive={runDeepDive} 
                        />
                    )}
                    {activeGear === 'DEEP_DIVE' && (
                        <div className="max-w-7xl mx-auto px-4">
                            {Object.entries(deepDiveResults).map(([id, r]) => {
                                // Fix: Explicitly cast r to FetchableData<DeepDiveResult> to resolve 'unknown' property access errors.
                                const res = r as FetchableData<DeepDiveResult>;
                                return res.status === 'Success' && res.data && (
                                    <div key={id} className="bg-white p-8 rounded-xl shadow-lg border border-slate-200 mb-8">
                                        <h2 className="text-2xl font-black text-slate-900 mb-4">{res.data.category} Deep Dive</h2>
                                        <pre className="text-xs bg-slate-50 p-4 rounded-lg overflow-auto max-h-96">{JSON.stringify(res.data, null, 2)}</pre>
                                    </div>
                                );
                            })}
                            {Object.keys(deepDiveResults).length === 0 && <div className="text-center text-slate-400 py-20">Run Demand First to Unlock Deep Dive</div>}
                        </div>
                    )}
                    {activeGear === 'IMAGE_LAB' && (
                        <ImageLabView />
                    )}
                </div>
            </main>
        </div>
    );
};

export default App;