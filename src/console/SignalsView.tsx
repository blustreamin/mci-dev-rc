
import React, { useEffect, useState, useMemo } from 'react';
import { 
    Wifi, Loader2, RefreshCw, Search, ArrowRight, AlertTriangle,
    ExternalLink, Zap, Hash, Globe, MessageSquare, ShoppingCart,
    FileText, Youtube, ChevronDown, CheckCircle2, Filter, Radio
} from 'lucide-react';
import { PlatformSignalHarvester, HarvestedSignal, SignalPlatform } from '../services/platformSignalHarvester';
import { useProjectStore } from '../config/ProjectStore';

const PLATFORM_META: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
    'GOOGLE':      { label: 'Google', color: '#4285f4', bg: 'bg-blue-50', icon: <Globe className="w-3 h-3" /> },
    'BLOG':        { label: 'Blog', color: '#6366f1', bg: 'bg-indigo-50', icon: <FileText className="w-3 h-3" /> },
    'NEWS':        { label: 'News', color: '#0891b2', bg: 'bg-cyan-50', icon: <Globe className="w-3 h-3" /> },
    'REDDIT':      { label: 'Reddit', color: '#ff4500', bg: 'bg-orange-50', icon: <MessageSquare className="w-3 h-3" /> },
    'YOUTUBE':     { label: 'YouTube', color: '#ff0000', bg: 'bg-red-50', icon: <Youtube className="w-3 h-3" /> },
    'AMAZON':      { label: 'Amazon', color: '#ff9900', bg: 'bg-amber-50', icon: <ShoppingCart className="w-3 h-3" /> },
    'QUORA':       { label: 'Quora', color: '#b92b27', bg: 'bg-red-50', icon: <MessageSquare className="w-3 h-3" /> },
    'TWITTER':     { label: 'X/Twitter', color: '#1da1f2', bg: 'bg-sky-50', icon: <MessageSquare className="w-3 h-3" /> },
};

const TYPE_COLORS: Record<string, string> = {
    'Content': 'bg-indigo-50 text-indigo-700',
    'Conversation': 'bg-emerald-50 text-emerald-700',
    'Transaction': 'bg-amber-50 text-amber-700',
};

export const SignalsView: React.FC = () => {
    const projectStore = useProjectStore();
    const isProjectMode = projectStore.hasProject;
    const categories = projectStore.categories;
    const project = projectStore.project;

    const [signals, setSignals] = useState<HarvestedSignal[]>([]);
    const [loading, setLoading] = useState(false);
    const [harvesting, setHarvesting] = useState(false);
    const [harvestLog, setHarvestLog] = useState<string[]>([]);
    const [harvestStats, setHarvestStats] = useState<{ total: number; byPlatform: Record<string, number>; harvestedAt: string | null } | null>(null);
    const [search, setSearch] = useState('');
    const [platformFilter, setPlatformFilter] = useState<string>('ALL');
    const [typeFilter, setTypeFilter] = useState<string>('ALL');

    const categoryId = categories[0]?.id || '';
    const categoryName = categories[0]?.category || 'Category';

    // Load cached signals on mount
    useEffect(() => {
        if (!categoryId) return;
        loadCached();
    }, [categoryId]);

    const loadCached = async () => {
        setLoading(true);
        try {
            const cached = await PlatformSignalHarvester.getCachedSignals(categoryId);
            setSignals(cached);
            const stats = await PlatformSignalHarvester.getSignalStats(categoryId);
            setHarvestStats(stats);
        } catch (e) {
            console.warn('Failed to load cached signals', e);
        } finally {
            setLoading(false);
        }
    };

    // Harvest signals on-the-fly
    const handleHarvest = async () => {
        if (!categoryId || !project) return;
        setHarvesting(true);
        setHarvestLog([`Starting signal harvest for "${categoryName}"...`]);

        const geo = {
            locationCode: project.geo.locationCode,
            language: project.geo.language,
        };

        const category = categories[0];
        if (!category) { setHarvesting(false); return; }

        const result = await PlatformSignalHarvester.harvestAll(
            category,
            geo,
            [],
            (msg) => {
                setHarvestLog(prev => {
                    // Update last line if same platform prefix
                    const prefix = msg.match(/^\[(\w+)\]/)?.[0];
                    if (prefix && prev.length > 0 && prev[prev.length - 1].startsWith(prefix)) {
                        return [...prev.slice(0, -1), msg];
                    }
                    return [...prev, msg];
                });
            }
        );

        if (result.ok) {
            setHarvestLog(prev => [...prev, `✓ Harvest complete: ${result.totalSignals} signals in ${(result.elapsedMs / 1000).toFixed(1)}s`]);
        } else {
            setHarvestLog(prev => [...prev, `✗ Harvest failed: ${result.errors.join(', ')}`]);
        }

        // Reload from cache
        await loadCached();
        setHarvesting(false);
    };

    // Filtered signals
    const filtered = useMemo(() => {
        let r = [...signals];
        if (search) {
            const q = search.toLowerCase();
            r = r.filter(s => s.title.toLowerCase().includes(q) || s.snippet.toLowerCase().includes(q) || s.queryUsed.toLowerCase().includes(q));
        }
        if (platformFilter !== 'ALL') r = r.filter(s => s.platform === platformFilter);
        if (typeFilter !== 'ALL') r = r.filter(s => s.signalType === typeFilter);
        return r;
    }, [signals, search, platformFilter, typeFilter]);

    // Platform counts
    const platformCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        signals.forEach(s => { counts[s.platform] = (counts[s.platform] || 0) + 1; });
        return counts;
    }, [signals]);

    const typeCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        signals.forEach(s => { counts[s.signalType] = (counts[s.signalType] || 0) + 1; });
        return counts;
    }, [signals]);

    if (!isProjectMode) {
        return (
            <div className="max-w-4xl mx-auto px-4 py-20 text-center">
                <Wifi className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                <p className="text-lg font-bold text-slate-400">Create a project to harvest signals</p>
            </div>
        );
    }

    return (
        <div className="max-w-7xl mx-auto px-4 pb-20">
            {/* Header */}
            <div className="mb-8 pt-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-3">
                        <Radio className="w-6 h-6 text-indigo-600" /> Market Signals
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">
                        Live SERP signals for {categoryName} — Google, Reddit, YouTube
                    </p>
                </div>
                <button
                    onClick={handleHarvest}
                    disabled={harvesting}
                    className="flex items-center gap-2 px-5 py-3 bg-indigo-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-indigo-700 disabled:opacity-50 shadow-sm transition-all"
                >
                    {harvesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                    {harvesting ? 'Harvesting...' : signals.length > 0 ? 'Re-Harvest Signals' : 'Harvest Signals'}
                </button>
            </div>

            {/* Harvest Progress Panel */}
            {harvestLog.length > 0 && (
                <div className="bg-slate-900 rounded-2xl overflow-hidden mb-6">
                    <div className="px-5 pt-4 pb-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            {harvesting ? <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" /> : <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                            <span className="text-xs font-black text-white uppercase tracking-wider">{harvesting ? 'Harvesting Signals' : 'Harvest Complete'}</span>
                        </div>
                        {!harvesting && <button onClick={() => setHarvestLog([])} className="text-[10px] text-slate-500 hover:text-slate-300">Dismiss</button>}
                    </div>
                    <div className="px-5 pb-4 font-mono text-[10px] max-h-32 overflow-y-auto">
                        {harvestLog.map((line, i) => (
                            <div key={i} className={`py-0.5 ${line.startsWith('✓') ? 'text-emerald-400' : line.startsWith('✗') ? 'text-red-400' : 'text-slate-500'}`}>
                                {line}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Stats Cards */}
            {signals.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                    <div className="bg-white rounded-xl border border-slate-200 p-4">
                        <div className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Total Signals</div>
                        <div className="text-2xl font-black text-slate-900">{signals.length}</div>
                    </div>
                    {Object.entries(platformCounts).map(([platform, count]) => {
                        const meta = PLATFORM_META[platform] || { label: platform, color: '#666', bg: 'bg-slate-50' };
                        return (
                            <div key={platform} className={`rounded-xl border border-slate-200 p-4 ${meta.bg}`}>
                                <div className="flex items-center gap-1.5 mb-1">
                                    {meta.icon}
                                    <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: meta.color }}>{meta.label}</span>
                                </div>
                                <div className="text-2xl font-black" style={{ color: meta.color }}>{count}</div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Filter Bar */}
            {signals.length > 0 && (
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm mb-6 flex flex-wrap gap-3 items-center">
                    <div className="relative flex-1 min-w-[200px]">
                        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search signals..." className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-indigo-500 focus:border-transparent" />
                    </div>
                    <div className="flex items-center gap-1">
                        <button onClick={() => setPlatformFilter('ALL')} className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${platformFilter === 'ALL' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>All</button>
                        {Object.entries(platformCounts).map(([p, c]) => (
                            <button key={p} onClick={() => setPlatformFilter(p === platformFilter ? 'ALL' : p)} className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${platformFilter === p ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                                {PLATFORM_META[p]?.label || p} ({c})
                            </button>
                        ))}
                    </div>
                    <div className="flex items-center gap-1">
                        {Object.entries(typeCounts).map(([t, c]) => (
                            <button key={t} onClick={() => setTypeFilter(t === typeFilter ? 'ALL' : t)} className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${typeFilter === t ? 'bg-indigo-600 text-white' : TYPE_COLORS[t] || 'bg-slate-100 text-slate-500'}`}>
                                {t} ({c})
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Signal Cards */}
            <div className="space-y-3">
                {filtered.map(s => {
                    const meta = PLATFORM_META[s.platform] || { label: s.platform, color: '#666', bg: 'bg-slate-50', icon: null };
                    return (
                        <div key={s.id} className="bg-white rounded-xl border border-slate-200 p-5 hover:shadow-md transition-shadow">
                            <div className="flex items-start justify-between gap-4 mb-2">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-black uppercase" style={{ backgroundColor: `${meta.color}15`, color: meta.color }}>
                                        {meta.icon} {meta.label}
                                    </span>
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${TYPE_COLORS[s.signalType] || 'bg-slate-100 text-slate-500'}`}>
                                        {s.signalType}
                                    </span>
                                    <span className="text-[10px] text-slate-400">{new Date(s.collectedAt).toLocaleDateString()}</span>
                                </div>
                                <span className="text-[9px] text-slate-400 shrink-0 font-mono">q: {s.queryUsed.substring(0, 40)}{s.queryUsed.length > 40 ? '...' : ''}</span>
                            </div>
                            <h3 className="font-bold text-slate-900 mb-1 text-sm">{s.title}</h3>
                            {s.snippet && <p className="text-xs text-slate-500 mb-3 line-clamp-2">{s.snippet}</p>}
                            <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-[10px] font-bold text-indigo-600 hover:underline flex items-center gap-1">
                                <ExternalLink className="w-3 h-3" /> {s.url.substring(0, 60)}{s.url.length > 60 ? '...' : ''}
                            </a>
                        </div>
                    );
                })}
            </div>

            {/* Empty states */}
            {signals.length === 0 && !loading && !harvesting && (
                <div className="text-center py-20 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
                    <Radio className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                    <p className="text-lg font-bold text-slate-400 mb-2">No signals yet</p>
                    <p className="text-sm text-slate-400 mb-6">Click "Harvest Signals" to scan Google, Reddit, and YouTube for market signals.</p>
                    <button onClick={handleHarvest} className="px-6 py-3 bg-indigo-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-indigo-700">
                        <Zap className="w-4 h-4 inline mr-2" /> Harvest Signals
                    </button>
                </div>
            )}

            {filtered.length === 0 && signals.length > 0 && (
                <div className="text-center py-12 text-slate-400">
                    <p className="text-sm font-bold">No signals match your filters</p>
                </div>
            )}

            {loading && signals.length === 0 && (
                <div className="flex items-center justify-center py-20">
                    <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
                </div>
            )}

            {/* Signal count footer */}
            {filtered.length > 0 && (
                <div className="text-center mt-6 text-[10px] text-slate-400 font-bold">
                    Showing {filtered.length} of {signals.length} signals
                    {harvestStats?.harvestedAt && ` · Last harvested ${new Date(harvestStats.harvestedAt).toLocaleString()}`}
                </div>
            )}
        </div>
    );
};
