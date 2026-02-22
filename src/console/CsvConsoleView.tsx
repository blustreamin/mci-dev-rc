
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { UploadCloud, FileText, CheckCircle2, AlertTriangle, RefreshCw, Database, BarChart3, Calendar, AlertCircle, ChevronDown, ChevronUp, Loader2, ArrowRight, Layers, TrendingUp, Sparkles, Bug, Search, ShieldAlert, XCircle, Clock } from 'lucide-react';
import { CORE_CATEGORIES } from '../constants';
import { CsvIngestionService } from '../services/csvIngestionService';
import { SeedStore } from '../services/seedStore';
import { WindowingService } from '../services/windowing';
import { DataGatingService } from '../services/dataGating';
import { SeedMeta, IngestionReport, IngestionProgress } from '../services/csvIngestion/types';

interface CsvConsoleViewProps {
    onProceed?: () => void;
}

export const CsvConsoleView: React.FC<CsvConsoleViewProps> = ({ onProceed }) => {
    const [monthId, setMonthId] = useState(WindowingService.getCurrentMonthWindowId());
    const [statusMap, setStatusMap] = useState<Record<string, SeedMeta | null>>({});
    const [activeCatId, setActiveCatId] = useState<string | null>(null);
    const [progress, setProgress] = useState<IngestionProgress | null>(null);
    const [report, setReport] = useState<IngestionReport | null>(null);
    const [showDebug, setShowDebug] = useState(false);
    const [isReadyToProceed, setIsReadyToProceed] = useState(false);
    
    const fileInputRef = useRef<HTMLInputElement>(null);

    const refreshStatus = async () => {
        try {
            const map: Record<string, SeedMeta | null> = {};
            for (const cat of CORE_CATEGORIES) {
                const meta = await SeedStore.getSeedMeta(cat.id, monthId);
                map[cat.id] = meta || null;
            }
            setStatusMap(map);
            
            const ready = await DataGatingService.isMasterDataReady();
            setIsReadyToProceed(ready);
        } catch (e) {
            console.error("Failed to refresh status", e);
        }
    };

    useEffect(() => {
        refreshStatus();
    }, [monthId]);

    const handleFileSelect = (catId: string) => {
        setActiveCatId(catId);
        if (fileInputRef.current) {
            fileInputRef.current.value = ''; 
            fileInputRef.current.click();
        }
    };

    const handleUploadChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !activeCatId) return;

        setReport(null);
        setProgress({ stage: 'IDLE', percent: 0, message: 'Starting...' });

        try {
            const text = await file.text();
            
            const res = await CsvIngestionService.ingest(
                text, 
                activeCatId, 
                monthId, 
                file.name,
                (p) => setProgress(p)
            );
            
            setReport(res);
            await refreshStatus();
        } catch (err: any) {
            alert(`Upload Exception: ${err.message}`);
            setProgress({ stage: 'FAILED', percent: 0, message: 'Exception', error: err.message });
        } finally {
            setActiveCatId(null);
        }
    };

    const summary = useMemo(() => {
        const metas = Object.values(statusMap).filter((m): m is SeedMeta => !!m && typeof m === 'object');
        const processedCount = metas.filter(m => m.status === 'PROCESSED' && !m.blockingStatus).length;
        const blockedCount = metas.filter(m => m.blockingStatus).length;
        const totalKeywords = metas.reduce((sum, m) => sum + (m.rowCount || 0), 0);
        
        // Count only valid (non-blocked) trend data
        let weightedTrendSum = 0;
        let validKeywords = 0;
        
        metas.forEach(m => {
            if (!m.blockingStatus && m.rowCount > 0) {
                weightedTrendSum += (m.trendCoveragePct || 0) * m.rowCount;
                validKeywords += m.rowCount;
            }
        });

        const avgTrendCov = validKeywords > 0 ? weightedTrendSum / validKeywords : 0;

        return { processedCount, blockedCount, totalKeywords, avgTrendCov };
    }, [statusMap]);

    return (
        <div className="max-w-7xl mx-auto px-6 py-8">
            <input 
                type="file" 
                ref={fileInputRef} 
                className="hidden" 
                accept=".csv" 
                onChange={handleUploadChange}
            />

            <header className="mb-8 flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-black text-slate-900">CSV Master Console</h1>
                    <p className="text-slate-500">Manage monthly seed truth for all categories. <span className="font-bold text-indigo-600">Stage 1 of 3</span></p>
                </div>
                <div className="flex items-center gap-4 bg-white p-2 rounded-lg border border-slate-200 shadow-sm">
                    <Calendar className="w-4 h-4 text-slate-400"/>
                    <label className="text-xs font-bold text-slate-500 uppercase">Operating Month:</label>
                    <input 
                        type="month" 
                        value={monthId} 
                        onChange={(e) => setMonthId(e.target.value)}
                        className="border-none bg-transparent font-mono font-bold text-slate-900 text-sm focus:ring-0 cursor-pointer"
                    />
                </div>
            </header>

            <div className="mb-8 bg-white rounded-xl border border-slate-200 shadow-sm p-6">
                <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-4">
                    <h2 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                        <BarChart3 className="w-5 h-5 text-indigo-600"/> 
                        Upload Summary ({monthId})
                    </h2>
                    <div className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-2 ${isReadyToProceed ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                        {isReadyToProceed ? <CheckCircle2 className="w-3 h-3"/> : <AlertTriangle className="w-3 h-3"/>}
                        {isReadyToProceed ? 'Data Ready for Strategy' : 'Waiting for Data...'}
                    </div>
                </div>
                
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                    <div>
                        <div className="text-xs font-bold text-slate-400 uppercase mb-1">Categories Ready</div>
                        <div className="text-2xl font-black text-slate-900">
                            {summary.processedCount} <span className="text-sm font-medium text-slate-400">/ {CORE_CATEGORIES.length}</span>
                        </div>
                    </div>
                    <div>
                        <div className="text-xs font-bold text-slate-400 uppercase mb-1">Valid Corpus (Vol > 0)</div>
                        <div className="text-2xl font-black text-emerald-600">{summary.totalKeywords.toLocaleString()}</div>
                    </div>
                    <div>
                        <div className="text-xs font-bold text-slate-400 uppercase mb-1">Data Quality Blocks</div>
                        <div className={`text-2xl font-black ${summary.blockedCount > 0 ? 'text-red-600' : 'text-slate-300'}`}>
                            {summary.blockedCount}
                        </div>
                    </div>
                    <div>
                        <div className="text-xs font-bold text-slate-400 uppercase mb-1">Trend Coverage</div>
                        <div className={`text-2xl font-black ${summary.avgTrendCov > 50 ? 'text-emerald-600' : 'text-slate-400'}`}>
                            {summary.avgTrendCov.toFixed(1)}%
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-20">
                <div className="lg:col-span-2 space-y-4">
                    {CORE_CATEGORIES.map(cat => {
                        const meta = statusMap[cat.id];
                        const isProcessed = meta?.status === 'PROCESSED';
                        const isBlocked = meta?.blockingStatus;
                        const isUploading = activeCatId === cat.id;
                        
                        return (
                            <div key={cat.id} className={`p-4 rounded-xl border flex items-center justify-between transition-all ${isBlocked ? 'bg-red-50 border-red-200' : isProcessed ? 'bg-white border-slate-200' : 'bg-slate-50 border-slate-200 border-dashed'}`}>
                                <div className="flex items-center gap-4">
                                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isBlocked ? 'bg-red-100 text-red-600' : isProcessed ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-200 text-slate-400'}`}>
                                        {isBlocked ? <XCircle className="w-5 h-5"/> : isProcessed ? <CheckCircle2 className="w-5 h-5"/> : <FileText className="w-5 h-5"/>}
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-slate-900">{cat.category}</h3>
                                        <div className="text-xs text-slate-500 mt-0.5 flex gap-2">
                                            {isBlocked ? (
                                                <span className="font-bold text-red-600">Blocked: {meta?.blockingReason?.substring(0, 40)}...</span>
                                            ) : isProcessed ? (
                                                <>
                                                    <span className="font-mono text-emerald-700">{meta?.rowCount} Valid Keywords</span>
                                                    <span>•</span>
                                                    <span className="text-indigo-600">Accepted: {((meta?.acceptedRate || 0)*100).toFixed(0)}%</span>
                                                </>
                                            ) : (
                                                <span>Waiting for seed...</span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-3">
                                    {isUploading ? (
                                        <div className="flex items-center gap-2 text-xs font-bold text-indigo-600">
                                            <Loader2 className="w-3 h-3 animate-spin"/>
                                            {progress ? `${Math.round(progress.percent)}%` : '...'}
                                        </div>
                                    ) : (
                                        <button 
                                            onClick={() => handleFileSelect(cat.id)}
                                            className="cursor-pointer bg-white border border-slate-300 hover:border-indigo-500 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-2 shadow-sm transition-all"
                                        >
                                            <UploadCloud className="w-3 h-3"/>
                                            {isProcessed || isBlocked ? 'Re-Ingest' : 'Upload CSV'}
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="lg:col-span-1">
                    <div className="bg-slate-900 text-white rounded-xl p-6 shadow-xl sticky top-6 max-h-screen overflow-y-auto">
                        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-4 flex items-center gap-2">
                            <Database className="w-4 h-4"/> Ingestion Report
                        </h3>
                        
                        {activeCatId && progress && (
                            <div className={`mb-6 p-4 rounded-lg border ${progress.stage === 'FAILED' ? 'bg-red-900/20 border-red-800' : 'bg-slate-800 border-slate-700'}`}>
                                <div className="flex justify-between text-xs font-bold text-slate-300 mb-1">
                                    <span>{progress.stage}</span>
                                    <span>{Math.round(progress.percent)}%</span>
                                </div>
                                <div className="h-1.5 w-full bg-slate-700 rounded-full overflow-hidden mb-2">
                                    <div className={`h-full transition-all duration-300 ${progress.stage === 'FAILED' ? 'bg-red-500' : 'bg-indigo-500'}`} style={{ width: `${progress.percent}%` }} />
                                </div>
                                <div className="text-[10px] text-slate-400 font-mono truncate">
                                    {progress.message}
                                </div>
                            </div>
                        )}

                        {report ? (
                            <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
                                <div className={`flex justify-between items-center border-b pb-2 ${report.status === 'SUCCESS' ? 'border-emerald-800' : 'border-red-800'}`}>
                                    <span className="font-bold text-lg">{report.categoryId}</span>
                                    <span className={`text-xs px-2 py-1 rounded ${report.status === 'SUCCESS' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                                        {report.status}
                                    </span>
                                </div>
                                
                                {report.message && (
                                    <div className={`text-xs p-2 rounded font-mono ${report.status === 'SUCCESS' ? 'bg-emerald-950/30 text-emerald-300' : 'bg-red-950/30 text-red-300'}`}>
                                        {report.message}
                                    </div>
                                )}
                                
                                <div className="space-y-2 text-sm text-slate-300 font-mono">
                                    <div className="flex justify-between"><span>Duration:</span> <span className="text-white">{report.durationMs}ms</span></div>
                                    <div className="flex justify-between"><span>Rows Read:</span> <span className="text-white">{report.stats.totalRowsRead}</span></div>
                                    <div className="flex justify-between"><span>Deduped:</span> <span className="text-slate-400">{report.stats.duplicatesRemoved}</span></div>
                                    <div className="flex justify-between font-bold border-t border-slate-700 pt-1">
                                        <span>Valid (>0 Vol):</span> 
                                        <span className={report.stats.blockingStatus ? 'text-red-400' : 'text-emerald-400'}>{report.stats.rowsAccepted}</span>
                                    </div>
                                </div>

                                {report.mappingUsed && report.mappingUsed.length > 0 && (
                                    <div className="bg-slate-950 p-2 rounded border border-slate-800 text-[10px] font-mono text-slate-400">
                                        <div className="font-bold text-slate-500 mb-1">Mapping:</div>
                                        {report.mappingUsed.map((m, i) => <div key={i}>{m}</div>)}
                                    </div>
                                )}

                                {/* DIAGNOSTICS */}
                                {report.diagnostics && (
                                    <div className="border border-slate-700 rounded-lg p-3 bg-slate-950/50">
                                        <h4 className="text-xs font-bold text-slate-400 uppercase mb-2 flex items-center gap-2">
                                            <Search className="w-3 h-3"/> Hard Rejection Stats
                                        </h4>
                                        <div className="text-[10px] space-y-1 font-mono text-slate-400">
                                            <div className="flex justify-between text-slate-500">
                                                <span>Column Used:</span>
                                                <span className="text-white truncate w-24" title={report.diagnostics.volumeColumnHeader}>{report.diagnostics.volumeColumnHeader}</span>
                                            </div>
                                            <div className="h-px bg-slate-800 my-1"/>
                                            <div className="flex justify-between"><span>Accepted:</span> <span className="text-emerald-400">{report.diagnostics.acceptedCount}</span></div>
                                            <div className="flex justify-between"><span>Reject (Keyword Blank):</span> <span className="text-red-400">{report.diagnostics.keywordBlankRejectedCount}</span></div>
                                            <div className="flex justify-between"><span>Reject (Vol Blank):</span> <span className="text-red-400">{report.diagnostics.volumeBlankRejectedCount}</span></div>
                                            <div className="flex justify-between"><span>Reject (Vol Null/NaN):</span> <span className="text-red-400">{report.diagnostics.volumeNullRejectedCount + report.diagnostics.volumeNaNRejectedCount}</span></div>
                                            <div className="flex justify-between font-bold"><span>Reject (Vol Zero):</span> <span className="text-amber-500">{report.diagnostics.volumeZeroRejectedCount}</span></div>
                                            
                                            <div className="mt-2 pt-2 border-t border-slate-800">
                                                <span className="text-slate-500 block mb-1">Rejected Samples:</span>
                                                {report.diagnostics.rejectedSamples.slice(0, 3).map((s, i) => (
                                                    <div key={i} className="flex gap-2 text-slate-500 truncate">
                                                        <span className="text-red-500">[{s.reason}]</span>
                                                        <span>"{s.k.substring(0, 10)}..."</span>
                                                        <span className="text-slate-600">v:{s.v}</span>
                                                    </div>
                                                ))}
                                            </div>
                                            <div className="mt-2 pt-2 border-t border-slate-800">
                                                <span className="text-slate-500 block mb-1">Accepted Samples:</span>
                                                {report.diagnostics.acceptedSamples.slice(0, 3).map((s, i) => (
                                                    <div key={i} className="flex gap-2 text-emerald-600 truncate">
                                                        <span>"{s.k.substring(0, 15)}..."</span>
                                                        <span>v:{s.v}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="text-slate-500 text-sm text-center py-10">
                                Upload a CSV to view analysis details.
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-slate-200 flex justify-end items-center gap-4 z-40 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
               <div className="text-sm text-slate-500 font-medium">
                   {summary.processedCount} categories ready
               </div>
               <button 
                   onClick={onProceed}
                   disabled={!isReadyToProceed}
                   className="bg-slate-900 text-white px-6 py-3 rounded-xl font-bold text-sm hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-lg hover:shadow-xl transition-all"
               >
                   Continue to Strategy <ArrowRight className="w-4 h-4" />
               </button>
            </div>
        </div>
    );
};
