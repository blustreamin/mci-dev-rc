
import React, { useEffect, useState } from 'react';
import { Wifi, Loader2, RefreshCw, Filter, ArrowRight, AlertTriangle, ExternalLink } from 'lucide-react';
import { SignalHarvesterClient, Mcisignal } from '../services/signalHarvesterClient';
import { CORE_CATEGORIES } from '../constants';
import { QueryDocumentSnapshot } from 'firebase/firestore';
import { FsQueryError } from '../utils/firestoreErrorUtils';

export const SignalsView: React.FC = () => {
    const [signals, setSignals] = useState<Mcisignal[]>([]);
    const [loading, setLoading] = useState(false);
    const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot | null>(null);
    const [hasMore, setHasMore] = useState(true);
    const [error, setError] = useState<FsQueryError | null>(null);

    // Filters
    // Default to first category to ensure query hits a valid partition immediately
    const [selectedCat, setSelectedCat] = useState(CORE_CATEGORIES[0]?.id || 'shaving');
    const [minTrust, setMinTrust] = useState(50);

    const loadSignals = async (reset = false) => {
        setLoading(true);
        setError(null);
        try {
            const res = await SignalHarvesterClient.fetchSignalsPage({
                limit: 50,
                categoryId: selectedCat || undefined,
                minTrustScore: minTrust,
                lastDoc: reset ? undefined : (lastDoc || undefined)
            });

            if (res.error) {
                setError(res.error);
                setSignals([]);
                setHasMore(false);
            } else {
                if (reset) {
                    setSignals(res.signals);
                } else {
                    setSignals(prev => [...prev, ...res.signals]);
                }
                setLastDoc(res.lastDoc);
                setHasMore(!res.empty && !!res.lastDoc);
            }
        } catch (e) {
            console.error("Failed to load signals", e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadSignals(true);
    }, [selectedCat]); // Auto-refresh on category change

    return (
        <div className="max-w-7xl mx-auto px-4 pb-20">
            <div className="mb-8 pt-8">
                <h1 className="text-3xl font-black text-slate-900 tracking-tight mb-2 flex items-center gap-3">
                    <Wifi className="w-8 h-8 text-indigo-600"/> Signals Stream
                </h1>
                <p className="text-slate-500 font-medium text-sm">Real-time market signals harvested from digital platforms.</p>
            </div>

            {/* Filter Bar */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm mb-6 flex flex-wrap gap-4 items-center sticky top-20 z-10">
                <div className="flex items-center gap-2">
                    <Filter className="w-4 h-4 text-slate-400"/>
                    <select 
                        value={selectedCat}
                        onChange={(e) => setSelectedCat(e.target.value)}
                        className="bg-slate-50 border-none rounded-lg text-xs font-bold p-2 focus:ring-2 focus:ring-indigo-500"
                    >
                        {/* Removed 'All Categories' option as it breaks canonical category-partitioned queries */}
                        {CORE_CATEGORIES.map(c => (
                            <option key={c.id} value={c.id}>{c.category}</option>
                        ))}
                    </select>
                </div>
                
                <div className="flex items-center gap-2">
                    <label className="text-xs font-bold text-slate-500 uppercase">Min Trust:</label>
                    <input 
                        type="number" 
                        value={minTrust}
                        onChange={(e) => setMinTrust(Number(e.target.value))}
                        className="w-16 bg-slate-50 border-none rounded-lg text-xs font-bold p-2"
                    />
                </div>

                <button 
                    onClick={() => loadSignals(true)}
                    className="ml-auto px-4 py-2 bg-indigo-50 text-indigo-700 rounded-lg text-xs font-bold hover:bg-indigo-100 flex items-center gap-2"
                >
                    <RefreshCw className="w-3.5 h-3.5"/> Apply Filters
                </button>
            </div>

            {/* Error State */}
            {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-6 mb-6">
                    <div className="flex items-start gap-4">
                        <div className="p-2 bg-red-100 rounded-full text-red-600">
                            <AlertTriangle className="w-6 h-6"/>
                        </div>
                        <div>
                            <h3 className="font-bold text-red-900 text-lg">Query Failed</h3>
                            <p className="text-red-700 text-sm mt-1">{error.kind === 'INDEX_ERROR' ? 'Firestore Composite Index Missing' : 'Operation Failed'}</p>
                            
                            {error.kind === 'INDEX_ERROR' && error.url && (
                                <a 
                                    href={error.url}
                                    target="_blank"
                                    rel="noreferrer" 
                                    className="inline-flex items-center gap-2 mt-3 px-4 py-2 bg-red-600 text-white rounded-lg text-xs font-bold hover:bg-red-700 transition-colors"
                                >
                                    <ExternalLink className="w-3 h-3"/> Create Required Index
                                </a>
                            )}
                            
                            {error.kind !== 'INDEX_ERROR' && (
                                <div className="mt-2 p-2 bg-white/50 rounded border border-red-200 text-xs font-mono text-red-800 break-all">
                                    {(error as any).message || (error as any).originalMessage}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* List */}
            <div className="space-y-4">
                {signals.map(s => (
                    <div key={s.id} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex justify-between items-start mb-2">
                            <div className="flex items-center gap-2">
                                <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-[10px] font-black uppercase">{s.platform || 'WEB'}</span>
                                {s.category && <span className="bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded text-[10px] font-bold">{s.category}</span>}
                                {s.collectedAt && <span className="text-[10px] text-slate-400 font-mono">{new Date(s.collectedAt).toLocaleDateString()}</span>}
                            </div>
                            <div className="flex items-center gap-2">
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                                    (s.trustScore || 0) > 80 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                                }`}>
                                    Trust: {s.trustScore || '?'}
                                </span>
                            </div>
                        </div>
                        
                        <h3 className="font-bold text-slate-900 mb-1">{s.title || "Untitled Signal"}</h3>
                        <p className="text-sm text-slate-600 mb-3 line-clamp-2">{s.snippet}</p>
                        
                        <a href={s.url || '#'} target="_blank" rel="noopener noreferrer" className="text-xs font-bold text-indigo-600 hover:underline flex items-center gap-1">
                            View Source <ArrowRight className="w-3 h-3"/>
                        </a>
                    </div>
                ))}

                {signals.length === 0 && !loading && !error && (
                    <div className="text-center py-20 text-slate-400">
                        <p className="text-sm font-bold">No signals found.</p>
                        <p className="text-xs mt-1 opacity-70 font-mono">No signals matched canonical filters (categoryId + trusted).</p>
                    </div>
                )}
            </div>

            {/* Load More */}
            {hasMore && !error && (
                <div className="mt-8 text-center">
                    <button 
                        onClick={() => loadSignals(false)}
                        disabled={loading}
                        className="px-6 py-3 bg-white border border-slate-200 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-50 disabled:opacity-50 flex items-center gap-2 mx-auto shadow-sm"
                    >
                        {loading && <Loader2 className="w-4 h-4 animate-spin"/>}
                        Load More Signals
                    </button>
                </div>
            )}
        </div>
    );
};
