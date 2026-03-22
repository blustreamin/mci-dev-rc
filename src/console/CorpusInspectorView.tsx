
import React, { useState, useEffect, useMemo } from 'react';
import { 
    Loader2, RefreshCw, Database, Search, ChevronDown, ChevronUp,
    CheckCircle2, AlertTriangle, Hash, BarChart3, Target, Filter,
    ArrowUpDown, Download, Layers, TrendingUp, Eye, Zap
} from 'lucide-react';
import { SnapshotKeywordRow } from '../types';
import { SimpleErrorBoundary } from '../components/SimpleErrorBoundary';
import { useProjectStore } from '../config/ProjectStore';
import { PlatformDB } from '../services/platformDB';

interface Props {
    categoryId: string;
}

// --- HELPERS ---
const fmt = (v: number) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `${(v / 1_000).toFixed(1)}K` : String(v);
const pct = (n: number, total: number) => total > 0 ? `${((n / total) * 100).toFixed(1)}%` : '0%';

// --- STAT CARD ---
const StatCard: React.FC<{ label: string; value: string | number; sub?: string; color?: string; icon?: React.ReactNode }> = ({ label, value, sub, color = '#334155', icon }) => (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
            {icon}
            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-400">{label}</span>
        </div>
        <div className="text-3xl font-black tracking-tight" style={{ color }}>{value}</div>
        {sub && <div className="text-[10px] text-slate-400 font-medium mt-1">{sub}</div>}
    </div>
);

// --- ANCHOR DISTRIBUTION BAR ---
const AnchorDistribution: React.FC<{ rows: SnapshotKeywordRow[] }> = ({ rows }) => {
    const stats = useMemo(() => {
        const map: Record<string, { total: number; valid: number; volume: number }> = {};
        rows.forEach(r => {
            const a = r.anchor_id || 'unknown';
            if (!map[a]) map[a] = { total: 0, valid: 0, volume: 0 };
            map[a].total++;
            if ((r.volume || 0) > 0) { map[a].valid++; map[a].volume += r.volume || 0; }
        });
        return Object.entries(map).sort((a, b) => b[1].volume - a[1].volume);
    }, [rows]);

    const totalVolume = stats.reduce((s, [, d]) => s + d.volume, 0);
    const colors = ['#4f46e5', '#0284c7', '#059669', '#d97706', '#dc2626', '#7c3aed', '#ec4899', '#0891b2'];

    if (stats.length === 0) return null;

    return (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
                <Layers className="w-4 h-4 text-indigo-500" />
                <span className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">Anchor Distribution</span>
                <span className="text-[10px] text-slate-400 ml-auto">{stats.length} anchors</span>
            </div>
            
            {/* Stacked bar */}
            <div className="h-3 rounded-full overflow-hidden flex bg-slate-100 mb-4">
                {stats.map(([name, d], i) => {
                    const w = totalVolume > 0 ? (d.volume / totalVolume) * 100 : (d.total / rows.length) * 100;
                    if (w < 0.5) return null;
                    return <div key={name} className="h-full" style={{ width: `${w}%`, backgroundColor: colors[i % colors.length] }} title={`${name}: ${w.toFixed(1)}%`} />;
                })}
            </div>

            <div className="space-y-2">
                {stats.map(([name, d], i) => (
                    <div key={name} className="flex items-center gap-3 text-xs">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: colors[i % colors.length] }} />
                        <span className="font-bold text-slate-700 flex-1 truncate">{name.replace(/_/g, ' ')}</span>
                        <span className="text-slate-500 tabular-nums">{d.total} kw</span>
                        <span className="font-bold text-slate-800 tabular-nums w-16 text-right">{d.valid > 0 ? fmt(d.volume) : '—'}</span>
                        <span className="text-slate-400 tabular-nums w-12 text-right">{d.valid}/{d.total}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

// --- INTENT MIX CARD ---
const IntentMixCard: React.FC<{ rows: SnapshotKeywordRow[] }> = ({ rows }) => {
    const stats = useMemo(() => {
        const map: Record<string, { count: number; volume: number; topKw: string; topVol: number }> = {};
        rows.forEach(r => {
            const intent = r.intent_bucket || 'UNKNOWN';
            if (!map[intent]) map[intent] = { count: 0, volume: 0, topKw: '', topVol: 0 };
            map[intent].count++;
            const vol = r.volume || 0;
            map[intent].volume += vol;
            if (vol > map[intent].topVol) { map[intent].topVol = vol; map[intent].topKw = r.keyword_text || ''; }
        });
        return Object.entries(map).sort((a, b) => b[1].volume - a[1].volume);
    }, [rows]);

    const totalVolume = stats.reduce((s, [, d]) => s + d.volume, 0);
    const intentColors: Record<string, string> = {
        TRANSACTIONAL: '#059669', COMMERCIAL: '#0284c7', INFORMATIONAL: '#7c3aed', NAVIGATIONAL: '#64748b',
        Decision: '#059669', Consideration: '#0284c7', Discovery: '#7c3aed', Need: '#d97706', Problem: '#dc2626', Care: '#ec4899',
    };

    return (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
                <Target className="w-4 h-4 text-violet-500" />
                <span className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">Intent Mix</span>
                <span className="text-[10px] text-slate-400 ml-auto">Total: {fmt(totalVolume)}</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
                {stats.map(([intent, d]) => {
                    const color = intentColors[intent] || '#64748b';
                    const share = totalVolume > 0 ? (d.volume / totalVolume) * 100 : 0;
                    return (
                        <div key={intent} className="p-3 rounded-xl border" style={{ borderColor: `${color}30`, backgroundColor: `${color}08` }}>
                            <div className="flex items-center justify-between mb-1">
                                <span className="text-[10px] font-black uppercase tracking-wider" style={{ color }}>{intent}</span>
                                <span className="text-lg font-black" style={{ color }}>{fmt(d.volume)}</span>
                            </div>
                            <div className="text-[10px] text-slate-500">{d.count} keywords · {share.toFixed(0)}%</div>
                            {d.topKw && <div className="text-[10px] text-slate-400 mt-1 truncate">Top: {d.topKw} ({fmt(d.topVol)})</div>}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

// --- KEYWORD TABLE ---
const KeywordTable: React.FC<{ rows: SnapshotKeywordRow[]; search: string }> = ({ rows, search }) => {
    const [page, setPage] = useState(1);
    const [sortBy, setSortBy] = useState<'volume' | 'keyword'>('volume');
    const pageSize = 50;

    const filtered = useMemo(() => {
        let r = [...rows];
        if (search) {
            const q = search.toLowerCase();
            r = r.filter(row => (row.keyword_text || '').toLowerCase().includes(q) || (row.anchor_id || '').toLowerCase().includes(q));
        }
        r.sort((a, b) => sortBy === 'volume' ? (b.volume || 0) - (a.volume || 0) : (a.keyword_text || '').localeCompare(b.keyword_text || ''));
        return r;
    }, [rows, search, sortBy]);

    const totalPages = Math.ceil(filtered.length / pageSize);
    const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);

    useEffect(() => { setPage(1); }, [search]);

    const statusBadge = (status: string) => {
        if (status === 'VALID') return <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 text-[9px] font-black rounded-full border border-emerald-200">VALID</span>;
        if (status === 'ZERO') return <span className="px-2 py-0.5 bg-slate-50 text-slate-400 text-[9px] font-black rounded-full border border-slate-200">ZERO</span>;
        return <span className="px-2 py-0.5 bg-amber-50 text-amber-600 text-[9px] font-black rounded-full border border-amber-200">{status}</span>;
    };

    return (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Hash className="w-4 h-4 text-slate-400" />
                    <span className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">Keywords</span>
                    <span className="text-[10px] text-slate-400">{filtered.length} of {rows.length}</span>
                </div>
                <div className="flex items-center gap-2">
                    <button onClick={() => setSortBy(sortBy === 'volume' ? 'keyword' : 'volume')} className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold text-slate-500 hover:text-slate-800 bg-slate-50 rounded-lg">
                        <ArrowUpDown className="w-3 h-3" /> {sortBy === 'volume' ? 'By Volume' : 'A-Z'}
                    </button>
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-left">
                    <thead className="bg-slate-50/80">
                        <tr className="border-b border-slate-100">
                            <th className="px-6 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Keyword</th>
                            <th className="px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Anchor</th>
                            <th className="px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest">Intent</th>
                            <th className="px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest text-right">Volume</th>
                            <th className="px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest text-right">Trend</th>
                            <th className="px-4 py-3 text-[9px] font-black text-slate-400 uppercase tracking-widest text-right">Status</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                        {pageRows.map((r, i) => (
                            <tr key={r.keyword_id || i} className="hover:bg-slate-50/50 transition-colors">
                                <td className="px-6 py-3 text-xs font-medium text-slate-800 max-w-xs truncate">{r.keyword_text || '—'}</td>
                                <td className="px-4 py-3 text-[10px] text-slate-500 truncate max-w-[140px]">{(r.anchor_id || '').replace(/_/g, ' ')}</td>
                                <td className="px-4 py-3">
                                    <span className="text-[9px] font-bold text-slate-500 uppercase">{r.intent_bucket || '—'}</span>
                                </td>
                                <td className="px-4 py-3 text-right font-mono text-xs font-bold text-slate-700">
                                    {(r.volume || 0) > 0 ? fmt(r.volume || 0) : '—'}
                                </td>
                                <td className="px-4 py-3 text-right">
                                    {r.demandScore !== undefined && r.demandScore !== null && Number.isFinite(r.demandScore) ? (
                                        <span className={`text-[10px] font-bold ${r.demandScore > 2 ? 'text-emerald-600' : r.demandScore < -2 ? 'text-red-500' : 'text-slate-400'}`}>
                                            {r.demandScore > 0 ? '+' : ''}{r.demandScore.toFixed(0)}%
                                        </span>
                                    ) : <span className="text-slate-300">—</span>}
                                </td>
                                <td className="px-4 py-3 text-right">{statusBadge(r.status || 'UNVERIFIED')}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Pagination */}
            <div className="px-6 py-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                <span>{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)} of {filtered.length}</span>
                <div className="flex items-center gap-1">
                    <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1} className="px-3 py-1 rounded-lg hover:bg-slate-100 disabled:opacity-30 font-bold">Prev</button>
                    <span className="px-2 font-bold">{page}/{totalPages}</span>
                    <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages} className="px-3 py-1 rounded-lg hover:bg-slate-100 disabled:opacity-30 font-bold">Next</button>
                </div>
            </div>
        </div>
    );
};

// --- MAIN COMPONENT ---
const CorpusInspectorView: React.FC<Props> = ({ categoryId }) => {
    const projectStore = useProjectStore();
    const isProjectMode = projectStore.hasProject;

    const [rows, setRows] = useState<SnapshotKeywordRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [buildProgress, setBuildProgress] = useState<{ phase: string; message: string; total: number; processed: number; valid: number; zero: number; elapsed: number } | null>(null);
    const [buildLog, setBuildLog] = useState<string[]>([]);
    const [building, setBuilding] = useState(false);

    // Corpus stats
    const stats = useMemo(() => {
        const total = rows.length;
        const valid = rows.filter(r => r.status === 'VALID').length;
        const zero = rows.filter(r => r.status === 'ZERO').length;
        const unverified = rows.filter(r => r.status === 'UNVERIFIED' || !r.status).length;
        const totalVolume = rows.reduce((s, r) => s + (r.volume || 0), 0);
        const avgVolume = valid > 0 ? Math.round(totalVolume / valid) : 0;
        const topKeyword = rows.filter(r => (r.volume || 0) > 0).sort((a, b) => (b.volume || 0) - (a.volume || 0))[0];
        
        // Corpus-level trend from per-keyword demandScore (DFS monthly_searches trend)
        const kwWithTrend = rows.filter(r => r.demandScore !== undefined && r.demandScore !== null && Number.isFinite(r.demandScore) && (r.volume || 0) > 0);
        let corpusTrend: number | null = null;
        let trendKeywords = 0;
        if (kwWithTrend.length >= 3) {
            const totalVol = kwWithTrend.reduce((s, r) => s + (r.volume || 1), 0);
            corpusTrend = parseFloat((kwWithTrend.reduce((s, r) => s + ((r.demandScore || 0) * (r.volume || 1)), 0) / totalVol).toFixed(1));
            trendKeywords = kwWithTrend.length;
        }
        
        return { total, valid, zero, unverified, totalVolume, avgVolume, topKeyword, corpusTrend, trendKeywords };
    }, [rows]);

    // Load data
    const loadData = async () => {
        setLoading(true);
        setError(null);
        try {
            if (isProjectMode) {
                const corpus = await PlatformDB.getCorpus(categoryId);
                if (corpus && corpus.rows && corpus.rows.length > 0) {
                    setRows(corpus.rows);
                } else {
                    setError('No corpus yet. Click "Build Corpus" to fetch keyword volumes from DataForSEO.');
                    setRows([]);
                }
            } else {
                // Legacy Firestore path
                const { SnapshotResolver } = await import('../services/snapshotResolver');
                const { CategorySnapshotStore } = await import('../services/categorySnapshotStore');
                const res = await SnapshotResolver.resolveActiveSnapshot(categoryId, 'IN', 'en');
                if (res.ok && res.snapshot) {
                    const rowsRes = await CategorySnapshotStore.readAllKeywordRows(
                        { categoryId, countryCode: 'IN', languageCode: 'en' },
                        res.snapshot.snapshot_id
                    );
                    if (rowsRes.ok) setRows(rowsRes.data);
                    else setError('Failed to read corpus rows');
                } else {
                    setError('No corpus snapshot found');
                }
            }
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadData(); }, [categoryId]);

    // Build corpus
    const handleBuild = async (force: boolean) => {
        if (!isProjectMode || !projectStore.project) return;
        setBuilding(true);
        setBuildProgress({ phase: 'STARTING', message: 'Initializing...', total: 0, processed: 0, valid: 0, zero: 0, elapsed: 0 });
        setBuildLog(['Initializing corpus build pipeline...']);
        try {
            const { ProjectCorpusBuilder } = await import('../services/projectCorpusBuilder');
            const result = await ProjectCorpusBuilder.buildCorpus(
                projectStore.project,
                { forceRebuild: force },
                (p) => {
                    setBuildProgress({
                        phase: p.phase,
                        message: p.message,
                        total: p.totalKeywords,
                        processed: p.processedKeywords,
                        valid: p.validKeywords,
                        zero: p.zeroKeywords,
                        elapsed: p.elapsedMs,
                    });
                    setBuildLog(prev => {
                        const line = `[${p.phase}] ${p.message}`;
                        // Update last line if same phase, otherwise add new
                        if (prev.length > 0 && prev[prev.length - 1].startsWith(`[${p.phase}]`)) {
                            return [...prev.slice(0, -1), line];
                        }
                        return [...prev, line];
                    });
                }
            );
            if (result.ok) {
                setBuildLog(prev => [...prev, `[DONE] Corpus built: ${result.totalRows} keywords (${result.validRows} valid, ${result.zeroRows} zero) in ${(result.elapsedMs / 1000).toFixed(1)}s`]);
                setBuildProgress(prev => prev ? { ...prev, phase: 'DONE', message: `${result.totalRows} keywords ready` } : null);
                await loadData();
            } else {
                setBuildLog(prev => [...prev, `[FAILED] ${result.error}`]);
                setBuildProgress(prev => prev ? { ...prev, phase: 'FAILED', message: result.error || 'Unknown error' } : null);
            }
        } catch (e: any) {
            setBuildLog(prev => [...prev, `[ERROR] ${e.message}`]);
            setBuildProgress(prev => prev ? { ...prev, phase: 'FAILED', message: e.message } : null);
        } finally {
            setBuilding(false);
        }
    };

    return (
        <SimpleErrorBoundary>
            <div className="space-y-6">
                {/* Header */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <h2 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-3">
                            <Database className="w-6 h-6 text-indigo-600" />
                            Corpus Inspector
                        </h2>
                        <p className="text-sm text-slate-500 mt-1">
                            {categoryId} · {stats.total} keywords · {stats.valid} DFS-verified
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        {isProjectMode && (
                            <>
                                <button 
                                    onClick={() => handleBuild(false)} 
                                    disabled={building}
                                    className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-indigo-700 disabled:opacity-50 shadow-sm transition-all"
                                >
                                    {building ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                                    {building ? 'Building...' : 'Build Corpus'}
                                </button>
                                <button 
                                    onClick={() => handleBuild(true)} 
                                    disabled={building}
                                    className="flex items-center gap-2 px-3 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl text-xs font-bold hover:bg-slate-50 disabled:opacity-50 transition-all"
                                    title="Force rebuild: re-fetch all volumes"
                                >
                                    <RefreshCw className="w-3.5 h-3.5" /> Rebuild
                                </button>
                            </>
                        )}
                        <button onClick={loadData} disabled={loading} className="p-2.5 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 disabled:opacity-50 transition-all">
                            {loading ? <Loader2 className="w-4 h-4 animate-spin text-slate-400" /> : <RefreshCw className="w-4 h-4 text-slate-400" />}
                        </button>
                    </div>
                </div>

                {/* Build Progress Panel */}
                {buildProgress && (
                    <div className="bg-slate-900 rounded-2xl overflow-hidden">
                        {/* Progress Header */}
                        <div className="px-5 pt-5 pb-3">
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                    {building ? <Loader2 className="w-4 h-4 animate-spin text-indigo-400" /> : buildProgress.phase === 'DONE' ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <AlertTriangle className="w-4 h-4 text-red-400" />}
                                    <span className="text-xs font-black uppercase tracking-wider text-white">
                                        {building ? 'Building Corpus' : buildProgress.phase === 'DONE' ? 'Build Complete' : 'Build Failed'}
                                    </span>
                                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 uppercase">{buildProgress.phase}</span>
                                </div>
                                <div className="flex items-center gap-4 text-[10px]">
                                    <span className="text-slate-400">{(buildProgress.elapsed / 1000).toFixed(1)}s</span>
                                    {buildProgress.valid > 0 && <span className="text-emerald-400 font-bold">{buildProgress.valid} valid</span>}
                                    {buildProgress.zero > 0 && <span className="text-slate-500">{buildProgress.zero} zero</span>}
                                </div>
                            </div>
                            
                            {/* Progress Bar */}
                            {building && buildProgress.total > 0 && (
                                <div className="h-2 bg-slate-800 rounded-full overflow-hidden mb-2">
                                    <div 
                                        className="h-full bg-gradient-to-r from-indigo-500 to-emerald-500 rounded-full transition-all duration-500 ease-out"
                                        style={{ width: `${Math.min(100, (buildProgress.processed / buildProgress.total) * 100)}%` }}
                                    />
                                </div>
                            )}
                            {building && buildProgress.total > 0 && (
                                <div className="flex items-center justify-between text-[10px] text-slate-500">
                                    <span>{buildProgress.processed} / {buildProgress.total} keywords processed</span>
                                    <span>{buildProgress.total > 0 ? Math.round((buildProgress.processed / buildProgress.total) * 100) : 0}%</span>
                                </div>
                            )}

                            {/* Live Stats */}
                            {(buildProgress.valid > 0 || buildProgress.zero > 0) && (
                                <div className="flex items-center gap-4 mt-3 pt-3 border-t border-slate-800">
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-2 h-2 rounded-full bg-emerald-500" />
                                        <span className="text-[10px] text-slate-400">Valid: <span className="text-emerald-400 font-bold">{buildProgress.valid}</span></span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-2 h-2 rounded-full bg-slate-600" />
                                        <span className="text-[10px] text-slate-400">Zero: <span className="text-slate-500 font-bold">{buildProgress.zero}</span></span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-2 h-2 rounded-full bg-indigo-500" />
                                        <span className="text-[10px] text-slate-400">Total: <span className="text-indigo-400 font-bold">{buildProgress.processed}</span></span>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Telemetry Log */}
                        {buildLog.length > 0 && (
                            <div className="px-5 pb-4 font-mono text-[10px] max-h-32 overflow-y-auto border-t border-slate-800 pt-3">
                                {buildLog.map((line, i) => (
                                    <div key={i} className={`py-0.5 ${line.includes('[DONE]') ? 'text-emerald-400' : line.includes('[FAILED]') || line.includes('[ERROR]') ? 'text-red-400' : 'text-slate-500'}`}>
                                        {line}
                                    </div>
                                ))}
                                {building && (
                                    <div className="py-0.5 text-indigo-400 animate-pulse">Processing...</div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* Error */}
                {error && !loading && (
                    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                        <div>
                            <p className="text-sm font-bold text-amber-800">{error}</p>
                            {isProjectMode && <p className="text-xs text-amber-600 mt-1">Use the "Build Corpus" button to fetch keyword volumes from DataForSEO.</p>}
                        </div>
                    </div>
                )}

                {/* Stats Row */}
                {rows.length > 0 && (
                    <>
                        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
                            <StatCard label="Total Keywords" value={stats.total} icon={<Hash className="w-4 h-4 text-slate-400" />} />
                            <StatCard label="DFS Verified" value={stats.valid} sub={pct(stats.valid, stats.total)} color="#059669" icon={<CheckCircle2 className="w-4 h-4 text-emerald-500" />} />
                            <StatCard label="Zero Volume" value={stats.zero} sub={pct(stats.zero, stats.total)} color="#94a3b8" icon={<AlertTriangle className="w-4 h-4 text-slate-400" />} />
                            <StatCard label="Total Volume" value={fmt(stats.totalVolume)} sub={`Avg: ${fmt(stats.avgVolume)}/kw`} color="#4f46e5" icon={<BarChart3 className="w-4 h-4 text-indigo-500" />} />
                            <StatCard 
                                label="Corpus Trend" 
                                value={stats.corpusTrend !== null ? `${stats.corpusTrend > 0 ? '+' : ''}${stats.corpusTrend}%` : '—'} 
                                sub={stats.trendKeywords > 0 ? `From ${stats.trendKeywords} keywords with monthly data` : 'Rebuild corpus for trend data'} 
                                color={stats.corpusTrend !== null ? (stats.corpusTrend > 2 ? '#059669' : stats.corpusTrend < -2 ? '#dc2626' : '#6b7280') : '#94a3b8'} 
                                icon={<TrendingUp className="w-4 h-4" style={{ color: stats.corpusTrend !== null && stats.corpusTrend > 0 ? '#059669' : '#dc2626' }} />} 
                            />
                            <StatCard 
                                label="Top Keyword" 
                                value={stats.topKeyword ? fmt(stats.topKeyword.volume || 0) : '—'} 
                                sub={stats.topKeyword?.keyword_text || 'No data'} 
                                color="#0284c7" 
                                icon={<TrendingUp className="w-4 h-4 text-sky-500" />} 
                            />
                        </div>

                        {/* Distribution Cards */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <AnchorDistribution rows={rows} />
                            <IntentMixCard rows={rows} />
                        </div>

                        {/* Search */}
                        <div className="relative">
                            <Search className="w-4 h-4 text-slate-400 absolute left-4 top-3.5" />
                            <input
                                type="text"
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                placeholder="Search keywords, anchors..."
                                className="w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-medium focus:ring-2 focus:ring-indigo-500 focus:border-transparent shadow-sm"
                            />
                        </div>

                        {/* Keyword Table */}
                        <KeywordTable rows={rows} search={search} />
                    </>
                )}

                {/* Loading */}
                {loading && rows.length === 0 && (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
                    </div>
                )}
            </div>
        </SimpleErrorBoundary>
    );
};

export default CorpusInspectorView;
