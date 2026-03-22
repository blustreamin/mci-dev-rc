
import React, { useState, useEffect } from 'react';
import { Rocket, Loader2, Zap, CheckCircle2, AlertTriangle, ChevronDown, ChevronUp, Target, TrendingUp, BarChart3, Calendar, ShieldAlert, Users, Package, Layers, FileText, Radio } from 'lucide-react';
import { useProjectStore } from '../config/ProjectStore';
import { ProjectPlaybookService, ProjectPlaybookResult, PlaybookSection, PlaybookProgress } from '../services/projectPlaybookService';
import { SimpleErrorBoundary } from '../components/SimpleErrorBoundary';

const PRIORITY_COLORS: Record<string, string> = {
    HIGH: 'bg-red-50 text-red-700 border-red-200',
    MEDIUM: 'bg-amber-50 text-amber-700 border-amber-200',
    LOW: 'bg-slate-50 text-slate-500 border-slate-200',
};

const PbSection: React.FC<{ section: PlaybookSection; icon?: React.ReactNode; defaultOpen?: boolean }> = ({ section, icon, defaultOpen = false }) => {
    const [open, setOpen] = useState(defaultOpen);
    if (!section?.items?.length) return null;
    return (
        <div className="border border-slate-200 rounded-2xl overflow-hidden">
            <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between p-5 hover:bg-slate-50 transition-colors text-left">
                <div className="flex items-center gap-3">
                    {icon}
                    <span className="font-black text-slate-900 text-sm uppercase tracking-wide">{section.title}</span>
                    <span className="text-[10px] text-slate-400 font-bold">{section.items.length} items</span>
                </div>
                {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
            </button>
            {open && (
                <div className="px-5 pb-5 border-t border-slate-100">
                    <div className="space-y-3 mt-4">
                        {section.items.map((item, i) => (
                            <div key={i} className="flex gap-4 p-4 bg-slate-50/50 rounded-xl border border-slate-100">
                                <span className="text-indigo-400 font-black text-xs mt-1 shrink-0">{i + 1}</span>
                                <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                        <h4 className="font-bold text-sm text-slate-900">{item.title}</h4>
                                        {item.priority && (
                                            <span className={`px-2 py-0.5 rounded text-[9px] font-black border ${PRIORITY_COLORS[item.priority] || PRIORITY_COLORS.MEDIUM}`}>
                                                {item.priority}
                                            </span>
                                        )}
                                        {item.timeline && (
                                            <span className="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded text-[9px] font-bold">{item.timeline}</span>
                                        )}
                                    </div>
                                    <p className="text-xs text-slate-600 leading-relaxed">{item.description}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export const ProjectPlaybookView: React.FC = () => {
    const projectStore = useProjectStore();
    const project = projectStore.project;
    const categories = projectStore.categories;
    const categoryId = categories[0]?.id || '';
    const categoryName = categories[0]?.category || '';

    const [playbook, setPlaybook] = useState<ProjectPlaybookResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState<PlaybookProgress | null>(null);
    const [progressLog, setProgressLog] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!categoryId) return;
        ProjectPlaybookService.getCachedPlaybook(categoryId).then(cached => {
            if (cached) setPlaybook(cached);
        });
    }, [categoryId]);

    const handleGenerate = async () => {
        if (!project || !categoryId) return;
        setLoading(true);
        setError(null);
        setProgress(null);
        setProgressLog([]);

        const res = await ProjectPlaybookService.generatePlaybook(project, categoryId, (p) => {
            setProgress(p);
            setProgressLog(prev => {
                const line = `[${p.phase}] ${p.message}`;
                if (prev.length > 0 && prev[prev.length - 1].startsWith(`[${p.phase}]`)) return [...prev.slice(0, -1), line];
                return [...prev, line];
            });
        });

        if (res.ok && res.result) {
            setPlaybook(res.result);
            setProgressLog(prev => [...prev, '[DONE] Playbook generated']);
        } else {
            setError(res.error || 'Generation failed');
            setProgressLog(prev => [...prev, `[FAILED] ${res.error}`]);
        }
        setLoading(false);
    };

    if (!projectStore.hasProject) {
        return (
            <div className="max-w-4xl mx-auto px-4 py-20 text-center">
                <Rocket className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                <p className="text-lg font-bold text-slate-400">Create a project to generate a playbook</p>
            </div>
        );
    }

    return (
        <SimpleErrorBoundary>
            <div className="max-w-5xl mx-auto px-4 pb-20">
                <div className="pt-4 mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-3">
                            <Rocket className="w-6 h-6 text-indigo-600" /> GTM Playbook
                        </h1>
                        <p className="text-sm text-slate-500 mt-1">{categoryName} — {project?.geo.countryName}</p>
                    </div>
                    <button onClick={handleGenerate} disabled={loading} className="flex items-center gap-2 px-5 py-3 bg-indigo-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-indigo-700 disabled:opacity-50 shadow-sm transition-all">
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                        {loading ? 'Generating...' : playbook ? 'Regenerate Playbook' : 'Generate Playbook'}
                    </button>
                </div>

                {/* Progress */}
                {progressLog.length > 0 && (
                    <div className="bg-slate-900 rounded-2xl overflow-hidden mb-6">
                        {progress && loading && (
                            <div className="px-5 pt-4 pb-2">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-xs font-bold text-white flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />{progress.phase}</span>
                                    <span className="text-[10px] text-indigo-400 font-bold">{progress.pct}%</span>
                                </div>
                                <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-indigo-500 to-emerald-500 rounded-full transition-all duration-700" style={{ width: `${progress.pct}%` }} /></div>
                            </div>
                        )}
                        {!loading && progressLog.length > 0 && (
                            <div className="px-5 pt-4 pb-2 flex items-center gap-2">
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                <span className="text-xs font-bold text-emerald-400">Playbook Complete</span>
                                <button onClick={() => setProgressLog([])} className="ml-auto text-[10px] text-slate-500 hover:text-slate-300">Dismiss</button>
                            </div>
                        )}
                        <div className="px-5 pb-3 font-mono text-[10px] max-h-24 overflow-y-auto">
                            {progressLog.map((line, i) => (
                                <div key={i} className={`py-0.5 ${line.includes('[DONE]') ? 'text-emerald-400' : line.includes('[FAILED]') ? 'text-red-400' : 'text-slate-500'}`}>{line}</div>
                            ))}
                        </div>
                    </div>
                )}

                {error && (
                    <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
                        <p className="text-sm text-red-700">{error}</p>
                    </div>
                )}

                {playbook && (
                    <div className="space-y-4">
                        {/* Input Coverage */}
                        <div className="flex items-center gap-4 p-3 bg-slate-50 rounded-xl border border-slate-200 text-[10px] font-bold text-slate-500">
                            <span>Corpus: <span className="text-indigo-600">{playbook.inputCoverage.corpus} kw</span></span>
                            <span>Demand: <span className={playbook.inputCoverage.demand ? 'text-emerald-600' : 'text-red-500'}>{playbook.inputCoverage.demand ? '✓' : '✗'}</span></span>
                            <span>Signals: <span className="text-indigo-600">{playbook.inputCoverage.signals}</span></span>
                            <span>Deep Dive: <span className={playbook.inputCoverage.deepDive ? 'text-emerald-600' : 'text-amber-500'}>{playbook.inputCoverage.deepDive ? '✓' : '—'}</span></span>
                            <span className="ml-auto text-slate-400">{new Date(playbook.generatedAt).toLocaleString()}</span>
                        </div>

                        {/* Executive Brief */}
                        <div className="bg-gradient-to-br from-slate-900 to-indigo-900 rounded-2xl p-8 text-white">
                            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-400 mb-3">Executive Brief</div>
                            <p className="text-sm leading-relaxed text-slate-200">{playbook.executiveBrief}</p>
                        </div>

                        {/* Sections */}
                        <PbSection section={playbook.first90Days} icon={<Calendar className="w-4 h-4 text-indigo-500" />} defaultOpen />
                        <PbSection section={playbook.gtmStrategy} icon={<Rocket className="w-4 h-4 text-violet-500" />} defaultOpen />
                        <PbSection section={playbook.channelPlan} icon={<Layers className="w-4 h-4 text-sky-500" />} />
                        <PbSection section={playbook.contentStrategy} icon={<FileText className="w-4 h-4 text-emerald-500" />} />
                        <PbSection section={playbook.pricingPackaging} icon={<Package className="w-4 h-4 text-amber-500" />} />
                        <PbSection section={playbook.kpis} icon={<TrendingUp className="w-4 h-4 text-indigo-500" />} />
                        <PbSection section={playbook.riskMitigation} icon={<ShieldAlert className="w-4 h-4 text-red-500" />} />
                        <PbSection section={playbook.competitiveResponse} icon={<Target className="w-4 h-4 text-orange-500" />} />
                    </div>
                )}

                {!playbook && !loading && (
                    <div className="text-center py-20 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
                        <Rocket className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                        <p className="text-lg font-bold text-slate-400 mb-2">No playbook yet</p>
                        <p className="text-sm text-slate-400 mb-6">Generate a GTM strategy using corpus, demand, signals, and deep dive data.</p>
                        <button onClick={handleGenerate} className="px-6 py-3 bg-indigo-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-indigo-700">
                            <Zap className="w-4 h-4 inline mr-2" /> Generate Playbook
                        </button>
                    </div>
                )}
            </div>
        </SimpleErrorBoundary>
    );
};
