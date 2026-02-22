
import React, { useMemo } from 'react';
/* Added AlertCircle to the import list from lucide-react */
import { X, Play, Loader2, CheckCircle2, AlertTriangle, AlertCircle, Ban, Clock, ChevronRight, StopCircle } from 'lucide-react';
import { JobState } from '../types';

interface TaskPanelProps {
    isOpen: boolean;
    onClose: () => void;
    jobs: JobState[];
    onCancel: (jobId: string) => void;
    onFocus: (jobId: string) => void;
}

const STORAGE_THRESHOLD = 6;

const formatJobType = (type: string) => {
    if (type === 'BUILD_STRATEGY') return 'BUILD CONSUMER NEED ANALYSIS';
    return type.replace(/_/g, ' ');
};

const getProgressPercent = (p: number | { processed: number; total: number }): number => {
    if (typeof p === 'number') return p;
    if (p.total === 0) return 0;
    return Math.floor((p.processed / p.total) * 100);
}

export const TaskPanel: React.FC<TaskPanelProps> = ({ isOpen, onClose, jobs, onCancel, onFocus }) => {
    const hasStorageRisk = useMemo(() => {
        try {
            // Check current hydration state from local storage
            const raw = localStorage.getItem('mci_v1_state_v1');
            if (!raw) return false;
            const state = JSON.parse(raw);
            const demandResults = state?.appState?.demandResults || {};
            const categoriesWithResults = Object.keys(demandResults).length;
            return categoriesWithResults > STORAGE_THRESHOLD;
        } catch (e) {
            return false;
        }
    }, [jobs, isOpen]); // Recalculate on job changes or panel open

    if (!isOpen) return null;

    const runningJobs = jobs.filter(j => ['RUNNING', 'PENDING', 'INITIALIZING', 'CANCELLING'].includes(j.status));
    const historyJobs = jobs.filter(j => !['RUNNING', 'PENDING', 'INITIALIZING', 'CANCELLING'].includes(j.status));

    const renderJobRow = (job: JobState) => {
        const isRunning = ['RUNNING', 'PENDING'].includes(job.status);
        const isCancelling = job.status === 'CANCELLING';
        const progressPercent = getProgressPercent(job.progress);
        
        return (
            <div key={job.jobId} className="group flex items-center justify-between p-3 mb-2 bg-white border border-slate-200 rounded-xl hover:border-indigo-300 hover:shadow-sm transition-all">
                <div className="flex-1 min-w-0" onClick={() => onFocus(job.jobId)} role="button">
                    <div className="flex items-center gap-2 mb-1">
                        {isRunning && <Loader2 className="w-3 h-3 text-indigo-600 animate-spin" />}
                        {job.status === 'COMPLETED' && <CheckCircle2 className="w-3 h-3 text-emerald-600" />}
                        {/* Fixed: AlertCircle is now imported and usable */}
                        {job.status === 'FAILED' && <AlertCircle className="w-3 h-3 text-red-600" />}
                        {(job.status === 'CANCELLED' || isCancelling) && <Ban className="w-3 h-3 text-slate-400" />}
                        
                        <span className="text-xs font-bold text-slate-800 truncate">
                            {formatJobType(job.type)}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 rounded text-slate-500 font-mono">
                            {job.categoryId}
                        </span>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-slate-500">
                        <span className="truncate max-w-[150px]">{job.message}</span>
                        <span>{progressPercent}%</span>
                    </div>
                </div>
                
                <div className="flex items-center gap-1 pl-3 border-l border-slate-100">
                    {isRunning && !isCancelling && (
                        <button 
                            onClick={(e) => { e.stopPropagation(); onCancel(job.jobId); }}
                            className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                            title="Stop Task"
                        >
                            <StopCircle className="w-4 h-4 fill-current opacity-80" />
                        </button>
                    )}
                    <button 
                        onClick={() => onFocus(job.jobId)}
                        className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-50 rounded-lg transition-colors"
                    >
                        <ChevronRight className="w-4 h-4" />
                    </button>
                </div>
            </div>
        );
    };

    return (
        <div className="fixed inset-y-0 right-0 w-80 bg-slate-50 border-l border-slate-200 shadow-2xl z-[1000] flex flex-col animate-in slide-in-from-right duration-300">
            <div className="p-4 border-b border-slate-200 bg-white flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <div className="bg-slate-900 text-white p-1.5 rounded-lg">
                        <Clock className="w-4 h-4" />
                    </div>
                    <div>
                        <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Task Monitor</h3>
                        <p className="text-[10px] text-slate-500 font-medium">{runningJobs.length} Active Processes</p>
                    </div>
                </div>
                <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full text-slate-400 transition-colors">
                    <X className="w-4 h-4" />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                {/* Storage Warning Banner */}
                {hasStorageRisk && (
                    <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl flex gap-3 animate-in fade-in duration-300">
                        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                        <p className="text-[11px] font-bold text-amber-900 leading-relaxed">
                            Large runs may exceed browser storage limits. Consider exporting results.
                        </p>
                    </div>
                )}

                {runningJobs.length > 0 && (
                    <div className="mb-6">
                        <h4 className="text-[10px] font-black text-indigo-600 uppercase tracking-widest mb-3 flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" /> Active Tasks
                        </h4>
                        {runningJobs.map(renderJobRow)}
                    </div>
                )}

                {historyJobs.length > 0 && (
                    <div>
                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Recent History</h4>
                        {historyJobs.map(renderJobRow)}
                    </div>
                )}

                {jobs.length === 0 && (
                    <div className="text-center py-10 text-slate-400 text-xs">
                        No recent activity.
                    </div>
                )}
            </div>
        </div>
    );
};
