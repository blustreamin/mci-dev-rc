
import React from 'react';
import { Loader2, CheckCircle2, AlertCircle, List } from 'lucide-react';
import { JobState } from '../types';

interface TaskMonitorBarProps {
    jobs: JobState[];
    onClick: () => void;
}

const formatJobType = (type: string) => {
    if (type === 'BUILD_STRATEGY') return 'BUILD CONSUMER NEED ANALYSIS';
    return type.replace(/_/g, ' ');
};

export const TaskMonitorBar: React.FC<TaskMonitorBarProps> = ({ jobs, onClick }) => {
    const activeJobs = jobs.filter(j => ['RUNNING', 'PENDING', 'INITIALIZING'].includes(j.status));
    const recentJob = activeJobs[0] || jobs[0]; // Show latest active or just latest

    if (!recentJob && jobs.length === 0) return null;

    const isRunning = activeJobs.length > 0;
    const statusColor = isRunning ? 'bg-indigo-600' : recentJob?.status === 'FAILED' ? 'bg-red-600' : 'bg-slate-800';

    return (
        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-[900] animate-in slide-in-from-bottom-6 duration-500">
            <button 
                onClick={onClick}
                className={`flex items-center gap-4 pl-4 pr-6 py-3 rounded-full shadow-2xl text-white hover:scale-105 transition-all ${statusColor}`}
            >
                {isRunning ? (
                    <Loader2 className="w-5 h-5 animate-spin text-white/80" />
                ) : recentJob?.status === 'COMPLETED' ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                ) : recentJob?.status === 'FAILED' ? (
                    <AlertCircle className="w-5 h-5 text-white" />
                ) : (
                    <List className="w-5 h-5 text-slate-400" />
                )}

                <div className="flex flex-col items-start">
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-black uppercase tracking-widest">
                            {isRunning ? `${activeJobs.length} Active Task${activeJobs.length > 1 ? 's' : ''}` : 'Task Monitor'}
                        </span>
                        {!isRunning && <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />}
                    </div>
                    {recentJob && (
                        <div className="text-[10px] text-white/70 font-medium truncate max-w-[200px]">
                            {formatJobType(recentJob.type)}: {recentJob.currentStage || recentJob.status}
                        </div>
                    )}
                </div>
            </button>
        </div>
    );
};
