
import React, { useState, useEffect } from 'react';
import { Microscope, Loader2, Zap, CheckCircle2, AlertTriangle, ChevronDown, ChevronUp, Target, TrendingUp, Users, Lightbulb, Package, Map, Globe, BarChart3, Layers, FileText, Radio } from 'lucide-react';
import { useProjectStore } from '../config/ProjectStore';
import { ProjectDeepDiveService, ProjectDeepDiveResult, DeepDiveSection, DeepDiveProgress } from '../services/projectDeepDiveService';
import { SimpleErrorBoundary } from '../components/SimpleErrorBoundary';

// --- SECTION RENDERER ---
const Section: React.FC<{ section: DeepDiveSection; icon?: React.ReactNode; defaultOpen?: boolean }> = ({ section, icon, defaultOpen = false }) => {
    const [open, setOpen] = useState(defaultOpen);
    if (!section?.bullets?.length) return null;
    return (
        <div className="border border-slate-200 rounded-2xl overflow-hidden">
            <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between p-5 hover:bg-slate-50 transition-colors text-left">
                <div className="flex items-center gap-3">
                    {icon}
                    <span className="font-black text-slate-900 text-sm uppercase tracking-wide">{section.title}</span>
                    <span className="text-[10px] text-slate-400 font-bold">{section.bullets.length} insights</span>
                </div>
                {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </button>
            {open && (
                <div className="px-5 pb-5 border-t border-slate-100">
                    <ul className="space-y-3 mt-4">
                        {section.bullets.map((b, i) => (
                            <li key={i} className="flex gap-3 text-sm text-slate-700 leading-relaxed">
                                <span className="text-indigo-400 font-black text-xs mt-0.5 shrink-0">{i + 1}</span>
                                <span>{b}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};

// --- MAIN VIEW ---
export const DeepDiveView: React.FC = () => {
    const projectStore = useProjectStore();
    const project = projectStore.project;
    const categories = projectStore.categories;
    const categoryId = categories[0]?.id || '';
    const categoryName = categories[0]?.category || '';

    const [report, setReport] = useState<ProjectDeepDiveResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState<DeepDiveProgress | null>(null);
    const [progressLog, setProgressLog] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);

    // Load cached report
    useEffect(() => {
        if (!categoryId) return;
        ProjectDeepDiveService.getCachedDeepDive(categoryId).then(cached => {
            if (cached) setReport(cached);
        });
    }, [categoryId]);

    const handleGenerate = async () => {
        if (!project || !categoryId) return;
        setLoading(true);
        setError(null);
        setProgress(null);
        setProgressLog([]);

        const res = await ProjectDeepDiveService.generateDeepDive(project, categoryId, (p) => {
            setProgress(p);
            setProgressLog(prev => {
                const line = `[${p.phase}] ${p.message}`;
                if (prev.length > 0 && prev[prev.length - 1].startsWith(`[${p.phase}]`)) return [...prev.slice(0, -1), line];
                return [...prev, line];
            });
        });

        if (res.ok && res.result) {
            setReport(res.result);
            setProgressLog(prev => [...prev, '[DONE] Deep dive report generated']);
        } else {
            setError(res.error || 'Generation failed');
            setProgressLog(prev => [...prev, `[FAILED] ${res.error}`]);
        }
        setLoading(false);
    };

    if (!projectStore.hasProject) {
        return (
            <div className="max-w-4xl mx-auto px-4 py-20 text-center">
                <Microscope className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                <p className="text-lg font-bold text-slate-400">Create a project to generate deep dives</p>
            </div>
        );
    }

    return (
        <SimpleErrorBoundary>
            <div className="max-w-5xl mx-auto px-4 pb-20">
                {/* Header */}
                <div className="pt-4 mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-3">
                            <Microscope className="w-6 h-6 text-indigo-600" /> Category Deep Dive
                        </h1>
                        <p className="text-sm text-slate-500 mt-1">{categoryName} — {project?.geo.countryName}</p>
                    </div>
                    <button onClick={handleGenerate} disabled={loading} className="flex items-center gap-2 px-5 py-3 bg-indigo-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-indigo-700 disabled:opacity-50 shadow-sm transition-all">
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                        {loading ? 'Generating...' : report ? 'Regenerate Deep Dive' : 'Generate Deep Dive'}
                    </button>
                </div>

                {/* Progress Panel */}
                {progressLog.length > 0 && (
                    <div className="bg-slate-900 rounded-2xl overflow-hidden mb-6">
                        {progress && loading && (
                            <div className="px-5 pt-4 pb-2">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                                        <span className="text-xs font-bold text-white">{progress.phase}</span>
                                    </div>
                                    <span className="text-[10px] text-indigo-400 font-bold">{progress.pct}%</span>
                                </div>
                                <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                    <div className="h-full bg-gradient-to-r from-indigo-500 to-emerald-500 rounded-full transition-all duration-700" style={{ width: `${progress.pct}%` }} />
                                </div>
                            </div>
                        )}
                        {!loading && progressLog.length > 0 && (
                            <div className="px-5 pt-4 pb-2 flex items-center gap-2">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                <span className="text-xs font-bold text-emerald-400">Deep Dive Complete</span>
                                <button onClick={() => setProgressLog([])} className="ml-auto text-[10px] text-slate-500 hover:text-slate-300">Dismiss</button>
                            </div>
                        )}
                        <div className="px-5 pb-3 font-mono text-[10px] max-h-28 overflow-y-auto">
                            {progressLog.map((line, i) => (
                                <div key={i} className={`py-0.5 ${line.includes('[DONE]') ? 'text-emerald-400' : line.includes('[FAILED]') ? 'text-red-400' : 'text-slate-500'}`}>{line}</div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Error */}
                {error && (
                    <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                        <div>
                            <p className="font-bold text-red-700 text-sm">Generation Failed</p>
                            <p className="text-red-600 text-xs mt-1">{error}</p>
                        </div>
                    </div>
                )}

                {/* Report */}
                {report && (
                    <div className="space-y-4">
                        {/* Input Coverage Banner */}
                        <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200 text-[10px] font-bold text-slate-500">
                            <span>Corpus: <span className="text-indigo-600">{report.inputCoverage.corpusKeywords} keywords</span></span>
                            <span>Demand: <span className={report.inputCoverage.demandMetrics ? 'text-emerald-600' : 'text-red-500'}>{report.inputCoverage.demandMetrics ? 'Available' : 'Missing'}</span></span>
                            <span>Signals: <span className={report.inputCoverage.signalsCount > 0 ? 'text-emerald-600' : 'text-amber-500'}>{report.inputCoverage.signalsCount}</span></span>
                            <span className="ml-auto text-slate-400">Generated {new Date(report.generatedAt).toLocaleString()}</span>
                        </div>

                        {/* Executive Summary */}
                        <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl p-8 text-white">
                            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-400 mb-3">Executive Summary</div>
                            <h2 className="text-xl font-black tracking-tight mb-6">{report.executiveSummary.title}</h2>
                            <div className="space-y-3">
                                {report.executiveSummary.bullets.map((b, i) => (
                                    <p key={i} className="text-sm text-slate-300 leading-relaxed">{b}</p>
                                ))}
                            </div>
                        </div>

                        {/* Market Structure with metrics */}
                        <div className="bg-white border border-slate-200 rounded-2xl p-6">
                            <div className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 mb-4 flex items-center gap-2">
                                <BarChart3 className="w-4 h-4 text-indigo-500" /> Market Structure
                            </div>
                            <div className="grid grid-cols-4 gap-4 mb-6">
                                <div className="text-center p-3 bg-slate-50 rounded-xl">
                                    <div className="text-2xl font-black text-slate-900">{report.marketStructure.demandIndex.toFixed(2)}</div>
                                    <div className="text-[9px] text-slate-500 font-bold uppercase">Mn Searches</div>
                                </div>
                                <div className="text-center p-3 bg-slate-50 rounded-xl">
                                    <div className="text-2xl font-black text-indigo-600">{report.marketStructure.readiness.toFixed(1)}</div>
                                    <div className="text-[9px] text-slate-500 font-bold uppercase">Readiness /10</div>
                                </div>
                                <div className="text-center p-3 bg-slate-50 rounded-xl">
                                    <div className="text-2xl font-black text-sky-600">{report.marketStructure.spread.toFixed(1)}</div>
                                    <div className="text-[9px] text-slate-500 font-bold uppercase">Spread /10</div>
                                </div>
                                <div className="text-center p-3 bg-slate-50 rounded-xl">
                                    <div className={`text-2xl font-black ${report.marketStructure.trend > 0 ? 'text-emerald-600' : 'text-red-500'}`}>{report.marketStructure.trend > 0 ? '+' : ''}{report.marketStructure.trend}%</div>
                                    <div className="text-[9px] text-slate-500 font-bold uppercase">Trend</div>
                                </div>
                            </div>
                            <ul className="space-y-2">
                                {report.marketStructure.bullets.map((b, i) => (
                                    <li key={i} className="flex gap-3 text-sm text-slate-700 leading-relaxed">
                                        <span className="text-indigo-400 font-black text-xs mt-0.5 shrink-0">{i + 1}</span>
                                        <span>{b}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {/* Strategic Opportunities */}
                        {report.strategicOpportunities.length > 0 && (
                            <div className="bg-white border border-slate-200 rounded-2xl p-6">
                                <div className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-400 mb-4 flex items-center gap-2">
                                    <Lightbulb className="w-4 h-4 text-amber-500" /> Strategic Opportunities
                                    <span className="text-slate-400 font-normal ml-1">{report.strategicOpportunities.length}</span>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {report.strategicOpportunities.map((opp, i) => (
                                        <div key={i} className="p-4 border border-slate-100 rounded-xl hover:border-indigo-200 transition-colors">
                                            <h4 className="font-bold text-sm text-slate-900 mb-1">{opp.title}</h4>
                                            <p className="text-xs text-slate-600 mb-2">{opp.description}</p>
                                            <p className="text-[10px] text-indigo-600 font-bold">Strategy: {opp.strategy}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Collapsible Sections */}
                        <Section section={report.consumerNeeds} icon={<Users className="w-4 h-4 text-emerald-500" />} defaultOpen />
                        <Section section={report.behavioursRituals} icon={<Target className="w-4 h-4 text-purple-500" />} />
                        <Section section={report.triggersBarriers} icon={<Layers className="w-4 h-4 text-orange-500" />} />
                        <Section section={report.brandMeaning} icon={<Globe className="w-4 h-4 text-blue-500" />} />
                        <Section section={report.ingredientsAtPlay} icon={<Package className="w-4 h-4 text-teal-500" />} />
                        <Section section={report.packagingPricing} icon={<FileText className="w-4 h-4 text-pink-500" />} />
                        <Section section={report.regionalNuances} icon={<Map className="w-4 h-4 text-amber-500" />} />
                        <Section section={report.influencerEcosystem} icon={<Radio className="w-4 h-4 text-red-500" />} />
                        <Section section={report.measurementPlan} icon={<TrendingUp className="w-4 h-4 text-indigo-500" />} />
                    </div>
                )}

                {/* Empty State */}
                {!report && !loading && (
                    <div className="text-center py-20 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
                        <Microscope className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                        <p className="text-lg font-bold text-slate-400 mb-2">No Deep Dive report yet</p>
                        <p className="text-sm text-slate-400 mb-6">Generate a comprehensive category analysis using corpus, demand, and signal data.</p>
                        <button onClick={handleGenerate} className="px-6 py-3 bg-indigo-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-indigo-700">
                            <Zap className="w-4 h-4 inline mr-2" /> Generate Deep Dive
                        </button>
                    </div>
                )}
            </div>
        </SimpleErrorBoundary>
    );
};
