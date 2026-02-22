
import React from 'react';
import { X } from 'lucide-react';
import { DemandBenchmarksPanel } from './DemandBenchmarksPanel';

interface BenchmarksModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export const BenchmarksModal: React.FC<BenchmarksModalProps> = ({ isOpen, onClose }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[1005] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
            <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                
                {/* Header */}
                <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-start bg-slate-50">
                    <div>
                        <h2 className="text-lg font-black text-slate-900 leading-tight">Demand Benchmarks</h2>
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-1">Verified Reference Metrics</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full text-slate-400 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
                    <DemandBenchmarksPanel onClose={onClose} />
                </div>
            </div>
        </div>
    );
};
