
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { StrategyView } from './console/StrategyView';
import { DemandSweepView } from './console/DemandSweepView';
import { ScopeDefinition } from './console/ScopeDefinition';
import { TaskExecutionModal } from './console/TaskExecutionModal';
import { AuditView } from './console/AuditView';
import { ImageLabView } from './console/ImageLabView';
import { DeepDiveView } from './console/DeepDiveView';
import { PlaybookView } from './console/PlaybookView';
import { SignalsView } from './console/SignalsView';
import { WorkflowGear, FetchableData, PreSweepData, SweepResult, DeepDiveResult, PlaybookResult, AuditLogEntry, JobState, TaskStage } from './types';
import { CORE_CATEGORIES, INTERNAL_VERSION_TAG, INTERNAL_VERSION_STATUS } from './constants';
import { runPreSweepIntelligence, runSingleDeepDive, runSinglePlaybook } from './services/geminiService';
import { loadState, saveState, clearState, setCachedResult } from './persistenceService';
import { JobRunner } from './services/jobRunner';
import { RunOrchestrator } from './services/runOrchestrator';
import { PlumbingProbe } from './services/plumbingProbe';
import { hardRefreshApp } from './services/hardRefresh';
import { FORCE_CERTIFY_MODE, BUILD_STAMP } from './constants/runtimeFlags';
import { Target, BarChart3, Microscope, RotateCcw, LayoutDashboard, ShieldCheck, Zap, Loader2, Sparkles, Play, List, AlertTriangle, Wifi } from 'lucide-react';
import { CategoryPipelineRunner } from './services/categoryPipelineRunner';
import { SystemHealthCheck } from './services/systemHealthCheck';
import { TaskPanel } from './components/TaskPanel';
import { TaskMonitorBar } from './components/TaskMonitorBar';
import { RunCenterModal } from './components/RunCenterModal';
import { startHeartbeat } from './services/heartbeat';
import { DemandRunner } from './services/demandRunner';
import { DemandOutputStore, DEMAND_OUTPUT_VERSION } from './services/demandOutputStore';
import { WindowingService } from './services/windowing';
import './dev/versionGuard';

const App: React.FC = () => {
    const [isHydrating, setIsHydrating] = useState(true);
    const [activeGear, setActiveGear] = useState<string>('ONBOARDING');
    const [activeJobId, setActiveJobId] = useState<string | null>(null);
    const [showAudit, setShowAudit] = useState(false);
    const [showTaskPanel, setShowTaskPanel] = useState(false);
    const [showRunCenter, setShowRunCenter] = useState(false);
    
    // Deep Dive Context Injection
    const [deepDiveContext, setDeepDiveContext] = useState<{ categoryId: string; monthKey: string } | undefined>(undefined);
    
    // Internal refresh trigger for UI updates on cache reset
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    
    const [allJobs, setAllJobs] = useState<JobState[]>([]);
    const abortControllers = useRef<Map<string, AbortController>>(new Map());

    const [onboardingSelection, setOnboardingSelection] = useState<Record<string, boolean>>({});
    const [scopeSelection, setScopeSelection] = useState<any>({});
    
    const [strategyResults, setStrategyResults] = useState<Record<string, FetchableData<PreSweepData>>>({});
    const [demandResults, setDemandResults] = useState<Record<string, FetchableData<SweepResult>>>({});
    const [deepDiveResults, setDeepDiveResults] = useState<Record<string, FetchableData<any>>>({});
    const [playbookResults, setPlaybookResults] = useState<Record<string, FetchableData<PlaybookResult>>>({});

    useEffect(() => {
        console.log(`[LKG_VERSION] tag=${INTERNAL_VERSION_TAG} status=${INTERNAL_VERSION_STATUS}`);
        const interval = setInterval(async () => {
            const jobs = await JobRunner.getRecentJobs();
            setAllJobs(jobs);
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    // NEW: Deterministic Initial Loader for Demand Data
    const loadInitialDemand = async () => {
        const month = WindowingService.getCurrentMonthWindowId();
        const promises = CORE_CATEGORIES.map(async (cat) => {
            const res = await DemandOutputStore.readDemandDoc({
                categoryId: cat.id,
                month: month,
                country: 'IN',
                language: 'en',
                runtimeTargetVersion: DEMAND_OUTPUT_VERSION
            });
            
            if (res.ok && res.data) {
                // Populate state with trusted DTO
                setDemandResults(prev => ({
                    ...prev,
                    [cat.id]: {
                        status: 'Success',
                        data: res.data!.result || res.data,
                        lastAttempt: res.data!.computedAt
                    }
                }));
            }
        });
        await Promise.all(promises);
    };

    useEffect(() => {
        const init = async () => {
            startHeartbeat(); // Start global heartbeat
            PlumbingProbe.install();
            const loaded = await loadState();
            if (loaded?.appState) {
                const s = loaded.appState;
                setActiveGear(s.activeGear || 'ONBOARDING');
                setOnboardingSelection(s.onboardingSelection || {});
                setScopeSelection(s.scopeSelection || {});
                setStrategyResults(s.strategyResults || {});
                setDeepDiveResults(s.deepDiveResults || {});
                setPlaybookResults(s.playbookResults || {});
                
                // Note: We deliberately overwrite demandResults from Firestore 
                // to ensure no stale local storage values persist.
                await loadInitialDemand();
            } else {
                await loadInitialDemand();
            }
            setIsHydrating(false);
            
            // Run Smoke Test
            console.log("[SMOKE_TEST] Running API Check...");
            try {
                const report = await PlumbingProbe.runDfsProxyHopProbe();
                console.log("[SMOKE_TEST] Result:", report);
                if (report.verdict === 'GO') {
                    console.info("%c[SMOKE_TEST] API CONNECTION SUCCESSFUL", "color:green; font-weight:bold");
                } else {
                    console.error("[SMOKE_TEST] API CONNECTION FAILED", report);
                }
            } catch (e) {
                console.error("[SMOKE_TEST] Exception:", e);
            }
        };
        init();
    }, []);

    useEffect(() => {
        if (isHydrating) return;
        saveState({ activeGear, onboardingSelection, scopeSelection, strategyResults, demandResults, deepDiveResults, playbookResults, isHydrating });
    }, [activeGear, onboardingSelection, scopeSelection, strategyResults, demandResults, deepDiveResults, playbookResults, isHydrating]);

    const handleReset = async () => {
        if (confirm("HARD RESET: This will wipe all local caches, storage, and reload the application. Continue?")) {
            await hardRefreshApp();
        }
    };

    // --- Task Runners ---

    const startJob = async (type: any, catId: string) => {
        const job = await JobRunner.createJob(type, catId, 'v1');
        setActiveJobId(job.jobId);
        return job;
    };

    const runStrategy = async (ids?: string[]) => {
        const targetIds = ids || CORE_CATEGORIES.filter(c => onboardingSelection[c.id]).map(c => c.id);
        
        if (targetIds.length === 0) {
            console.warn("No categories selected for Strategy Run");
            return;
        }

        for (const catId of targetIds) {
            const cat = CORE_CATEGORIES.find(c => c.id === catId);
            if (!cat) continue;

            const job = await startJob('BUILD_STRATEGY', cat.id);
            console.log(`[OK] CONSUMER_NEED Started. categoryId=${cat.id} month=India/en`);

            try {
                await JobRunner.runStep(job, 'Calling Model', async () => {
                    const logFn = (l: AuditLogEntry) => JobRunner.updateJob(job, { logs: [...(job.logs||[]), l.message] });
                    const res = await runPreSweepIntelligence(cat, 'India', logFn, new AbortController().signal);
                    
                    if (res.ok) {
                        const fetchable: FetchableData<PreSweepData> = {
                            status: 'Success',
                            data: res.data,
                            lastAttempt: new Date().toISOString()
                        };
                        setStrategyResults(prev => ({...prev, [cat.id]: fetchable}));
                        await setCachedResult(`preSweep::${cat.id}`, res.data);
                        console.log(`[OK] CONSUMER_NEED Completed. categoryId=${cat.id} stage=READY`);
                    } else {
                        const errorMsg = (res as any).error;
                        const fetchable: FetchableData<PreSweepData> = {
                            status: 'Failed',
                            error: { type: 'ExecutionError', message: errorMsg },
                            lastAttempt: new Date().toISOString()
                        };
                        setStrategyResults(prev => ({...prev, [cat.id]: fetchable}));
                        throw new Error(errorMsg);
                    }
                });
                await JobRunner.updateJob(job, { status: 'COMPLETED', progress: 100, message: 'Done' });
            } catch (e: any) {
                console.error(`[FAIL] CONSUMER_NEED Failed. categoryId=${cat.id}`, e);
                await JobRunner.updateJob(job, { status: 'FAILED', message: e.message });
            }
        }
    };

    const runDemand = async (ids: string[]): Promise<void> => {
        const cat = CORE_CATEGORIES.find(c => c.id === ids[0]);
        if (!cat) return;
        const month = WindowingService.getCurrentMonthWindowId();
        
        // 1. UI RESET: Clear previous state to prevent stale data display
        setDemandResults(prev => ({
            ...prev, 
            [cat.id]: { status: 'Running', lastAttempt: new Date().toISOString(), data: undefined } 
        }));

        const job = await startJob('RUN_DEMAND', cat.id);

        try {
            await JobRunner.runStep(job, 'Demand Engine', async () => {
                // 2. RUN: New Deterministic Runner
                const res = await DemandRunner.runDemand({
                    categoryId: cat.id,
                    month: month,
                    country: 'IN',
                    language: 'en',
                    force: true, // User initiated means re-run
                    jobId: job.jobId
                });
                
                if (res.ok) {
                    const fetchable: FetchableData<SweepResult> = {
                        status: 'Success',
                        // 3. BIND: Use DTO from Runner
                        data: res.data.result || res.data as any,
                        lastAttempt: res.computedAt
                    };
                    
                    console.log(`[DEMAND_UI][SET_RESULT] cat=${cat.id} month=${month} demand_index_mn=${res.demand_index_mn} source=${res.source} version=${res.metricsVersion}`);
                    setDemandResults(prev => ({...prev, [cat.id]: fetchable}));
                } else {
                    const errorMsg = res.error || "Unknown error";
                    const fetchable: FetchableData<SweepResult> = {
                        status: 'Failed',
                        error: { type: 'ExecutionError', message: errorMsg },
                        lastAttempt: new Date().toISOString()
                    };
                    setDemandResults(prev => ({...prev, [cat.id]: fetchable}));
                    throw new Error(errorMsg);
                }
            });
            await JobRunner.updateJob(job, { status: 'COMPLETED', progress: 100, message: 'Done' });
            setTimeout(() => setActiveGear('DEMAND'), 500);
        } catch (e) {
            console.error(e);
        }
    };

    const runDeepDive = async (ids: string[]) => {
        // NAVIGATE ONLY (V2 Logic)
        const catId = ids[0];
        const month = WindowingService.getCurrentMonthWindowId();
        console.log(`[DEEPDIVE_NAV_TARGET] route=DEEP_DIVE categoryId=${catId} month=${month}`);
        
        // Pass context and switch view
        setDeepDiveContext({ categoryId: catId, monthKey: month });
        setActiveGear('DEEP_DIVE');
        
        // Scroll top for UX
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    if (isHydrating) return <div className="h-screen flex items-center justify-center bg-[#F8FAFC]"><Loader2 className="w-8 h-8 animate-spin text-blue-600"/></div>;
    if (showAudit) return <AuditView onBack={() => setShowAudit(false)} />;

    const runningCount = allJobs.filter(j => ['RUNNING', 'PENDING'].includes(j.status)).length;

    return (
        <div className="min-h-screen bg-[#F8FAFC] pb-20 font-sans text-[#0F172A] overflow-x-hidden">
            <TaskExecutionModal 
                jobId={activeJobId} 
                isOpen={!!activeJobId}
                onClose={() => setActiveJobId(null)}
                onCancel={() => { if (activeJobId) {} }}
                onMinimize={() => setActiveJobId(null)}
                onRestore={() => {}}
                job={null} 
            />
            
            <TaskPanel 
                isOpen={showTaskPanel} 
                onClose={() => setShowTaskPanel(false)}
                jobs={allJobs}
                onCancel={(id) => {}}
                onFocus={(id) => { setActiveJobId(id); setShowTaskPanel(false); }}
            />

            <TaskMonitorBar 
                jobs={allJobs} 
                onClick={() => setShowTaskPanel(true)}
            />

            <RunCenterModal 
                isOpen={showRunCenter} 
                onClose={() => setShowRunCenter(false)}
                appSetters={{ 
                    setStrategyResults, 
                    setDemandResults, 
                    setDeepDiveResults, 
                    setPlaybookResults 
                }}
                results={{ 
                    strategy: strategyResults, 
                    demand: demandResults, 
                    deepDive: deepDiveResults, 
                    playbook: playbookResults 
                }}
                activeJobs={allJobs}
            />
            
            <header className="bg-[#0F172A] text-white border-b border-white/10 sticky top-0 z-40 shadow-xl">
                <div className="max-w-7xl mx-auto px-3 sm:px-4">
                    <div className="h-16 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                            <div className="w-10 h-10 brand-gradient rounded-xl flex-shrink-0 flex items-center justify-center text-white shadow-lg">
                                <Sparkles className="w-6 h-6 fill-current text-white/90" />
                            </div>
                            <div className="flex flex-col min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className="font-bold text-sm sm:text-lg tracking-tight truncate uppercase leading-none">Blustream</span>
                                    <span className="px-1.5 py-0.5 bg-white/10 border border-white/10 text-white/40 text-[8px] font-black rounded uppercase whitespace-nowrap">RC · Jan 2026</span>
                                </div>
                                <div className="flex items-center gap-2 mt-1">
                                    <span className="text-[10px] text-blue-400 font-black uppercase tracking-widest leading-none">Intelligence</span>
                                </div>
                            </div>
                        </div>
                        
                        <div className="flex items-center gap-1 sm:gap-3">
                            <button 
                                onClick={() => setShowRunCenter(true)}
                                className="hidden sm:flex bg-blue-600 text-white px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest hover:bg-blue-700 shadow-lg items-center gap-2 transition-all active:scale-95"
                            >
                                <Play className="w-3   h-3 fill-current"/> Run Center
                            </button>
                            
                            <button 
                                onClick={() => setShowTaskPanel(true)}
                                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[10px] sm:text-xs font-bold transition-all ${runningCount > 0 ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}
                            >
                                <List className="w-4 h-4"/> 
                                <span className="hidden xs:inline">Tasks</span>
                            </button>
                            
                            <button onClick={() => setShowAudit(!showAudit)} className="text-slate-400 hover:text-white flex items-center gap-2 text-[10px] sm:text-xs font-bold px-2.5 py-1.5 border border-white/20 rounded-lg">
                                <ShieldCheck className="w-4 h-4"/> <span className="hidden xs:inline">Integrity</span>
                            </button>
                            
                            <button onClick={handleReset} className="p-2 text-slate-500 hover:text-red-400 rounded-lg hover:bg-white/5 transition-colors">
                                <RotateCcw className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </div>
            </header>

            <main className="pt-6 sm:pt-8">
                <div className="px-4 mb-6">
                    <div className="max-w-7xl mx-auto flex items-center justify-start sm:justify-center overflow-x-auto custom-scrollbar no-scrollbar-mobile pb-2">
                        <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-slate-200 shadow-sm whitespace-nowrap">
                            {[
                                { gear: 'ONBOARDING', icon: LayoutDashboard, label: 'Scope' },
                                { gear: 'STRATEGY', icon: Target, label: 'Consumer Needs' },
                                { gear: 'DEMAND', icon: BarChart3, label: 'Demand' },
                                { gear: 'DEEP_DIVE', icon: Microscope, label: 'Deep Dive' },
                                { gear: 'PLAYBOOK', icon: Zap, label: 'Playbook' },
                                { gear: 'SIGNALS', icon: Wifi, label: 'Signals' },
                            ].map(({ gear, icon: Icon, label }) => (
                                <button 
                                    key={gear} 
                                    onClick={() => setActiveGear(gear)} 
                                    className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-bold transition-all ${activeGear === gear ? 'bg-[#0F172A] text-white shadow-lg' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`}
                                >
                                    <Icon className="w-3.5 h-3.5 sm:w-4 h-4" />
                                    <span>{label}</span>
                                </button>
                            ))}
                        </div>
                    </div>
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
                        <DeepDiveView initialContext={deepDiveContext} />
                    )}
                    {activeGear === 'PLAYBOOK' && (
                        <div className="max-w-7xl mx-auto px-4 pb-20">
                            {Object.entries(playbookResults).map(([id, r]) => {
                                const res = r as FetchableData<PlaybookResult>;
                                return res.status === 'Success' && res.data && (
                                    <PlaybookView key={id} data={res.data} status={res.status} />
                                );
                            })}
                        </div>
                    )}
                    {activeGear === 'IMAGE_LAB' && (
                        <ImageLabView />
                    )}
                    {activeGear === 'SIGNALS' && (
                        <SignalsView />
                    )}
                </div>
            </main>
        </div>
    );
};

export default App;
