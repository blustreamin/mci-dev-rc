
import React, { useEffect, useRef, useState } from 'react';
import { 
  Loader2, CheckCircle2, AlertCircle, Terminal, Clock, Cpu
} from 'lucide-react';
import { MasterJob } from './types';

interface TaskExecutionModalProps {
  job: MasterJob | null;
  isOpen: boolean;
  onCancel: () => void;
  onClose: () => void;
  onRetry: () => void;
}

export const TaskExecutionModal: React.FC<TaskExecutionModalProps> = ({
  job,
  isOpen,
  onCancel,
  onClose,
}) => {
  const logEndRef = useRef<HTMLDivElement>(null);
  const [elapsedTime, setElapsedTime] = useState(0);

  // Auto-scroll log
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [job?.activity_log]);

  // Live Timer
  useEffect(() => {
    if (!isOpen || !job || (job.status !== 'RUNNING' && job.status !== 'INITIALIZING')) return;
    
    const startTime = job.startedAt ? new Date(job.startedAt).getTime() : Date.now();
    setElapsedTime(Date.now() - startTime);

    const interval = setInterval(() => {
        const start = job.startedAt ? new Date(job.startedAt).getTime() : Date.now();
        setElapsedTime(Date.now() - start);
    }, 1000);

    return () => clearInterval(interval);
  }, [isOpen, job?.status, job?.startedAt]);

  const formatRuntime = (ms: number) => {
      const totalSeconds = Math.floor(ms / 1000);
      const m = Math.floor(totalSeconds / 60);
      const s = totalSeconds % 60;
      return `${m}m ${s.toString().padStart(2, '0')}s`;
  };

  if (!isOpen || !job) return null;

  const isRunning = job.status === 'RUNNING' || job.status === 'INITIALIZING';
  const isFailed = job.status === 'FAILED';
  const isSuccess = job.status === 'COMPLETED';

  const currentAction = job.activity_log.length > 0 ? job.activity_log[job.activity_log.length - 1].message : 'Initializing...';
  const modelName = job.stage_name === 'Strategy' ? 'Gemini 3 Pro (Thinking)' : 'Gemini 3 Flash';

  return (
    <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-md z-[999] flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh] overflow-hidden animate-in zoom-in-95">
        
        {/* Header */}
        <div className="p-8 border-b border-slate-100 flex justify-between items-start bg-slate-50/50">
          <div>
            <div className="flex items-center gap-3 mb-2">
               <h2 className="text-2xl font-black text-slate-900 tracking-tight">{job.stage_name} Task</h2>
               {isRunning && <span className="flex items-center gap-1.5 bg-indigo-50 text-indigo-700 px-3 py-1 rounded-full text-xs font-black border border-indigo-100 uppercase tracking-wider"><Loader2 className="w-3.5 h-3.5 animate-spin"/> Running</span>}
               {isSuccess && <span className="flex items-center gap-1.5 bg-emerald-50 text-emerald-700 px-3 py-1 rounded-full text-xs font-black border border-emerald-100 uppercase tracking-wider"><CheckCircle2 className="w-3.5 h-3.5"/> Complete</span>}
               {isFailed && <span className="flex items-center gap-1.5 bg-red-50 text-red-700 px-3 py-1 rounded-full text-xs font-black border border-red-100 uppercase tracking-wider"><AlertCircle className="w-3.5 h-3.5"/> Failed</span>}
            </div>
            <p className="text-sm text-slate-500 font-medium italic">"Deciphering consumer demand patterns for India..."</p>
          </div>
          <div className="text-right">
             <div className="flex items-center gap-1 text-[10px] font-black text-slate-400 uppercase mb-1 justify-end tracking-widest"><Cpu className="w-3.5 h-3.5 text-indigo-500"/> Compute Unit</div>
             <div className="text-xs font-black bg-indigo-600 text-white px-3 py-1.5 rounded-lg border border-indigo-700 shadow-sm">{modelName}</div>
          </div>
        </div>

        {/* Status Bar */}
        {isRunning && (
            <div className="px-8 mt-8">
                <div className="flex justify-between text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">
                    <span className="flex items-center gap-1.5"><Terminal className="w-3.5 h-3.5"/> Pipeline: {job.stage_name} Process</span>
                    <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5"/> {formatRuntime(elapsedTime)}</span>
                </div>
                <div className="bg-slate-100 p-4 rounded-2xl flex items-center gap-4 border border-slate-200">
                    <Loader2 className="w-5 h-5 animate-spin text-indigo-600" />
                    <span className="text-sm font-bold text-slate-800 truncate">{currentAction}</span>
                </div>
            </div>
        )}

        {/* Log */}
        <div className="flex-1 overflow-y-auto p-8 min-h-[300px] bg-white">
            <div className="flex items-center gap-2 mb-4 text-[10px] font-black text-slate-300 uppercase tracking-widest">
                <div className="flex-1 h-px bg-slate-100" />
                <span>Runtime Execution Logs</span>
                <div className="flex-1 h-px bg-slate-100" />
            </div>
            <div className="space-y-2.5 font-mono">
                {job.activity_log.map((entry, idx) => (
                    <div key={idx} className="flex gap-4 group">
                        <span className="text-slate-300 text-[10px] font-bold shrink-0 pt-0.5 group-hover:text-slate-500 transition-colors">{new Date(entry.timestamp).toLocaleTimeString([], {hour12:false, minute:'2-digit', second:'2-digit'})}</span>
                        <div className={`text-xs leading-relaxed ${entry.status === 'Failed' ? 'text-red-600 font-black' : 'text-slate-600'}`}>
                           <span className="font-black mr-2 bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-tighter">[{entry.step}]</span> {entry.message}
                        </div>
                    </div>
                ))}
                <div ref={logEndRef} />
            </div>
        </div>

        {/* Footer */}
        <div className="p-8 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3">
             {isRunning ? (
                 <button onClick={onCancel} className="bg-white border border-red-200 text-red-600 px-6 py-3 rounded-xl text-sm font-black hover:bg-red-50 transition-all uppercase tracking-widest shadow-sm">Stop Execution</button>
             ) : (
                 <button onClick={onClose} className="bg-slate-900 text-white px-10 py-3 rounded-xl text-sm font-black hover:bg-slate-800 transition-all uppercase tracking-widest shadow-xl">Dismiss</button>
             )}
        </div>
      </div>
    </div>
  );
};
