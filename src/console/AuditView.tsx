
import React, { useState } from 'react';
import { 
    ArrowLeft, ShieldCheck, Database, Layers, HeartPulse, 
    BarChart3, Wrench, ShieldAlert, Wifi, BookOpen, Activity,
    Calendar, CheckCircle2, ChevronRight, LayoutGrid
} from 'lucide-react';
import { SimpleErrorBoundary } from '../components/SimpleErrorBoundary';
import { CORE_CATEGORIES } from '../constants';
import { DateUtils } from '../utils/dateUtils';

// Tabs
import { IntegrityConsolePanel } from './integrity/IntegrityConsolePanel'; // MOUNTED
import { SystemHealthTab } from './integrity/SystemHealthTab';
import CorpusInspectorView from './CorpusInspectorView';
import { DemandDiagnosticsTab } from './integrity/DemandDiagnosticsTab';
import { SignalsPlumbingTab } from './integrity/SignalsPlumbingTab';
import { DeepDiveLibraryTab } from './integrity/DeepDiveLibraryTab';
import { BenchmarksView } from './BenchmarksView';
import { SettingsTab } from './integrity/SettingsTab';
import { DangerZoneTab } from './integrity/DangerZoneTab';
import { BatchOperationsView } from './BatchOperationsView';

export const AuditView: React.FC<{ onBack: () => void }> = ({ onBack }) => {
    // Global State
    const [categoryId, setCategoryId] = useState(CORE_CATEGORIES[0].id);
    const [monthKey, setMonthKey] = useState(DateUtils.getCurrentMonthKey());
    const [activeTab, setActiveTab] = useState('CONSOLE'); // Default to Console

    const tabs = [
        { id: 'CONSOLE', label: 'Console', icon: LayoutGrid, color: 'text-indigo-500' },
        { id: 'HEALTH', label: 'System Health', icon: HeartPulse, color: 'text-emerald-500' },
        { id: 'CORPUS', label: 'Corpus Inspector', icon: Database, color: 'text-blue-500' },
        { id: 'DEMAND', label: 'Demand Diagnostics', icon: Activity, color: 'text-violet-500' },
        { id: 'SIGNALS', label: 'Signals Plumbing', icon: Wifi, color: 'text-sky-500' },
        { id: 'LIBRARY', label: 'Deep Dive Library', icon: BookOpen, color: 'text-indigo-500' },
        { id: 'BENCHMARKS', label: 'Benchmarks', icon: BarChart3, color: 'text-amber-500' },
        { id: 'BATCH', label: 'Batch Ops', icon: Layers, color: 'text-slate-500' },
        { id: 'SETTINGS', label: 'Settings', icon: Wrench, color: 'text-slate-500' },
        { id: 'DANGER', label: 'Danger Zone', icon: ShieldAlert, color: 'text-red-500' },
    ];

    const handleOpenReport = (catId: string, mKey: string) => {
        setCategoryId(catId);
        setMonthKey(mKey);
        setActiveTab('CONSOLE');
        // Navigate to Console tab where the user can run the Deep Dive Audit for this category/month
    };

    return (
        <div className="min-h-screen bg-slate-100 font-sans text-slate-900 flex flex-col">
            {/* 1. Global Header */}
            <header className="bg-slate-900 text-white shadow-lg z-30 sticky top-0">
                <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <button onClick={onBack} className="p-2 hover:bg-white/10 rounded-full transition-colors text-slate-400 hover:text-white">
                            <ArrowLeft className="w-5 h-5"/>
                        </button>
                        <div className="flex items-center gap-2.5">
                            <div className="p-1.5 bg-emerald-500/10 rounded-lg border border-emerald-500/50">
                                <ShieldCheck className="w-5 h-5 text-emerald-400"/>
                            </div>
                            <span className="font-black tracking-tight text-lg">Integrity Console</span>
                        </div>
                    </div>

                    {/* Global Context Selectors */}
                    <div className="flex items-center gap-3">
                        <div className="flex items-center bg-slate-800 rounded-lg p-1 border border-slate-700">
                            <LayoutGrid className="w-4 h-4 text-slate-400 ml-2 mr-2"/>
                            <select 
                                value={categoryId} 
                                onChange={e => setCategoryId(e.target.value)}
                                className="bg-transparent text-xs font-bold text-white border-none focus:ring-0 cursor-pointer py-1 pr-8"
                            >
                                {CORE_CATEGORIES.map(c => <option key={c.id} value={c.id} className="text-slate-900">{c.category}</option>)}
                            </select>
                        </div>
                        
                        <div className="flex items-center bg-slate-800 rounded-lg p-1 border border-slate-700">
                            <Calendar className="w-4 h-4 text-slate-400 ml-2 mr-2"/>
                            <input 
                                type="month" 
                                value={monthKey}
                                onChange={e => setMonthKey(e.target.value)}
                                className="bg-transparent text-xs font-bold text-white border-none focus:ring-0 cursor-pointer py-1 w-24"
                            />
                        </div>
                    </div>
                </div>
            </header>

            {/* 2. Navigation Tabs */}
            <div className="bg-white border-b border-slate-200 sticky top-16 z-20 shadow-sm">
                <div className="max-w-7xl mx-auto px-4">
                    <div className="flex gap-1 overflow-x-auto no-scrollbar py-2">
                        {tabs.map(tab => {
                            const isActive = activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`
                                        flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap
                                        ${isActive 
                                            ? 'bg-slate-100 text-slate-900 shadow-sm ring-1 ring-slate-200' 
                                            : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                                        }
                                    `}
                                >
                                    <tab.icon className={`w-4 h-4 ${isActive ? tab.color : 'text-slate-400'}`}/>
                                    {tab.label}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* 3. Main Content Area */}
            <main className="flex-1 max-w-7xl mx-auto w-full p-6">
                <SimpleErrorBoundary>
                    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                        {activeTab === 'CONSOLE' && <IntegrityConsolePanel categoryId={categoryId} monthKey={monthKey} />}
                        {activeTab === 'HEALTH' && <SystemHealthTab />}
                        {activeTab === 'CORPUS' && <CorpusInspectorView categoryId={categoryId} />}
                        {activeTab === 'DEMAND' && <DemandDiagnosticsTab categoryId={categoryId} monthKey={monthKey} />}
                        {activeTab === 'SIGNALS' && <SignalsPlumbingTab categoryId={categoryId} monthKey={monthKey} />}
                        {activeTab === 'LIBRARY' && <DeepDiveLibraryTab onOpenReport={handleOpenReport} />}
                        {activeTab === 'BENCHMARKS' && <BenchmarksView />}
                        {activeTab === 'BATCH' && <BatchOperationsView />}
                        {activeTab === 'SETTINGS' && <SettingsTab />}
                        {activeTab === 'DANGER' && <DangerZoneTab />}
                    </div>
                </SimpleErrorBoundary>
            </main>
        </div>
    );
};
