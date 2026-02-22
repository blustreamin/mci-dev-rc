
import React, { useState } from 'react';
import { ShieldAlert, Trash2 } from 'lucide-react';
import { FlushRebuildModal } from '../FlushRebuildModal';
import { SimpleErrorBoundary } from '../../components/SimpleErrorBoundary';

export const DangerZoneTab: React.FC = () => {
    const [showFlush, setShowFlush] = useState(false);

    return (
        <SimpleErrorBoundary>
            <div className="space-y-6 animate-in fade-in duration-500">
                <FlushRebuildModal isOpen={showFlush} onClose={() => setShowFlush(false)} />
                
                <div className="bg-rose-50 rounded-xl border border-rose-200 shadow-sm overflow-hidden">
                    <div className="px-6 py-4 border-b border-rose-100 bg-rose-100/50 flex items-center gap-3">
                        <ShieldAlert className="w-5 h-5 text-rose-700"/>
                        <h3 className="text-sm font-black text-rose-900 uppercase tracking-widest">Irreversible Actions</h3>
                    </div>
                    <div className="p-6">
                        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                            <div>
                                <h4 className="font-bold text-rose-800 text-sm mb-1">Reset Corpus & Database</h4>
                                <p className="text-xs text-rose-700 leading-relaxed max-w-lg">
                                    This will permanently delete all snapshots, keywords, metrics, and job history. 
                                    This action cannot be undone and will require a full rebuild consuming significant API credits.
                                </p>
                            </div>
                            <button 
                                onClick={() => setShowFlush(true)}
                                className="px-6 py-3 bg-white border border-rose-300 text-rose-600 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-rose-600 hover:text-white hover:border-rose-600 shadow-sm flex items-center gap-2 transition-all"
                            >
                                <Trash2 className="w-4 h-4"/> Flush & Rebuild
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </SimpleErrorBoundary>
    );
};
