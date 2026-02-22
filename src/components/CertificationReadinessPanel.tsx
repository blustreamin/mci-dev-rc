
import React from 'react';
import { 
    CheckCircle, AlertTriangle, ArrowRight, ShieldCheck, 
    Lock, PlayCircle, BarChart3, AlertOctagon, XCircle
} from 'lucide-react';
import { SafeCertificationReadiness, SafeReadinessTier } from '../console/snapshotUiModel';

interface CertificationReadinessPanelProps {
    readiness: SafeCertificationReadiness;
    lifecycle: string;
    onAction: (action: 'GROW' | 'VALIDATE' | 'CERTIFY' | 'RESUME', context?: any) => void;
}

const TierCard: React.FC<{ 
    tier: 'LITE' | 'FULL'; 
    data: SafeReadinessTier; 
    onCertify: () => void;
    isCertifiedAlready: boolean;
}> = ({ tier, data, onCertify, isCertifiedAlready }) => {
    
    const isPass = data.pass;
    const color = tier === 'FULL' ? 'indigo' : 'sky';
    const reasons = data.reasons || [];
    
    return (
        <div className={`flex-1 rounded-xl border p-4 flex flex-col ${isPass ? `bg-${color}-50 border-${color}-200` : 'bg-slate-50 border-slate-200'}`}>
            <div className="flex justify-between items-center mb-3">
                <h4 className={`text-xs font-black uppercase tracking-widest text-${color}-800`}>Certified {tier}</h4>
                {isPass ? (
                    <span className={`bg-${color}-100 text-${color}-700 text-[10px] font-bold px-2 py-0.5 rounded-full border border-${color}-200`}>PASS</span>
                ) : (
                    <span className="bg-slate-200 text-slate-500 text-[10px] font-bold px-2 py-0.5 rounded-full">PENDING</span>
                )}
            </div>

            <div className="flex-1 space-y-2 mb-4">
                {isPass ? (
                    <div className={`text-xs text-${color}-700 font-medium flex items-center gap-2`}>
                        <CheckCircle className="w-4 h-4"/> Criteria Met
                    </div>
                ) : (
                    <div className="space-y-1">
                        {reasons.slice(0, 3).map((r, i) => (
                            <div key={i} className="flex gap-2 text-[10px] text-slate-500">
                                <XCircle className="w-3 h-3 text-red-400 shrink-0"/>
                                <span>{r}</span>
                            </div>
                        ))}
                        {reasons.length > 3 && (
                            <div className="text-[9px] text-slate-400 pl-5">+{reasons.length - 3} more...</div>
                        )}
                        {reasons.length === 0 && <div className="text-[10px] text-slate-400 italic">Analysis pending...</div>}
                    </div>
                )}
            </div>

            <button
                onClick={onCertify}
                disabled={!isPass || isCertifiedAlready}
                className={`w-full py-2 rounded-lg text-[10px] font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-all ${
                    isPass 
                        ? isCertifiedAlready 
                            ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                            : `bg-${color}-600 text-white hover:bg-${color}-700 shadow-sm hover:shadow-md`
                        : 'bg-white border border-slate-200 text-slate-300 cursor-not-allowed'
                }`}
            >
                {isCertifiedAlready ? 'Active' : `Certify ${tier}`}
            </button>
        </div>
    );
};

export const CertificationReadinessPanel: React.FC<CertificationReadinessPanelProps> = ({ readiness, lifecycle, onAction }) => {
    
    // Safety Guard
    if (!readiness || !readiness.totals) return null;

    // Status Logic
    const isCertifiedLite = lifecycle === 'CERTIFIED_LITE';
    const isCertifiedFull = lifecycle === 'CERTIFIED_FULL' || lifecycle === 'CERTIFIED';

    // Calculate Anchor Shortfalls Table
    const perAnchor = readiness.per_anchor || {};
    const shortfallAnchors = Object.keys(perAnchor).filter(aid => {
        const missingLite = readiness.lite?.missing?.min_valid_per_anchor?.[aid] || 0;
        const missingFull = readiness.full?.missing?.min_valid_per_anchor?.[aid] || 0;
        return missingLite > 0 || missingFull > 0;
    }).slice(0, 5); // Top 5 issues

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-6 animate-in fade-in slide-in-from-top-2">
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                        <ShieldCheck className="w-5 h-5"/>
                    </div>
                    <div>
                        <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Certification Readiness</h3>
                        <div className="flex items-center gap-2 text-[10px] text-slate-500 font-mono mt-0.5">
                            <span>{readiness.totals.keywords_total} Keywords</span>
                            <span>•</span>
                            <span className="text-emerald-600 font-bold">{readiness.totals.valid_total} Valid (Google)</span>
                        </div>
                    </div>
                </div>
                
                {/* Global Fix Actions */}
                <div className="flex gap-2">
                    <button 
                        onClick={() => onAction('GROW')} 
                        className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-[10px] font-bold hover:border-indigo-300 hover:text-indigo-600 transition-colors flex items-center gap-1.5"
                    >
                        <PlayCircle className="w-3 h-3"/> Grow / Backfill
                    </button>
                    <button 
                        onClick={() => onAction('VALIDATE')} 
                        className="px-3 py-1.5 bg-indigo-50 border border-indigo-100 text-indigo-700 rounded-lg text-[10px] font-bold hover:bg-indigo-100 transition-colors flex items-center gap-1.5"
                    >
                        <BarChart3 className="w-3 h-3"/> Run Validation
                    </button>
                </div>
            </div>

            <div className="p-5">
                <div className="flex flex-col md:flex-row gap-6">
                    
                    {/* Tier Cards */}
                    <div className="flex-1 flex gap-4">
                        <TierCard 
                            tier="LITE" 
                            data={readiness.lite} 
                            onCertify={() => onAction('CERTIFY', { tier: 'LITE' })}
                            isCertifiedAlready={isCertifiedLite || isCertifiedFull}
                        />
                        <TierCard 
                            tier="FULL" 
                            data={readiness.full} 
                            onCertify={() => onAction('CERTIFY', { tier: 'FULL' })}
                            isCertifiedAlready={isCertifiedFull}
                        />
                    </div>

                    {/* Shortfall Table */}
                    {shortfallAnchors.length > 0 && (
                        <div className="w-full md:w-72 shrink-0 bg-slate-50 rounded-xl border border-slate-200 p-4">
                            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3"/> Anchor Gaps (Google Vol)
                            </h4>
                            <div className="space-y-2">
                                {shortfallAnchors.map(aid => {
                                    const curr = perAnchor[aid]?.valid || 0;
                                    const needLite = readiness.lite?.missing?.min_valid_per_anchor?.[aid] || 0;
                                    const needFull = readiness.full?.missing?.min_valid_per_anchor?.[aid] || 0;
                                    
                                    return (
                                        <div key={aid} className="flex justify-between items-center text-[10px] border-b border-slate-100 pb-1 last:border-0">
                                            <span className="font-bold text-slate-700 truncate w-24" title={aid}>{aid}</span>
                                            <div className="flex gap-2 font-mono">
                                                <span className="text-emerald-600">{curr}</span>
                                                <span className="text-slate-300">/</span>
                                                <span className={`${needLite > 0 ? 'text-red-500 font-bold' : 'text-slate-400'}`}>
                                                    +{needLite}
                                                </span>
                                                <span className={`${needFull > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                                                    (Full: +{needFull})
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
