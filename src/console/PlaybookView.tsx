
import React, { useMemo } from 'react';
import { 
    Layout, MessageSquare, Target, Calendar, 
    Zap, Rocket, Quote, AlertTriangle, Loader2, ShieldAlert, Sparkles,
    ListChecks, ShieldCheck
} from 'lucide-react';
import { PlaybookResult } from '../types';
import { validatePlaybookV1 } from '../contracts/playbookContract';
import { normalizePlaybookResult, toReactText } from '../utils/reactSafe';

interface PlaybookViewProps {
    data: PlaybookResult;
    status?: 'Pending' | 'Running' | 'Success' | 'Failed';
}

const PlaybookSection: React.FC<{ title: string; icon: any; color: string; children: React.ReactNode }> = ({ title, icon: Icon, color, children }) => (
    <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden mb-8 hover:shadow-md transition-shadow">
        <div className={`px-8 py-6 border-b border-slate-100 bg-${color}-50/30 flex items-center gap-4`}>
            <div className={`p-2 rounded-xl bg-white border border-${color}-100 text-${color}-600 shadow-sm`}>
                <Icon className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">{title}</h3>
        </div>
        <div className="p-8">
            {children}
        </div>
    </div>
);

export const PlaybookView: React.FC<PlaybookViewProps> = ({ data, status = 'Success' }) => {
    
    // Normalize data structure to ensure arrays of strings for rendering
    const safeData = useMemo(() => normalizePlaybookResult(data), [data]);

    const contractResult = useMemo(() => {
        if (!safeData || status !== 'Success') return { ok: false, errors: [] };
        return validatePlaybookV1(safeData);
    }, [safeData, status]);

    if (status === 'Running' || status === 'Pending') {
        return (
            <div className="py-24 text-center bg-white rounded-3xl border-2 border-dashed border-slate-200 animate-pulse">
                <Loader2 className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
                <p className="text-slate-500 font-bold uppercase tracking-widest text-xs">Synthesizing Strategic Playbook...</p>
            </div>
        );
    }

    if (status === 'Failed' || !safeData) {
        return (
            <div className="bg-red-50 border border-red-200 rounded-3xl p-12 text-center animate-in fade-in">
                <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
                <h3 className="text-xl font-black text-red-900 mb-2">Playbook Synthesis Interrupted</h3>
                <p className="text-sm text-red-700 font-medium mb-6">Internal server error during playbook construction. Please check inputs and retry.</p>
            </div>
        );
    }

    return (
        <div className="max-w-6xl mx-auto px-4 pb-32 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Integrity Banner */}
            {!contractResult.ok && (
                <div className="mb-6 flex items-center gap-3 bg-amber-50 border border-amber-200 p-3 rounded-xl text-amber-800 text-xs font-bold">
                    <ShieldAlert className="w-4 h-4" />
                    <span>Playbook Contract: PARTIAL (Rendered with fallback placeholders)</span>
                </div>
            )}

            {/* Executive Intro */}
            <div className="mb-12">
                <div className="flex items-center gap-3 mb-8">
                    <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center border border-amber-100 shadow-sm">
                        <Zap className="w-6 h-6" />
                    </div>
                    <div>
                        <h3 className="text-xl font-black text-slate-900 uppercase tracking-wider">Strategic Playbook</h3>
                        <div className="h-px w-full bg-slate-100 mt-2" />
                    </div>
                </div>
                
                <div className="bg-slate-900 rounded-[2.5rem] p-10 md:p-14 text-white relative overflow-hidden shadow-2xl shadow-slate-900/40">
                    <div className="relative z-10">
                        <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-white/10 text-white rounded-full text-[10px] font-black uppercase tracking-widest border border-white/20 mb-6 shadow-sm backdrop-blur-md">
                            <Rocket className="w-3.5 h-3.5"/> Action Readiness: HIGH
                        </div>
                        <h1 className="text-4xl md:text-5xl font-black leading-tight mb-4 tracking-tight">
                            {toReactText(safeData.category)} Activation Plan
                        </h1>
                        <p className="text-slate-300 text-lg font-medium max-w-2xl leading-relaxed">
                            {toReactText(safeData.executiveSummary) || "Detailed strategic deployment framework optimized for Indian grooming demand signals."}
                        </p>
                    </div>
                </div>
            </div>

            {/* 1. Positioning & Identity */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
                <div className="lg:col-span-2 h-full">
                    <PlaybookSection title="Core Positioning" icon={Target} color="indigo">
                        <div className="space-y-4">
                            {Array.isArray(safeData.positioning) ? safeData.positioning.map((p: any, i: number) => (
                                <div key={i} className="relative p-6 bg-indigo-50/50 rounded-2xl border border-indigo-100">
                                    <Quote className="absolute -top-3 -left-3 w-8 h-8 text-indigo-200 opacity-50" />
                                    <p className="text-lg font-bold text-indigo-900 leading-snug italic relative z-10 font-serif">
                                        "{toReactText(p)}"
                                    </p>
                                </div>
                            )) : (
                                <div className="relative p-6 bg-indigo-50/50 rounded-2xl border border-indigo-100">
                                    <p className="text-lg font-bold text-indigo-900 leading-snug italic font-serif">"{toReactText(safeData.positioning)}"</p>
                                </div>
                            )}
                        </div>
                    </PlaybookSection>
                </div>
                <div>
                    <PlaybookSection title="Messaging Pillars" icon={MessageSquare} color="emerald">
                        <div className="space-y-3">
                            {(safeData.messaging_pillars || []).map((pillar: any, i: number) => (
                                <div key={i} className="flex gap-3 text-sm font-bold text-slate-700 p-4 bg-emerald-50/50 rounded-2xl border border-emerald-100 items-start">
                                    <div className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-[10px] font-black shrink-0 mt-0.5">
                                        {i+1}
                                    </div>
                                    {toReactText(pillar)}
                                </div>
                            ))}
                        </div>
                    </PlaybookSection>
                </div>
            </div>

            {/* 2. Content & Creative Angles */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                <PlaybookSection title="Content Strategy" icon={Layout} color="rose">
                    <ul className="space-y-4">
                        {(safeData.content_plan || []).map((item: any, i: number) => (
                            <li key={i} className="flex items-start gap-4 p-4 hover:bg-slate-50 rounded-2xl transition-colors border border-transparent hover:border-slate-100">
                                <div className="w-8 h-8 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center font-black text-xs shrink-0 shadow-sm">{i+1}</div>
                                <span className="text-sm text-slate-700 leading-relaxed font-medium pt-1">{toReactText(item)}</span>
                            </li>
                        ))}
                    </ul>
                </PlaybookSection>
                <PlaybookSection title="Creative Angles" icon={Sparkles} color="amber">
                    <div className="grid grid-cols-1 gap-3">
                        {(safeData.creativeAngles || []).map((angle: any, i: number) => (
                            <div key={i} className="p-4 bg-amber-50/50 border border-amber-100 rounded-2xl flex items-start gap-3">
                                <div className="p-1.5 bg-white rounded-lg shadow-sm text-amber-600"><Zap className="w-3.5 h-3.5 fill-current"/></div>
                                <span className="text-xs font-bold text-amber-900 leading-relaxed">{toReactText(angle)}</span>
                            </div>
                        ))}
                    </div>
                </PlaybookSection>
            </div>

            {/* 3. 30/60/90 Day Execution */}
            <PlaybookSection title="Execution Roadmap" icon={Calendar} color="violet">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-12 relative">
                    <div className="hidden md:block absolute top-12 left-0 right-0 h-0.5 bg-violet-100 -z-10" />
                    
                    <div>
                        <div className="bg-violet-50 w-fit px-4 py-1.5 rounded-full text-[10px] font-black text-violet-700 uppercase tracking-widest mb-6 border border-violet-100 shadow-sm">
                            Day 30: Foundation
                        </div>
                        <ul className="space-y-4">
                            {(safeData.action_plan_30_60_90?.day30 || []).map((act: any, i: number) => (
                                <li key={i} className="text-xs text-slate-600 flex gap-3 font-medium bg-slate-50 p-3 rounded-xl border border-slate-100">
                                    <div className="w-1.5 h-1.5 rounded-full bg-violet-400 mt-1.5 shrink-0" />
                                    {toReactText(act)}
                                </li>
                            ))}
                        </ul>
                    </div>
                    <div>
                        <div className="bg-violet-50 w-fit px-4 py-1.5 rounded-full text-[10px] font-black text-violet-700 uppercase tracking-widest mb-6 border border-violet-100 shadow-sm">
                            Day 60: Activation
                        </div>
                        <ul className="space-y-4">
                            {(safeData.action_plan_30_60_90?.day60 || []).map((act: any, i: number) => (
                                <li key={i} className="text-xs text-slate-600 flex gap-3 font-medium bg-slate-50 p-3 rounded-xl border border-slate-100">
                                    <div className="w-1.5 h-1.5 rounded-full bg-violet-400 mt-1.5 shrink-0" />
                                    {toReactText(act)}
                                </li>
                            ))}
                        </ul>
                    </div>
                    <div>
                        <div className="bg-violet-50 w-fit px-4 py-1.5 rounded-full text-[10px] font-black text-violet-700 uppercase tracking-widest mb-6 border border-violet-100 shadow-sm">
                            Day 90: Scale
                        </div>
                        <ul className="space-y-4">
                            {(safeData.action_plan_30_60_90?.day90 || []).map((act: any, i: number) => (
                                <li key={i} className="text-xs text-slate-600 flex gap-3 font-medium bg-slate-50 p-3 rounded-xl border border-slate-100">
                                    <div className="w-1.5 h-1.5 rounded-full bg-violet-400 mt-1.5 shrink-0" />
                                    {toReactText(act)}
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            </PlaybookSection>

            {/* 4. Risks & Mitigations */}
            <PlaybookSection title="Risks & Mitigations" icon={ShieldAlert} color="red">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {(safeData.risksAndMitigations || []).map((item: any, i: number) => (
                        <div key={i} className="p-5 border border-slate-100 rounded-2xl bg-white shadow-sm hover:border-red-200 transition-colors">
                            <div className="flex items-center gap-2 mb-3">
                                <span className="px-2 py-0.5 bg-red-50 text-red-600 text-[9px] font-black uppercase rounded tracking-widest border border-red-100">Risk</span>
                                <span className="text-xs font-bold text-slate-800">{toReactText(item.risk)}</span>
                            </div>
                            <div className="flex items-start gap-2 pt-3 border-t border-slate-50">
                                <span className="px-2 py-0.5 bg-emerald-50 text-emerald-600 text-[9px] font-black uppercase rounded tracking-widest border border-emerald-100">Mitigation</span>
                                <span className="text-xs font-medium text-slate-600 leading-relaxed">{toReactText(item.mitigation)}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </PlaybookSection>

            {/* 5. Measurement */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                {(safeData.measurement_kpis || []).map((kpi: any, i: number) => (
                    <div key={i} className="p-6 bg-slate-900 text-white rounded-3xl shadow-xl flex flex-col justify-center items-center text-center group hover:scale-105 transition-all">
                        <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center mb-4 group-hover:bg-indigo-500 transition-colors">
                            <ListChecks className="w-5 h-5" />
                        </div>
                        <span className="text-[10px] font-black uppercase tracking-widest leading-relaxed">{toReactText(kpi)}</span>
                    </div>
                ))}
            </div>

            <footer className="mt-16 text-center text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center justify-center gap-2">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-500"/> Strategy Artifact Sealed • {new Date(safeData.generated_at).toLocaleString()}
                {safeData.signalsUsed && (
                    <span className="ml-4 opacity-50">
                        ({safeData.signalsUsed.contentCount} CT, {safeData.signalsUsed.conversationCount} CV, {safeData.signalsUsed.transactionCount} TR)
                    </span>
                )}
            </footer>
        </div>
    );
};
