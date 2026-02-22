
import React, { useEffect, useState } from 'react';
import { BookOpen, Search, Calendar, ChevronRight, Loader2, RefreshCw, AlertTriangle, Trash2 } from 'lucide-react';
import { DeepDiveLibraryService, DeepDiveReportSummary } from '../services/deepDiveLibraryService';
import { toReactText } from '../utils/reactSafe';
import { VALID_DEEP_DIVE_SCHEMAS } from '../types';

interface DeepDiveLibraryPanelProps {
    onOpenReport: (categoryId: string, monthKey: string) => void;
}

// Safe normalization helper to prevent WSOD on null/undefined
const norm = (v: unknown) => (typeof v === "string" ? v : "").toLowerCase().trim();

export const DeepDiveLibraryPanel: React.FC<DeepDiveLibraryPanelProps> = ({ onOpenReport }) => {
    const [reports, setReports] = useState<DeepDiveReportSummary[]>([]);
    const [loading, setLoading] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const [filter, setFilter] = useState('');
    const [showClearConfirm, setShowClearConfirm] = useState(false);
    const [clearing, setClearing] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const data = await DeepDiveLibraryService.listDeepDiveReports(100);
            setReports(data);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen && reports.length === 0) {
            load();
        }
    }, [isOpen]);

    const handleClearLibrary = async () => {
        setClearing(true);
        try {
            await DeepDiveLibraryService.clearLibrary();
            setShowClearConfirm(false);
            await load(); // Auto refresh
        } catch (e) {
            alert("Failed to clear library");
        } finally {
            setClearing(false);
        }
    };

    const filtered = reports.filter(r => 
        norm(r.categoryId).includes(norm(filter)) || 
        norm(r.monthKey).includes(norm(filter))
    );

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm mb-6 overflow-hidden">
            <div 
                className="px-6 py-4 bg-slate-50 border-b border-slate-100 flex justify-between items-center cursor-pointer hover:bg-slate-100 transition-colors"
                onClick={() => setIsOpen(!isOpen)}
            >
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg">
                        <BookOpen className="w-4 h-4"/>
                    </div>
                    <div>
                        <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Deep Dive Library</h3>
                        <p className="text-[10px] text-slate-500 font-medium">
                            {reports.length > 0 ? `${reports.length} Reports Available` : 'Browse existing analysis'}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-400"/>}
                    <button 
                        onClick={(e) => { e.stopPropagation(); load(); }}
                        className="p-2 hover:bg-white rounded-full text-slate-400 hover:text-indigo-600 transition-colors"
                        title="Refresh Library"
                    >
                        <RefreshCw className="w-4 h-4"/>
                    </button>
                    {reports.length > 0 && (
                        <button 
                            onClick={(e) => { e.stopPropagation(); setShowClearConfirm(true); }}
                            className="p-2 hover:bg-white rounded-full text-slate-400 hover:text-red-600 transition-colors"
                            title="Clear Library"
                        >
                            <Trash2 className="w-4 h-4"/>
                        </button>
                    )}
                </div>
            </div>

            {showClearConfirm && isOpen && (
                <div className="p-4 bg-red-50 border-t border-red-100 flex items-center justify-between animate-in fade-in">
                    <div className="text-xs text-red-800 font-medium flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-red-600"/>
                        This will remove saved Deep Dive reports from the library view. Fresh runs will be generated next time.
                    </div>
                    <div className="flex gap-2">
                        <button 
                            onClick={() => setShowClearConfirm(false)}
                            disabled={clearing}
                            className="px-3 py-1.5 bg-white border border-red-200 text-red-600 rounded-lg text-xs font-bold hover:bg-red-50"
                        >
                            Cancel
                        </button>
                        <button 
                            onClick={handleClearLibrary}
                            disabled={clearing}
                            className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-bold hover:bg-red-700 flex items-center gap-1"
                        >
                            {clearing ? <Loader2 className="w-3 h-3 animate-spin"/> : null}
                            Confirm Clear
                        </button>
                    </div>
                </div>
            )}

            {isOpen && (
                <div className="p-4 border-t border-slate-200 animate-in slide-in-from-top-2">
                    <div className="flex items-center gap-2 mb-4">
                        <div className="relative flex-1">
                            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5"/>
                            <input 
                                type="text"
                                value={filter}
                                onChange={(e) => setFilter(e.target.value)}
                                placeholder="Filter categories..."
                                className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold focus:ring-2 focus:ring-indigo-500 outline-none"
                            />
                        </div>
                    </div>

                    <div className="max-h-64 overflow-y-auto custom-scrollbar space-y-2">
                        {filtered.length === 0 && !loading && (
                            <div className="text-center py-8 text-xs text-slate-400 italic">No reports found.</div>
                        )}
                        {filtered.map(report => {
                            const isLegacy = !VALID_DEEP_DIVE_SCHEMAS.includes(report.schemaVersion || '');
                            return (
                                <div key={report.id} className={`group flex items-center justify-between p-3 rounded-lg border transition-all ${isLegacy ? 'bg-slate-50 border-slate-100 opacity-70 hover:opacity-100' : 'bg-white border-slate-200 hover:border-indigo-200 hover:bg-indigo-50/30'}`}>
                                    <div className="flex-1 min-w-0 grid grid-cols-12 gap-4 items-center">
                                        <div className="col-span-4 font-bold text-slate-800 text-xs truncate" title={report.categoryId}>
                                            {toReactText(report.categoryId) || 'Unknown ID'}
                                        </div>
                                        <div className="col-span-3 flex items-center gap-2 text-xs text-slate-500 font-mono">
                                            <Calendar className="w-3 h-3 text-slate-400"/>
                                            {toReactText(report.monthKey) || '—'}
                                        </div>
                                        <div className="col-span-5 flex items-center gap-2">
                                            {isLegacy ? (
                                                <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-slate-200 text-slate-500 border border-slate-300 flex items-center gap-1">
                                                    <AlertTriangle className="w-3 h-3"/> Legacy
                                                </span>
                                            ) : (
                                                <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider ${
                                                    report.confidence === 'HIGH' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                                                }`}>
                                                    {toReactText(report.confidence) || '—'}
                                                </span>
                                            )}
                                            <span className="text-[9px] text-slate-400 truncate">
                                                {report.generatedAt ? new Date(report.generatedAt).toLocaleDateString() : '—'}
                                            </span>
                                        </div>
                                    </div>
                                    <button 
                                        onClick={() => onOpenReport(report.categoryId, report.monthKey)}
                                        className="ml-4 p-1.5 bg-white border border-slate-200 text-slate-400 rounded-md group-hover:text-indigo-600 group-hover:border-indigo-200 transition-colors shadow-sm"
                                    >
                                        <ChevronRight className="w-4 h-4"/>
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};
