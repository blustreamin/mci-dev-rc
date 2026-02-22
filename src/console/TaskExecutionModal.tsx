
import React, { useEffect, useRef, useState } from 'react';
import { 
  Loader2, CheckCircle2, AlertCircle, Terminal, Clock, Cpu, 
  ChevronDown, Ban, History, Target, BarChart3, Microscope, Zap
} from 'lucide-react';
import { JobState } from '../../types';
import { JobRunner } from '../services/jobRunner';

interface TaskExecutionModalProps {
  job: JobState | null;
  isOpen: boolean;
  onCancel: () => void;
  onClose: () => void;
  onMinimize: () => void;
  onRestore: () => void;
  jobId?: string | null;
}

const getJobIcon = (type: string) => {
    switch(type) {
        case 'BUILD_STRATEGY': return <Target className="w-5 h-5 text-blue-500" />;
        case 'RUN_DEMAND': return <BarChart3 className="w-5 h-5 text-teal-500" />;
        case 'RUN_DEEP_DIVE': return <Microscope className="w-5 h-5 text-indigo-500" />;
        case 'GENERATE_PLAYBOOK': return <Zap className="w-5 h-5 text-amber-500" />;
        default: return <Cpu className="w-5 h-5 text-slate-500" />;
    }
};

const getModelName = (type: string) => {
    if (type === 'BUILD_STRATEGY' || type === 'RUN_DEEP_DIVE') return 'Gemini 3 Pro (Thinking)';
    return 'Gemini 3 Flash';
};

const formatJobType = (type: string) => {
    if (type === 'BUILD_STRATEGY') return 'BUILD CONSUMER NEED ANALYSIS';
    return type.replace(/_/g, ' ');
};

const getProgressPercent = (p: number | { processed: number; total: number }): number => {
    if (typeof p === 'number') return p;
    if (p.total === 0) return 0;
    return Math.floor((p.processed / p.total) * 100);
}

export const TaskExecutionModal: React.FC<TaskExecutionModalProps> = ({
  job: propJob,
  isOpen,
  onCancel,
  onClose,
  onMinimize,
  onRestore,
  jobId
}) => {
  const logEndRef = useRef<HTMLDivElement>(null);
  const [internalJob, setInternalJob] = useState<JobState | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);

  useEffect(() => {
    if (propJob) {
        setInternalJob(propJob);
        return;
    }
    if (jobId) {
        const fetchJob = async () => {
            const j = await JobRunner.getJob(jobId);
            setInternalJob(j);
        };
        fetchJob(); 
        const interval = setInterval(fetchJob, 1000); 
        return () => clearInterval(interval);
    }
  }, [propJob, jobId]);

  const job = internalJob;

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [job?.logs]);

  const [simulatedProgress, setSimulatedProgress] = useState(0);

  useEffect(() => {
    if (!isOpen || !job || (job.status !== 'RUNNING' && job.status !== 'PENDING')) return;
    
    const startTime = new Date(job.startedAt).getTime();
    const interval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        setElapsedTime(elapsed);
        
        // Smooth simulated progress: fast at start, slows down approaching 90%
        // Uses asymptotic curve: never exceeds 92% until real completion
        const seconds = elapsed / 1000;
        const estimatedDuration = job.type === 'BUILD_STRATEGY' ? 120 : job.type === 'RUN_DEMAND' ? 60 : 90;
        const ratio = Math.min(seconds / estimatedDuration, 1);
        const simulated = Math.min(92, Math.floor(ratio * 100 * (1 - ratio * 0.3)));
        setSimulatedProgress(simulated);
    }, 500);

    return () => clearInterval(interval);
  }, [isOpen, job?.status, job?.startedAt, job?.type]);

  // Reset simulated progress when job changes
  useEffect(() => {
    if (job?.status === 'COMPLETED') setSimulatedProgress(100);
    else if (job?.status === 'FAILED' || job?.status === 'CANCELLED') setSimulatedProgress(0);
    else if (job?.status === 'PENDING') setSimulatedProgress(0);
  }, [job?.status]);

  const formatRuntime = (ms: number) => {
      const totalSeconds = Math.floor(ms / 1000);
      const h = Math.floor(totalSeconds / 3600);
      const m = Math.floor((totalSeconds % 3600) / 60);
      const s = totalSeconds % 60;
      if (h > 0) return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
      return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  if (!isOpen || !job) return null;

  const isRunning = job.status === 'RUNNING' || job.status === 'PENDING';
  const isCancelling = job.status === 'CANCELLING';
  const isFailed = job.status === 'FAILED';
  const isSuccess = job.status === 'COMPLETED';
  const isCancelled = job.status === 'CANCELLED';

  if (job.isMinimized) return null;

  const progressPercent = isSuccess ? 100 : isFailed ? 0 : (getProgressPercent(job.progress) || simulatedProgress);

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[#0F172A]/80 backdrop-blur-md animate-in fade-in duration-300" />
      
      <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-2xl flex flex-col max-h-[85vh] overflow-hidden animate-in zoom-in-95 duration-200 relative z-10">
        
        <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center bg-[#F8FAFC]">
          <div className="flex items-center gap-4">
             <div className="p-3 bg-white rounded-xl shadow-sm border border-slate-200">
                {getJobIcon(job.type)}
             </div>
             <div>
                <h2 className="text-lg font-black text-[#0F172A] tracking-tight leading-none mb-1">
                    {formatJobType(job.type)}
                </h2>
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-1.5">
                    {job.categoryId} Analysis
                </div>
             </div>
          </div>
          <div className="flex items-center gap-2">
             <button 
                onClick={onMinimize}
                className="p-2 text-slate-400 hover:text-[#0F172A] hover:bg-slate-200 rounded-lg transition-all"
                title="Minimize"
             >
                <ChevronDown className="w-5 h-5"/>
             </button>
             {isRunning && (
                <span className="flex items-center gap-1.5 bg-blue-50 text-blue-700 px-3 py-1.5 rounded-full text-[10px] font-black border border-blue-100 uppercase tracking-widest shadow-sm ml-2">
                    <Loader2 className="w-3 h-3 animate-spin"/> {job.currentStage || 'Running'}
                </span>
             )}
          </div>
        </div>

        <div className="px-8 py-6 bg-white border-b border-slate-50 flex flex-col md:flex-row gap-6">
            <div className="flex-1 space-y-3">
                <div className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
                    <History className="w-3 h-3 text-blue-500"/> Pipeline State
                </div>
                <p className="text-sm text-slate-800 font-bold leading-relaxed">
                    {job.message || 'Initializing model parameters...'}
                </p>
                <div className="flex items-center gap-2 mt-2">
                    <span className="text-[10px] font-black bg-slate-100 text-slate-500 px-2 py-0.5 rounded uppercase tracking-tighter border border-slate-200">
                        {getModelName(job.type)}
                    </span>
                </div>
            </div>
            <div className="w-full md:w-64 bg-slate-50 rounded-2xl p-4 border border-slate-100 shrink-0">
                <div className="flex justify-between items-center mb-4">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Active Runtime</span>
                    <div className="flex items-center gap-1 text-[11px] font-mono font-bold text-[#0F172A]">
                        <Clock className="w-3 h-3 text-blue-600"/> {formatRuntime(elapsedTime)}
                    </div>
                </div>
                <div className="space-y-2">
                    <div className="flex justify-between text-[11px]">
                        <span className="text-slate-500 font-bold uppercase tracking-wider">Progress</span>
                        <span className="text-[#0F172A] font-black">{progressPercent}%</span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
                        <div 
                            className={`h-full rounded-full transition-all duration-1000 ease-out ${isFailed ? 'bg-red-500' : isSuccess ? 'bg-teal-500' : (isCancelled || isCancelling) ? 'bg-slate-400' : 'bg-gradient-to-r from-blue-500 to-indigo-500'}`}
                            style={{ width: `${progressPercent}%` }}
                        >
                            {isRunning && <div className="h-full w-full bg-white/20 animate-pulse rounded-full" />}
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 bg-[#0F172A]">
            <div className="flex items-center gap-2 mb-4">
                <Terminal className="w-4 h-4 text-teal-400"/>
                <span className="text-[10px] font-black text-teal-400/60 uppercase tracking-[0.3em]">Telemetry Stream</span>
            </div>
            <div className="space-y-1 font-mono text-[11px]">
                {(job.logs || []).map((entry, idx) => (
                    <div key={idx} className="flex gap-3 text-blue-100/80 leading-tight">
                        <span className="opacity-40 select-none">$</span>
                        <span className="break-words whitespace-pre-wrap">{entry}</span>
                    </div>
                ))}
                {isRunning && (
                    <div className="flex gap-3 text-teal-500/50 animate-pulse mt-2 font-black select-none">
                        <span>_</span>
                    </div>
                )}
                <div ref={logEndRef} />
            </div>
        </div>

        <div className="p-6 border-t border-slate-100 bg-white flex justify-end gap-3 items-center">
             {isRunning && !isCancelling ? (
                 <button 
                    onClick={onCancel} 
                    className="flex items-center gap-2 bg-white border border-red-200 text-red-600 px-6 py-3 rounded-2xl text-[10px] font-black hover:bg-red-50 transition-all uppercase tracking-widest shadow-sm active:scale-95"
                 >
                    <Ban className="w-4 h-4"/> Abort Task
                 </button>
             ) : (
                 <button 
                    onClick={onClose} 
                    className="flex items-center gap-2 bg-[#0F172A] text-white px-10 py-3 rounded-2xl text-[10px] font-black hover:bg-slate-800 transition-all uppercase tracking-widest shadow-xl active:scale-95"
                 >
                    Dismiss
                 </button>
             )}
        </div>
      </div>
    </div>
  );
};
