
import React, { useState, useMemo, useEffect } from 'react';
import { 
    Play, X, Check, Layers, Target, BarChart3, Microscope, Zap, 
    Settings, List, ArrowRight, CheckCircle2, AlertTriangle, Loader2, Clock
} from 'lucide-react';
import { CORE_CATEGORIES } from '../constants';
import { WorkflowGear, RunPlan, JobState, FetchableData } from '../types';
import { RunOrchestrator, AppSetters } from '../services/runOrchestrator';

interface RunCenterModalProps {
    isOpen: boolean;
    onClose: () => void;
    appSetters: AppSetters;
    results: {
        strategy: Record<string, FetchableData<any>>;
        demand: Record<string, FetchableData<any>>;
        deepDive: Record<string, FetchableData<any>>;
        playbook: Record<string, FetchableData<any>>;
    };
    activeJobs: JobState[];
}

const GEAR_JOB_MAP: Partial<Record<WorkflowGear, string>> = {
    [WorkflowGear.STRATEGY]: 'BUILD_STRATEGY',
    [WorkflowGear.DEMAND]: 'RUN_DEMAND',
    [WorkflowGear.DEEP_DIVE]: 'RUN_DEEP_DIVE',
    [WorkflowGear.PLAYBOOK]: 'GENERATE_PLAYBOOK'
};

const GEAR_CONFIG = [
    { id: WorkflowGear.STRATEGY, label: 'Consumer Needs', icon: Target, color: 'indigo' },
    { id: WorkflowGear.DEMAND, label: 'Demand', icon: BarChart3, color: 'emerald' },
    { id: WorkflowGear.DEEP_DIVE, label: 'Deep Dive', icon: Microscope, color: 'violet' },
    { id: WorkflowGear.PLAYBOOK, label: 'Playbook', icon: Zap, color: 'amber' },
];

export const RunCenterModal: React.FC<RunCenterModalProps> = ({ isOpen, onClose, appSetters, results, activeJobs }) => {
    const [selectedCats, setSelectedCats] = useState<string[]>([]);
    const [selectedGears, setSelectedGears] = useState<WorkflowGear[]>([]);
    const [mode, setMode] = useState<RunPlan['executionMode']>('SEQUENTIAL_BY_CATEGORY');
    
    // Auto-refresh jobs is handled by App.tsx passing updated activeJobs

    if (!isOpen) return null;

    const toggleCat = (id: string) => {
        setSelectedCats(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]);
    };

    const toggleAllCats = () => {
        if (selectedCats.length === CORE_CATEGORIES.length) setSelectedCats([]);
        else setSelectedCats(CORE_CATEGORIES.map(c => c.id));
    };

    const toggleGear = (g: WorkflowGear) => {
        setSelectedGears(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]);
    };

    // --- STATUS LOGIC ---
    const getRunStatus = (catId: string, gear: WorkflowGear) => {
        // 1. Active Job Priority
        const jobType = GEAR_JOB_MAP[gear];
        const activeJob = activeJobs.find(j => 
            j.categoryId === catId && 
            j.type === jobType && 
            ['PENDING', 'RUNNING', 'INITIALIZING'].includes(j.status)
        );
        if (activeJob) return { status: 'RUNNING', label: 'Running...', time: activeJob.startedAt };

        // 2. Persisted Result
        let result: FetchableData<any> | undefined;
        switch (gear) {
            case WorkflowGear.STRATEGY: result = results.strategy[catId]; break;
            case WorkflowGear.DEMAND: result = results.demand[catId]; break;
            case WorkflowGear.DEEP_DIVE: result = results.deepDive[catId]; break;
            case WorkflowGear.PLAYBOOK: result = results.playbook[catId]; break;
        }

        if (result?.status === 'Success') return { status: 'SUCCESS', label: 'Completed', time: result.lastAttempt };
        if (result?.status === 'Failed') return { status: 'FAILED', label: 'Failed', time: result.lastAttempt };
        if (result?.status === 'Running') return { status: 'RUNNING', label: 'Running...', time: result.lastAttempt }; // Legacy Check

        return { status: 'NOT_RUN', label: '', time: null };
    };

    const handleRun = () => {
        const plan = RunOrchestrator.createPlan(selectedCats, selectedGears, mode);
        RunOrchestrator.executePlan(plan, appSetters, () => {}).catch(err => console.error("Run failed", err));
        onClose();
    };

    // Determine Button Label based on Selection State
    const getRunButtonState = () => {
        if (selectedCats.length === 0 || selectedGears.length === 0) return { label: 'Select Scope', disabled: true };
        
        let hasRunning = false;
        let hasCompleted = false;

        for (const catId of selectedCats) {
            for (const gear of selectedGears) {
                const s = getRunStatus(catId, gear);
                if (s.status === 'RUNNING') hasRunning = true;
                if (s.status === 'SUCCESS') hasCompleted = true;
            }
        }

        if (hasRunning) return { label: 'Jobs Active', disabled: true };
        if (hasCompleted) return { label: 'Re-Run Selected', disabled: false };
        return { label: 'Launch Run Plan', disabled: false };
    };

    const btnState = getRunButtonState();

    return (
        <div className="fixed inset-0 z-[1002] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
            <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                
                {/* Header */}
                <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-indigo-600 text-white rounded-xl shadow-lg shadow-indigo-200">
                            <Play className="w-5 h-5 fill-current"/>
                        </div>
                        <div>
                            <h2 className="text-xl font-black text-slate-900 tracking-tight">Run Center</h2>
                            <p className="text-xs font-medium text-slate-500">Orchestrate multi-stage intelligence runs.</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full text-slate-400 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-0 flex flex-col md:flex-row">
                    
                    {/* Left: Category Matrix */}
                    <div className="flex-1 p-8 overflow-y-auto border-r border-slate-100">
                        <div className="flex justify-between items-center mb-6 sticky top-0 bg-white z-10 pb-2 border-b border-slate-100">
                            <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest flex items-center gap-2">
                                <List className="w-4 h-4 text-indigo-500"/> 1. Category Scope ({selectedCats.length})
                            </h3>
                            <button onClick={toggleAllCats} className="text-xs font-bold text-indigo-600 hover:text-indigo-800">
                                {selectedCats.length === CORE_CATEGORIES.length ? 'Deselect All' : 'Select All'}
                            </button>
                        </div>
                        
                        <div className="space-y-2">
                            {CORE_CATEGORIES.map(cat => {
                                const isSelected = selectedCats.includes(cat.id);
                                return (
                                    <div 
                                        key={cat.id}
                                        onClick={() => toggleCat(cat.id)}
                                        className={`group p-3 rounded-xl border transition-all cursor-pointer hover:shadow-md ${isSelected ? 'bg-indigo-50/50 border-indigo-200' : 'bg-white border-slate-200 hover:border-indigo-200'}`}
                                    >
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-3">
                                                <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${isSelected ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-300'}`}>
                                                    {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]"/>}
                                                </div>
                                                <span className={`text-sm font-bold ${isSelected ? 'text-indigo-900' : 'text-slate-700'}`}>{cat.category}</span>
                                            </div>
                                        </div>
                                        
                                        {/* Run Status Matrix Row */}
                                        <div className="flex gap-2 pl-8">
                                            {GEAR_CONFIG.map(gear => {
                                                const s = getRunStatus(cat.id, gear.id);
                                                if (s.status === 'NOT_RUN') return null;
                                                
                                                return (
                                                    <div key={gear.id} className="flex items-center gap-1.5 px-2 py-1 rounded bg-white border border-slate-100 shadow-sm" title={`Last run: ${s.time ? new Date(s.time).toLocaleString() : 'N/A'}`}>
                                                        <div className={`w-1.5 h-1.5 rounded-full ${
                                                            s.status === 'RUNNING' ? 'bg-blue-500 animate-pulse' :
                                                            s.status === 'SUCCESS' ? 'bg-emerald-500' :
                                                            'bg-red-500'
                                                        }`} />
                                                        <span className="text-[9px] font-bold text-slate-500 uppercase">{gear.label.substring(0,4)}</span>
                                                        {s.status === 'FAILED' && <AlertTriangle className="w-3 h-3 text-red-500"/>}
                                                        {s.status === 'RUNNING' && <Loader2 className="w-3 h-3 text-blue-500 animate-spin"/>}
                                                    </div>
                                                );
                                            })}
                                            {/* Empty State Spacer */}
                                            {!GEAR_CONFIG.some(g => getRunStatus(cat.id, g.id).status !== 'NOT_RUN') && (
                                                <span className="text-[10px] text-slate-400 italic pl-1">Not run yet</span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Right: Gears & Config */}
                    <div className="w-full md:w-80 bg-slate-50 p-8 flex flex-col gap-8 overflow-y-auto">
                        
                        {/* Gears */}
                        <section>
                            <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest mb-4 flex items-center gap-2">
                                <Layers className="w-4 h-4 text-indigo-500"/> 2. Workflow Gears
                            </h3>
                            <div className="space-y-3">
                                {GEAR_CONFIG.map(gear => (
                                    <button
                                        key={gear.id}
                                        onClick={() => toggleGear(gear.id)}
                                        className={`w-full p-4 rounded-xl border-2 transition-all flex items-center gap-4 text-left ${
                                            selectedGears.includes(gear.id)
                                                ? `border-${gear.color}-500 bg-white shadow-md ring-1 ring-${gear.color}-100`
                                                : 'border-slate-200 bg-slate-100 text-slate-400 hover:bg-white hover:border-slate-300'
                                        }`}
                                    >
                                        <div className={`p-2 rounded-lg ${selectedGears.includes(gear.id) ? `bg-${gear.color}-50 text-${gear.color}-600` : 'bg-slate-200 text-slate-400'}`}>
                                            <gear.icon className="w-5 h-5"/>
                                        </div>
                                        <div>
                                            <div className={`font-black text-xs uppercase tracking-wider ${selectedGears.includes(gear.id) ? 'text-slate-900' : 'text-slate-500'}`}>{gear.label}</div>
                                            {selectedGears.includes(gear.id) && <div className="text-[10px] text-slate-500 font-medium">Selected</div>}
                                        </div>
                                        {selectedGears.includes(gear.id) && <CheckCircle2 className={`w-5 h-5 ml-auto text-${gear.color}-500`}/>}
                                    </button>
                                ))}
                            </div>
                        </section>

                        {/* Mode */}
                        <section>
                            <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                <Settings className="w-4 h-4"/> Execution Mode
                            </h3>
                            <div className="flex flex-col gap-2">
                                <button 
                                    onClick={() => setMode('SEQUENTIAL_BY_CATEGORY')}
                                    className={`flex items-center gap-3 p-3 rounded-xl text-xs font-bold border transition-all ${mode === 'SEQUENTIAL_BY_CATEGORY' ? 'bg-white border-slate-300 text-slate-900 shadow-sm' : 'border-transparent text-slate-400 hover:bg-white/50'}`}
                                >
                                    <div className={`w-2 h-2 rounded-full ${mode === 'SEQUENTIAL_BY_CATEGORY' ? 'bg-indigo-500' : 'bg-slate-300'}`}/>
                                    Sequential by Category
                                </button>
                                <button 
                                    onClick={() => setMode('SEQUENTIAL_BY_GEAR')}
                                    className={`flex items-center gap-3 p-3 rounded-xl text-xs font-bold border transition-all ${mode === 'SEQUENTIAL_BY_GEAR' ? 'bg-white border-slate-300 text-slate-900 shadow-sm' : 'border-transparent text-slate-400 hover:bg-white/50'}`}
                                >
                                    <div className={`w-2 h-2 rounded-full ${mode === 'SEQUENTIAL_BY_GEAR' ? 'bg-indigo-500' : 'bg-slate-300'}`}/>
                                    Batch by Gear Phase
                                </button>
                            </div>
                        </section>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-slate-100 bg-white flex justify-end gap-4 items-center z-20">
                    <div className="text-xs font-medium text-slate-500 flex items-center mr-auto">
                        <span className="bg-slate-100 text-slate-900 px-2 py-1 rounded font-bold mr-2 border border-slate-200">{selectedCats.length * selectedGears.length}</span> Total Tasks Queued
                    </div>
                    <button onClick={onClose} className="px-6 py-3 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-50 transition-colors">
                        Cancel
                    </button>
                    <button 
                        onClick={handleRun}
                        disabled={btnState.disabled}
                        className={`px-8 py-3 rounded-xl text-xs font-black uppercase tracking-widest shadow-xl flex items-center gap-2 transition-all ${btnState.disabled ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-slate-900 text-white hover:bg-slate-800 hover:scale-105 active:scale-95'}`}
                    >
                        {btnState.disabled && btnState.label === 'Jobs Active' && <Loader2 className="w-4 h-4 animate-spin"/>}
                        {btnState.label} <ArrowRight className="w-4 h-4"/>
                    </button>
                </div>
            </div>
        </div>
    );
};
