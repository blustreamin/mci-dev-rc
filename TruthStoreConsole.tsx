import React, { useEffect, useState } from 'react';
import { 
    Database, Search, Server, FileText, CheckCircle2, AlertTriangle, 
    Terminal, ArrowRight, BarChart3, Copy, Activity, UploadCloud, LogOut, Clock, ShieldCheck
} from 'lucide-react';
import { TruthConsoleService, ConsoleSnapshot, KeywordSummary } from './src/services/truthConsoleService';
import { TruthVolume } from './src/services/volumeTruthStore';
import { CsvTruthIngestion } from './src/services/csvTruthIngestion';
import { WindowingService, TruthResolution } from './src/services/windowing';

// Safety check for browser environments where 'process' is undefined or null
const safeProcess = (typeof process !== 'undefined' && process && process.env) 
    ? process 
    : { env: {} as Record<string, string | undefined> };

const HealthIndicator: React.FC = () => {
    const [status, setStatus] = useState<'OK' | 'ERR' | 'LOADING'>('LOADING');
    const [resolution, setResolution] = useState<TruthResolution | null>(null);

    useEffect(() => {
        TruthConsoleService.checkHealth()
            .then(async (res) => {
                setStatus('OK');
                // Fetch resolution status
                const resStatus = await WindowingService.resolveTruth();
                setResolution(resStatus);
            })
            .catch(() => setStatus('ERR'));
    }, []);

    const isStale = resolution?.dataAgeDays && resolution.dataAgeDays > 30;

    return (
        <div className="flex items-center gap-4">
            {/* Source Badge */}
            {resolution && (
                <div className={`flex items-center gap-2 text-[10px] px-2 py-1 rounded border ${
                    resolution.source === 'MANGOOLS' 
                        ? 'bg-indigo-50 text-indigo-700 border-indigo-200' 
                        : 'bg-amber-50 text-amber-700 border-amber-200'
                }`}>
                    <ShieldCheck className="w-3 h-3"/>
                    <span className="font-bold">{resolution.source}</span>
                    <span className="font-mono opacity-70">| {resolution.windowId}</span>
                </div>
            )}

            {/* Staleness Badge */}
            {resolution && resolution.source !== 'WEEKLY_FALLBACK' && (
                <div className={`flex items-center gap-2 text-[10px] px-2 py-1 rounded border ${
                    isStale 
                        ? 'bg-red-50 text-red-700 border-red-200' 
                        : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                }`}>
                    <Clock className="w-3 h-3"/>
                    <span className="font-bold">{resolution.dataAgeDays}d Old</span>
                    {isStale && <span className="font-bold ml-1">STALE (&gt;30d)</span>}
                </div>
            )}

            <div className="flex items-center gap-2 text-[10px] bg-white/50 px-2 py-1 rounded border border-white/20">
                <Activity className={`w-3 h-3 ${status === 'OK' ? 'text-emerald-600' : status === 'ERR' ? 'text-red-600' : 'text-amber-600'}`} />
                <span className="font-bold text-slate-700">
                    {status === 'OK' ? 'DB Active' : status === 'LOADING' ? 'Connecting...' : 'Failed'}
                </span>
            </div>
        </div>
    );
};

const ConsoleLayout: React.FC<{ children: React.ReactNode, onClose?: () => void }> = ({ children, onClose }) => (
    <div className="min-h-screen bg-slate-50 font-mono text-slate-800">
        <div className="bg-amber-100 border-b border-amber-200 px-4 py-2 text-xs font-bold text-amber-900 flex justify-between items-center sticky top-0 z-50">
            <span className="flex items-center gap-2"><AlertTriangle className="w-3 h-3"/> ⚠️ Developers Only — Internal Truth Store Inspection UI</span>
            <div className="flex items-center gap-4">
                <HealthIndicator />
                <span>NO-INDEX | NO-FOLLOW</span>
            </div>
        </div>
        <div className="max-w-7xl mx-auto p-6">
            <header className="mb-8 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-slate-900 text-white rounded-lg">
                        <Database className="w-6 h-6"/>
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Truth Store Console</h1>
                        <p className="text-xs text-slate-500">Inspection Layer v1.0 • {new Date().toLocaleDateString()}</p>
                    </div>
                </div>
                <div className="flex items-center gap-4 text-right text-xs text-slate-400">
                    <div>
                        <div>Environment: <span className="font-bold text-slate-600">{safeProcess.env.NODE_ENV?.toUpperCase() || 'LOCAL'}</span></div>
                        <div>Route: <span className="font-mono bg-slate-200 px-1 rounded">/dev/truth-store</span></div>
                    </div>
                    {onClose && (
                        <button 
                            onClick={onClose} 
                            className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg font-bold flex items-center gap-2 transition-colors ml-4 shadow-sm"
                        >
                            <LogOut className="w-4 h-4"/> Exit Console
                        </button>
                    )}
                </div>
            </header>
            {children}
        </div>
    </div>
);

const QuickIngest: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
    const [csv, setCsv] = useState('');
    const [loading, setLoading] = useState(false);
    const [log, setLog] = useState('');

    const handleIngest = async () => {
        if (!csv.trim()) return;
        setLoading(true);
        setLog('Processing...');
        try {
            const report = await CsvTruthIngestion.ingest(csv);
            if (report.status === 'SUCCESS' && report.summary.snapshotId) {
                setLog(`Ingested! Setting ${report.summary.snapshotId} as stable...`);
                // Note: Ingest automatically sets pointer now
                onComplete();
            } else {
                setLog(`Failed: ${report.message}`);
            }
        } catch (e: any) {
            setLog(`Error: ${e.message}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-10 text-center shadow-sm">
            <div className="flex justify-center mb-4">
                <div className="p-4 bg-white rounded-full border border-slate-200 shadow-sm">
                    <UploadCloud className="w-8 h-8 text-indigo-500" />
                </div>
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-2">Truth Store is Empty</h3>
            <p className="text-sm text-slate-500 mb-6 max-w-md mx-auto">
                No snapshots found in the local IndexedDB. 
                Paste your Mangools CSV data below to seed the database and create the first stable snapshot.
            </p>
            <div className="max-w-2xl mx-auto">
                <textarea 
                    className="w-full h-32 border border-slate-300 rounded-lg p-3 text-xs font-mono mb-4 focus:ring-2 focus:ring-indigo-500 outline-none"
                    placeholder="Paste CSV header and rows here..."
                    value={csv}
                    onChange={e => setCsv(e.target.value)}
                />
                <button 
                    onClick={handleIngest} 
                    disabled={loading || !csv.trim()}
                    className="bg-indigo-600 text-white px-6 py-2.5 rounded-lg font-bold text-sm hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-md transition-all flex items-center gap-2 mx-auto"
                >
                    {loading ? <span className="animate-spin">⏳</span> : <UploadCloud className="w-4 h-4" />}
                    {loading ? 'Ingesting Data...' : 'Ingest & Initialize'}
                </button>
            </div>
            {log && (
                <div className={`mt-4 text-xs font-mono px-4 py-2 rounded inline-block ${log.includes('Failed') || log.includes('Error') ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700'}`}>
                    {log}
                </div>
            )}
        </div>
    );
};

const SnapshotsView: React.FC<{ onSelect: (id: string) => void }> = ({ onSelect }) => {
    const [snapshots, setSnapshots] = useState<ConsoleSnapshot[]>([]);
    const [loading, setLoading] = useState(true);

    const refresh = () => {
        setLoading(true);
        TruthConsoleService.listSnapshots().then(setSnapshots).finally(() => setLoading(false));
    };

    useEffect(() => {
        refresh();
    }, []);

    const handleSetStable = async (id: string) => {
        if (!confirm(`Promote ${id} to LATEST STABLE? This affects all Demand runs.`)) return;
        await TruthConsoleService.setLatestStable(id);
        refresh();
    };

    if (loading) return <div className="p-8 text-center text-slate-400">Loading snapshots...</div>;

    if (snapshots.length === 0) {
        return <QuickIngest onComplete={refresh} />;
    }

    return (
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden mb-8">
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                <h3 className="font-bold text-sm flex items-center gap-2"><Server className="w-4 h-4"/> Snapshot Registry</h3>
                <span className="text-xs text-slate-400">{snapshots.length} Records</span>
            </div>
            <table className="w-full text-xs text-left">
                <thead className="bg-slate-100 text-slate-500 font-bold uppercase">
                    <tr>
                        <th className="p-3">Snapshot ID</th>
                        <th className="p-3">Source</th>
                        <th className="p-3">Seeded At</th>
                        <th className="p-3">Metrics</th>
                        <th className="p-3 text-right">Actions</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {snapshots.map(s => (
                        <tr key={s.id} className={`group hover:bg-slate-50 transition-colors ${s.isLatestStable ? 'bg-emerald-50/30' : ''}`}>
                            <td className="p-3 font-mono font-medium">
                                <div className="flex items-center gap-2">
                                    {s.id}
                                    {s.isLatestStable && <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded text-[10px] font-bold">STABLE</span>}
                                </div>
                            </td>
                            <td className="p-3 text-slate-600">{s.stats?.injectionSource || 'Unknown'}</td>
                            <td className="p-3 text-slate-400">{new Date(s.sealedAt).toLocaleString()}</td>
                            <td className="p-3">
                                <div className="flex gap-2">
                                    <span className="px-1.5 py-0.5 bg-slate-100 rounded border border-slate-200">{s.stats?.keywordsSeeded || 0} KW</span>
                                    {s.stats?.injectionSourceSnapshot && <span className="px-1.5 py-0.5 bg-slate-100 rounded border border-slate-200 font-mono" title="Source Hash">{s.stats.injectionSourceSnapshot.substring(0,6)}...</span>}
                                </div>
                            </td>
                            <td className="p-3 text-right flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                {!s.isLatestStable && (
                                    <button onClick={() => handleSetStable(s.id)} className="px-2 py-1 bg-white border border-slate-300 rounded hover:border-emerald-500 hover:text-emerald-600 transition-colors">
                                        Set Stable
                                    </button>
                                )}
                                <button onClick={() => onSelect(s.id)} className="px-2 py-1 bg-slate-900 text-white rounded hover:bg-slate-800 flex items-center gap-1">
                                    Inspect <ArrowRight className="w-3 h-3"/>
                                </button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

const KeywordInspector: React.FC<{ snapshotId: string, onBack: () => void }> = ({ snapshotId, onBack }) => {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<KeywordSummary[]>([]);
    const [selectedKeyword, setSelectedKeyword] = useState<TruthVolume | null>(null);
    const [searching, setSearching] = useState(false);

    const handleSearch = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!query.trim()) return;
        setSearching(true);
        setSelectedKeyword(null);
        try {
            const res = await TruthConsoleService.searchKeywords(snapshotId, query);
            setResults(res);
        } finally {
            setSearching(false);
        }
    };

    const handleSelectKeyword = async (key: string) => {
        const details = await TruthConsoleService.getKeywordDetails(snapshotId, key);
        setSelectedKeyword(details);
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-200px)]">
            {/* Left: Search & List */}
            <div className="lg:col-span-1 bg-white rounded-lg border border-slate-200 shadow-sm flex flex-col overflow-hidden">
                <div className="p-4 border-b border-slate-100 bg-slate-50">
                    <button onClick={onBack} className="text-xs text-slate-400 hover:text-slate-600 mb-2 flex items-center gap-1">← Back to Snapshots</button>
                    <div className="text-xs font-bold text-slate-500 uppercase mb-1">Inspecting Snapshot</div>
                    <div className="font-mono text-sm font-bold truncate mb-4" title={snapshotId}>{snapshotId}</div>
                    
                    <form onSubmit={handleSearch} className="relative">
                        <input 
                            type="text" 
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder="Search keywords..."
                            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                        />
                        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5"/>
                    </form>
                </div>
                
                <div className="flex-1 overflow-y-auto">
                    {searching ? (
                        <div className="p-8 text-center text-slate-400 text-xs">Scanning IDB...</div>
                    ) : (
                        <div className="divide-y divide-slate-50">
                            {results.map(k => (
                                <div 
                                    key={k.keywordId} 
                                    onClick={() => handleSelectKeyword(k.keywordId)}
                                    className={`p-3 cursor-pointer hover:bg-slate-50 transition-colors ${selectedKeyword?.keywordKey === k.keywordId ? 'bg-indigo-50 border-l-2 border-indigo-600' : 'border-l-2 border-transparent'}`}
                                >
                                    <div className="font-medium text-sm text-slate-900">{k.keywordText}</div>
                                    <div className="flex justify-between items-center mt-1">
                                        <span className="text-xs font-mono text-slate-500">{k.volume.toLocaleString()} Vol</span>
                                        <div className="flex gap-2 text-[10px]">
                                            <span className={`px-1 rounded ${k.demandScore > 50 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                                                DS: {k.demandScore}
                                            </span>
                                            <span className={`px-1 rounded ${k.trend6m > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                                                T: {k.trend6m > 0 ? '+' : ''}{k.trend6m}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                            {results.length === 0 && !searching && query && (
                                <div className="p-8 text-center text-slate-400 text-xs">No matches found.</div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Right: Details */}
            <div className="lg:col-span-2 bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                {!selectedKeyword ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8">
                        <FileText className="w-12 h-12 mb-2 opacity-20"/>
                        <p>Select a keyword to inspect details</p>
                    </div>
                ) : (
                    <div className="flex-1 overflow-y-auto p-6">
                        <div className="flex justify-between items-start mb-6">
                            <div>
                                <h2 className="text-xl font-bold text-slate-900">{selectedKeyword.keywordKey}</h2>
                                <div className="text-xs text-slate-500 font-mono mt-1 flex items-center gap-2">
                                    {selectedKeyword.truthHash.substring(0, 16)}...
                                    <button className="hover:text-indigo-600"><Copy className="w-3 h-3"/></button>
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="text-2xl font-black text-slate-900">{selectedKeyword.truthVolume.toLocaleString()}</div>
                                <div className="text-xs text-slate-500 uppercase tracking-wider font-bold">Truth Volume</div>
                            </div>
                        </div>

                        {/* Metrics Grid */}
                        {selectedKeyword.derivedMetrics && (
                            <div className="grid grid-cols-4 gap-4 mb-8">
                                <div className="p-3 bg-slate-50 rounded border border-slate-200">
                                    <div className="text-[10px] text-slate-500 uppercase font-bold">Demand Score</div>
                                    <div className="text-lg font-bold text-indigo-600">{selectedKeyword.derivedMetrics.demandScore}/100</div>
                                </div>
                                <div className="p-3 bg-slate-50 rounded border border-slate-200">
                                    <div className="text-[10px] text-slate-500 uppercase font-bold">Momentum</div>
                                    <div className="text-lg font-bold text-emerald-600">{selectedKeyword.derivedMetrics.momentum.toFixed(2)}x</div>
                                </div>
                                <div className="p-3 bg-slate-50 rounded border border-slate-200">
                                    <div className="text-[10px] text-slate-500 uppercase font-bold">Trend (6m)</div>
                                    <div className="text-lg font-bold text-slate-700">{selectedKeyword.derivedMetrics.trend6m > 0 ? '+' : ''}{selectedKeyword.derivedMetrics.trend6m}</div>
                                </div>
                                <div className="p-3 bg-slate-50 rounded border border-slate-200">
                                    <div className="text-[10px] text-slate-500 uppercase font-bold">Seasonality</div>
                                    <div className="text-lg font-bold text-slate-700">{selectedKeyword.derivedMetrics.seasonality.strength.toFixed(1)}x (M{selectedKeyword.derivedMetrics.seasonality.peakMonth})</div>
                                </div>
                            </div>
                        )}

                        {/* Time Series Chart (Simple SVG) */}
                        {selectedKeyword.truthHistory && selectedKeyword.truthHistory.length > 0 && (
                            <div className="mb-8">
                                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                                    <BarChart3 className="w-4 h-4"/> Monthly Volume History
                                </h3>
                                <div className="h-40 flex items-end gap-1 border-b border-slate-200 pb-1">
                                    {selectedKeyword.truthHistory.map((pt, i) => {
                                        const max = Math.max(...selectedKeyword.truthHistory!.map(p => p.volume));
                                        const height = (pt.volume / max) * 100;
                                        return (
                                            <div key={i} className="flex-1 flex flex-col items-center group relative">
                                                <div 
                                                    className="w-full bg-indigo-100 hover:bg-indigo-500 transition-colors rounded-t-sm"
                                                    style={{ height: `${height}%` }}
                                                />
                                                <div className="absolute bottom-full mb-1 opacity-0 group-hover:opacity-100 bg-black text-white text-[10px] p-1 rounded whitespace-nowrap z-10 pointer-events-none">
                                                    {pt.date}: {pt.volume}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                                <div className="flex justify-between text-[10px] text-slate-400 mt-1 font-mono">
                                    <span>{selectedKeyword.truthHistory[0].date}</span>
                                    <span>{selectedKeyword.truthHistory[selectedKeyword.truthHistory.length-1].date}</span>
                                </div>
                            </div>
                        )}

                        {/* Raw JSON */}
                        <div>
                            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                                <Terminal className="w-4 h-4"/> Raw Record
                            </h3>
                            <div className="bg-slate-900 rounded-lg p-4 overflow-x-auto">
                                <pre className="text-[10px] text-emerald-400 font-mono leading-relaxed">
                                    {JSON.stringify(selectedKeyword, null, 2)}
                                </pre>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export const TruthStoreConsole: React.FC<{ onClose?: () => void }> = ({ onClose }) => {
    const [view, setView] = useState<'LIST' | 'INSPECT'>('LIST');
    const [selectedSnapshot, setSelectedSnapshot] = useState<string>('');

    // OPEN ACCESS: No env check guard here anymore

    return (
        <ConsoleLayout onClose={onClose}>
            {view === 'LIST' ? (
                <SnapshotsView onSelect={(id) => { setSelectedSnapshot(id); setView('INSPECT'); }} />
            ) : (
                <KeywordInspector snapshotId={selectedSnapshot} onBack={() => setView('LIST')} />
            )}
        </ConsoleLayout>
    );
};