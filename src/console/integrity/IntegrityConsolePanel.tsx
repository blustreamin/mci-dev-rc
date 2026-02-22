import React, { useState, useEffect } from 'react';
import { 
    Loader2, Trash2, PlayCircle, Activity, BarChart3, FileText, Radio, 
    ChevronUp, ChevronDown, AlertTriangle, ShieldCheck, XCircle, CheckCircle2 
} from 'lucide-react';
import { CORE_CATEGORIES, INTERNAL_VERSION_TAG, INTERNAL_VERSION_STATUS } from '../../constants';
import { DateUtils } from '../../utils/dateUtils';
import { runIntegrityAudit } from '../../services/integrityRunner';
import { IntegrityAuditReport } from '../../services/integrityContract';
import { IntegrityConsoleService, V4IntegrityReport } from '../../services/integrityConsoleService';
import { CategoryRebuildService } from '../../services/categoryRebuildService';
import { CERTIFIED_BENCHMARK } from '../../certifiedBenchmark';
import { toReactText } from '../../utils/reactSafe';

// Helper Components
const StatusBadge: React.FC<{ ok: boolean, label: string }> = ({ ok, label }) => (
    <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase border ${ok ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-red-50 text-red-600 border-red-100'}`}>
        {label}
    </span>
);

const DetailRow: React.FC<{ label: string, value: any, sub?: string }> = ({ label, value, sub }) => (
    <div className="flex justify-between items-start text-xs border-b border-slate-50 last:border-0 pb-1 mb-1 last:pb-0 last:mb-0">
        <span className="text-slate-500 font-medium">{label}</span>
        <div className="text-right">
            <span className="font-mono font-bold text-slate-700">{toReactText(value)}</span>
            {sub && <div className="text-[9px] text-red-500">{sub}</div>}
        </div>
    </div>
);

const V4ReportCard: React.FC<{ report: V4IntegrityReport }> = ({ report }) => {
    const [expanded, setExpanded] = useState(false);
    const { checks, verdict, blockers } = report;
    const isGo = verdict === 'GO';

    return (
        <div className={`rounded-xl border shadow-sm overflow-hidden ${isGo ? 'bg-emerald-50/50 border-emerald-200' : 'bg-white border-slate-200'}`}>
            <div className="p-4 flex items-center justify-between cursor-pointer" onClick={() => setExpanded(!expanded)}>
                <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${isGo ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>
                        <Activity className="w-5 h-5"/>
                    </div>
                    <div>
                        <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest">V4 Integrity Check</h4>
                        <p className="text-xs text-slate-500 font-mono">{new Date(report.ts).toLocaleTimeString()} • {blockers.length} Blockers</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <span className={`text-xs font-black px-2 py-1 rounded ${isGo ? 'bg-emerald-200 text-emerald-800' : 'bg-red-200 text-red-800'}`}>
                        {verdict}
                    </span>
                    {expanded ? <ChevronUp className="w-4 h-4 text-slate-400"/> : <ChevronDown className="w-4 h-4 text-slate-400"/>}
                </div>
            </div>

            {expanded && (
                <div className="border-t border-slate-200 bg-white p-4 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Connectivity</h5>
                            <DetailRow label="Firestore Read" value={checks.firestore.readOk ? 'OK' : 'FAIL'} sub={checks.firestore.error}/>
                            <DetailRow label="Firestore Write" value={checks.firestore.writeOk ? 'OK' : 'FAIL'}/>
                            <DetailRow label="DataForSEO Creds" value={checks.creds.ok ? 'OK' : 'FAIL'} sub={checks.creds.details}/>
                        </div>
                        <div className="space-y-2">
                            <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Logic</h5>
                            <DetailRow label="Amazon API" value={checks.amazonApi.ok ? 'OK' : 'FAIL'} sub={checks.amazonApi.error}/>
                            <DetailRow label="Volume Cache" value={checks.cache.ok ? 'OK' : 'FAIL'}/>
                            <DetailRow label="Snapshot Compat" value={checks.snapshot.ok ? 'OK' : 'FAIL'} sub={checks.snapshot.error}/>
                        </div>
                    </div>
                    {blockers.length > 0 && (
                        <div className="bg-red-50 p-3 rounded border border-red-100 text-xs">
                            <div className="font-bold text-red-800 mb-1">Blocking Issues:</div>
                            <ul className="list-disc pl-4 text-red-700">
                                {blockers.map((b, i) => <li key={i}>{b}</li>)}
                            </ul>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

interface IntegrityConsolePanelProps {
    categoryId?: string;
    monthKey?: string;
}

export const IntegrityConsolePanel: React.FC<IntegrityConsolePanelProps> = ({ categoryId: propCategoryId, monthKey: propMonthKey }) => {
    
    // Log Wiring Contract on Mount
    useEffect(() => {
        const contract = {
            console: {
                v4Check: "IntegrityConsoleService.runV4IntegrityCheck",
                rebuild: "CategoryRebuildService.rebuildCategory -> V3 Pipeline",
                audit: "integrityRunner.runIntegrityAudit"
            },
            inspector: {
                validate: "CategoryKeywordGrowthService.validateSnapshot -> DataForSeoClient.fetchGoogleVolumes_DFS",
                amazonBoost: "CategoryKeywordGrowthService.amazonBoostBackfill -> DataForSeoClient.fetchAmazonKeywordVolumesLive",
                grow: "CategoryKeywordGrowthService.closeAnchorDeficitsV2 -> Rebuild V3 (LITE)"
            },
            diagnostics: {
                probe: "DebugValidationProbe.run -> DFS Google (Proxy/Direct)"
            }
        };
        console.log("[INTEGRITY_WIRING]", contract);
    }, []);

    const [categoryId, setCategoryId] = useState(propCategoryId || CORE_CATEGORIES[0].id);
    const [monthKey, setMonthKey] = useState(propMonthKey || DateUtils.getCurrentMonthKey());
    
    useEffect(() => {
        if (propCategoryId) setCategoryId(propCategoryId);
    }, [propCategoryId]);

    useEffect(() => {
        if (propMonthKey) setMonthKey(propMonthKey);
    }, [propMonthKey]);

    const [report, setReport] = useState<IntegrityAuditReport | null>(null);
    const [loading, setLoading] = useState(false);
    const [expandedSection, setExpandedSection] = useState<string | null>('signals');
    
    // V4 Check State
    const [v4Loading, setV4Loading] = useState(false);
    const [v4Report, setV4Report] = useState<V4IntegrityReport | null>(null);

    // Rebuild State
    const [rebuildLoading, setRebuildLoading] = useState(false);
    const [rebuildLogs, setRebuildLogs] = useState<string[]>([]);

    const runAudit = async () => {
        setLoading(true);
        try {
            const res = await runIntegrityAudit({ categoryId, monthKey });
            setReport(res);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleV4Check = async () => {
        setV4Loading(true);
        setV4Report(null);
        try {
            const res = await IntegrityConsoleService.runV4IntegrityCheck();
            setV4Report(res);
        } catch (e) {
            console.error("V4 Check Failed", e);
        } finally {
            setV4Loading(false);
        }
    };

    const handleRebuild = async () => {
        const cat = CORE_CATEGORIES.find(c => c.id === categoryId);
        const bench = CERTIFIED_BENCHMARK.categories[categoryId];
        const target = bench?.median.demandIndexMn || cat?.demandIndex || 0;

        if (!confirm(`FLUSH & REBUILD "${categoryId}"?\n\nTarget Demand: ${target} Mn\n\nThis will DELETE all snapshots for this category and rebuild from scratch. This action cannot be undone.`)) {
            return;
        }

        setRebuildLoading(true);
        setRebuildLogs([]);
        try {
            const res = await CategoryRebuildService.rebuildCategory({
                categoryId,
                monthKey,
                targetDemandMn: target
            });
            
            if (!res.ok) {
                setRebuildLogs(prev => [...prev, `ERROR: ${res.error}`]);
            } else {
                 setRebuildLogs(prev => [...prev, "SUCCESS: Category Rebuilt."]);
                 // Refresh audit
                 runAudit();
            }
        } catch (e: any) {
            setRebuildLogs(prev => [...prev, `EXCEPTION: ${e.message}`]);
        } finally {
            setRebuildLoading(false);
        }
    };

    const toggleSection = (s: string) => setExpandedSection(expandedSection === s ? null : s);

    return (
        <div className="space-y-6">
            <div className="flex justify-end">
                <div className="text-[10px] font-mono text-slate-400">
                    Build: {INTERNAL_VERSION_TAG} ({INTERNAL_VERSION_STATUS})
                </div>
            </div>

            {/* Controls */}
            <div className="flex flex-col md:flex-row items-start md:items-center gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="font-bold uppercase">Target:</span>
                    <span className="font-mono font-bold text-slate-800">{CORE_CATEGORIES.find(c => c.id === categoryId)?.category || categoryId}</span>
                    <span className="text-slate-300">|</span>
                    <span className="font-mono font-bold text-slate-800">{monthKey}</span>
                </div>
                
                <div className="flex items-center gap-2 ml-auto">
                    <button 
                        onClick={handleV4Check}
                        disabled={v4Loading || loading}
                        className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-xs font-bold hover:bg-slate-200 flex items-center gap-2 disabled:opacity-50 transition-colors"
                    >
                        {v4Loading ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Activity className="w-3.5 h-3.5"/>}
                        Run V4 Integrity Check
                    </button>

                    <button 
                        onClick={handleRebuild}
                        disabled={rebuildLoading || loading}
                        className="px-4 py-2 bg-white border border-rose-200 text-rose-700 rounded-lg text-xs font-bold hover:bg-rose-50 flex items-center gap-2 disabled:opacity-50 transition-colors"
                    >
                        {rebuildLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Trash2 className="w-3.5 h-3.5"/>}
                        Flush & Rebuild Category
                    </button>

                    <button 
                        onClick={runAudit}
                        disabled={loading || rebuildLoading}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-black uppercase tracking-widest hover:bg-indigo-700 flex items-center gap-2 disabled:opacity-50"
                    >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin"/> : <PlayCircle className="w-4 h-4"/>}
                        Run Deep Dive Audit
                    </button>
                </div>
            </div>

            {/* V4 Report */}
            {v4Report && <V4ReportCard report={v4Report} />}

            {/* Rebuild Logs */}
            {rebuildLogs.length > 0 && (
                <div className="bg-slate-900 rounded-xl p-4 font-mono text-[10px] text-slate-300 max-h-40 overflow-y-auto">
                    <div className="text-slate-500 border-b border-slate-700 pb-1 mb-1">Rebuild Transaction Log</div>
                    {rebuildLogs.map((l, i) => <div key={i}>{l}</div>)}
                </div>
            )}

            {/* Empty State Guidance */}
            {!report && !v4Report && !loading && !v4Loading && !rebuildLoading && (
                <div className="bg-white rounded-xl border-2 border-dashed border-slate-200 p-12 text-center">
                    <div className="flex justify-center mb-4">
                        <div className="p-4 bg-slate-50 rounded-2xl">
                            <ShieldCheck className="w-10 h-10 text-slate-300"/>
                        </div>
                    </div>
                    <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest mb-2">
                        No Audit Running
                    </h3>
                    <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                        Select a category and month from the header, then click <strong className="text-slate-600">Run Deep Dive Audit</strong> to probe demand snapshots, keyword corpus, signals plumbing, and deep dive output integrity for the selected scope.
                    </p>
                </div>
            )}

            {/* Results */}
            {report && (
                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2">
                    {/* Verdict Card */}
                    <div className={`p-6 rounded-xl border flex items-center justify-between shadow-sm ${
                        report.verdict === 'GO' ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'
                    }`}>
                        <div className="flex items-center gap-4">
                            <div className={`p-3 rounded-full ${report.verdict === 'GO' ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}`}>
                                {report.verdict === 'GO' ? <ShieldCheck className="w-8 h-8"/> : <XCircle className="w-8 h-8"/>}
                            </div>
                            <div>
                                <h2 className={`text-2xl font-black tracking-tight ${report.verdict === 'GO' ? 'text-emerald-900' : 'text-red-900'}`}>
                                    {report.verdict}
                                </h2>
                                <p className={`text-xs font-bold uppercase tracking-widest ${report.verdict === 'GO' ? 'text-emerald-700' : 'text-red-700'}`}>
                                    Integrity Contract Status
                                </p>
                            </div>
                        </div>
                        <div className="text-right">
                            <div className="text-xs font-mono text-slate-500 mb-1">{new Date(report.ts).toLocaleTimeString()}</div>
                            <div className="flex gap-2">
                                {report.blockers.length > 0 && <span className="text-xs font-bold text-red-600 bg-white px-2 py-1 rounded border border-red-100">{report.blockers.length} Blockers</span>}
                                {report.warnings.length > 0 && <span className="text-xs font-bold text-amber-600 bg-white px-2 py-1 rounded border border-amber-100">{report.warnings.length} Warnings</span>}
                            </div>
                        </div>
                    </div>

                    {/* Blockers List */}
                    {report.blockers.length > 0 && (
                        <div className="bg-white rounded-xl border border-red-100 p-4 shadow-sm">
                            <h4 className="text-xs font-black text-red-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4"/> Blockers Detected
                            </h4>
                            <ul className="space-y-2">
                                {report.blockers.map((b, i) => (
                                    <li key={i} className="text-xs bg-red-50 p-2 rounded border border-red-100">
                                        <div className="font-bold text-red-800">{b.code}: {b.message}</div>
                                        <div className="text-[10px] text-red-600 mt-1 flex gap-2">
                                            <span className="font-bold">Fix:</span> {b.remediation.join(', ')}
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Sections */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Demand & Keywords */}
                        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                            <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
                                <h4 className="text-xs font-bold text-slate-700 flex items-center gap-2">
                                    <BarChart3 className="w-4 h-4 text-blue-500"/> Demand & Keywords
                                </h4>
                                <div className="flex gap-2">
                                    <StatusBadge ok={report.probes.demand.ok} label="DEMAND" />
                                    <StatusBadge ok={report.probes.keywords.ok} label="KW" />
                                </div>
                            </div>
                            <div className="p-4 space-y-4">
                                <div>
                                    <div className="text-[10px] font-bold text-slate-400 uppercase mb-2">Demand Snapshot</div>
                                    <DetailRow label="ID" value={report.probes.demand.snapshotId || 'MISSING'} />
                                    <DetailRow label="Metrics Ready" value={report.probes.demand.metricsPresent ? 'YES' : 'NO'} />
                                </div>
                                <div>
                                    <div className="text-[10px] font-bold text-slate-400 uppercase mb-2">Keyword Corpus</div>
                                    <DetailRow label="ID" value={report.probes.keywords.snapshotId || 'MISSING'} />
                                    <DetailRow label="Rows" value={report.probes.keywords.rows ?? 0} />
                                </div>
                            </div>
                        </div>

                        {/* Deep Dive Output */}
                        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                            <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
                                <h4 className="text-xs font-bold text-slate-700 flex items-center gap-2">
                                    <FileText className="w-4 h-4 text-violet-500"/> Deep Dive Output
                                </h4>
                                <StatusBadge ok={report.probes.deepDive.outputShapeOk} label="SHAPE" />
                            </div>
                            <div className="p-4 space-y-2">
                                <DetailRow label="Contract Enabled" value={report.probes.deepDive.contractEnabled ? 'YES' : 'NO'} />
                                <DetailRow label="Last Run ID" value={report.probes.deepDive.lastRunPointer.runId || 'NONE'} />
                                {report.probes.deepDive.missingSections.length > 0 && (
                                    <div className="mt-2 p-2 bg-amber-50 rounded border border-amber-100 text-[10px]">
                                        <span className="font-bold text-amber-700">Missing Sections:</span>
                                        <div className="text-amber-600 mt-1">{report.probes.deepDive.missingSections.join(', ')}</div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Signals Deep Dive */}
                    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                        <button 
                            onClick={() => toggleSection('signals')}
                            className="w-full px-4 py-3 bg-slate-50 border-b border-slate-100 flex justify-between items-center hover:bg-slate-100"
                        >
                            <h4 className="text-xs font-bold text-slate-700 flex items-center gap-2">
                                <Radio className="w-4 h-4 text-rose-500"/> Signals Plumbing
                            </h4>
                            <div className="flex items-center gap-3">
                                <div className="text-[10px] font-mono text-slate-500">
                                    Used: {report.probes.signals.used} (Trust: {report.probes.signals.trustedUsed})
                                </div>
                                <StatusBadge ok={report.probes.signals.ok} label="SIGNALS" />
                                {expandedSection === 'signals' ? <ChevronUp className="w-4 h-4 text-slate-400"/> : <ChevronDown className="w-4 h-4 text-slate-400"/>}
                            </div>
                        </button>
                        
                        {expandedSection === 'signals' && (
                            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div className="space-y-1">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase mb-2">Probe Chain</div>
                                    <DetailRow label="Mode" value={report.probes.signals.mode} />
                                    <DetailRow label="Collection" value={report.probes.signals.collection} />
                                    <DetailRow label="Canonical Index" value={report.probes.signals.requiredIndexOk ? 'OK' : 'MISSING'} sub={report.probes.signals.indexError} />
                                    <div className="mt-2 text-[10px] text-slate-500 bg-slate-50 p-2 rounded font-mono">
                                        Query Plan:
                                        <ul className="list-disc pl-4 mt-1 space-y-1">
                                            {report.probes.signals.queryPlan.map((q, i) => <li key={i}>{q}</li>)}
                                        </ul>
                                    </div>
                                </div>

                                <div className="space-y-1">
                                    <div className="text-[10px] font-bold text-slate-400 uppercase mb-2">Data Quality</div>
                                    <DetailRow label="Sampled" value={report.probes.signals.sampled} />
                                    <DetailRow label="Trusted Used" value={report.probes.signals.trustedUsed} sub={`Min Req: 20`} />
                                    <DetailRow label="Enriched Used" value={report.probes.signals.enrichedUsed} />
                                    <div className="mt-2">
                                        <div className="text-[10px] font-bold text-slate-500 mb-1">Schema Validation</div>
                                        <div className="grid grid-cols-3 gap-2">
                                            <StatusBadge ok={report.probes.signals.schemaCheck.categoryIdOk} label="CAT_ID" />
                                            <StatusBadge ok={report.probes.signals.schemaCheck.trustedOk} label="TRUSTED" />
                                            <StatusBadge ok={report.probes.signals.schemaCheck.lastSeenAtOk} label="TIME" />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};