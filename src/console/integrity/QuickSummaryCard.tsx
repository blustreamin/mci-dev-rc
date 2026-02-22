
import React, { useState } from 'react';
import { ShieldCheck, AlertTriangle, XCircle, ChevronDown, ChevronUp, Clock } from 'lucide-react';
import { HealthCheckReport } from '../../services/systemHealthCheck';
import { CopyDiagnosticsButton } from './CopyDiagnosticsButton';

interface QuickSummaryCardProps {
    report: HealthCheckReport;
}

export const QuickSummaryCard: React.FC<QuickSummaryCardProps> = ({ report }) => {
    const [showDetails, setShowDetails] = useState(false);

    const verdictColor = {
        GO: 'bg-emerald-50 border-emerald-200 text-emerald-800',
        WARN: 'bg-amber-50 border-amber-200 text-amber-800',
        NO_GO: 'bg-red-50 border-red-200 text-red-800'
    }[report.verdict];

    const verdictIcon = {
        GO: <ShieldCheck className="w-6 h-6 text-emerald-600" />,
        WARN: <AlertTriangle className="w-6 h-6 text-amber-600" />,
        NO_GO: <XCircle className="w-6 h-6 text-red-600" />
    }[report.verdict];

    const blockers = report.blockers.slice(0, 3);
    const warnings = report.warnings.slice(0, 3);

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm mb-6 overflow-hidden">
            <div className="p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <div className={`p-3 rounded-xl border ${verdictColor} bg-opacity-50`}>
                        {verdictIcon}
                    </div>
                    <div>
                        <div className="flex items-center gap-3">
                            <h2 className="text-xl font-black text-slate-900 tracking-tight">System Integrity: {report.verdict}</h2>
                            <span className="text-[10px] font-mono text-slate-400 bg-slate-50 px-2 py-0.5 rounded border border-slate-100 flex items-center gap-1">
                                <Clock className="w-3 h-3"/> {new Date(report.ts).toLocaleTimeString()}
                            </span>
                        </div>
                        <div className="text-xs text-slate-500 font-medium mt-1">
                            {report.blockers.length} Blockers • {report.warnings.length} Warnings • Target: {report.target.envMode}
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3 w-full md:w-auto">
                    <button 
                        onClick={() => setShowDetails(!showDetails)}
                        className="flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 rounded-lg transition-colors border border-transparent hover:border-slate-200"
                    >
                        {showDetails ? 'Hide Analysis' : 'What failed?'}
                        {showDetails ? <ChevronUp className="w-3.5 h-3.5"/> : <ChevronDown className="w-3.5 h-3.5"/>}
                    </button>
                    <CopyDiagnosticsButton data={report} />
                </div>
            </div>

            {/* Expandable Explanation */}
            {showDetails && (
                <div className="px-6 pb-6 pt-2 border-t border-slate-100 bg-slate-50/50 animate-in slide-in-from-top-2">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Critical Blockers</h4>
                            {blockers.length > 0 ? (
                                <ul className="space-y-2">
                                    {blockers.map((b, i) => (
                                        <li key={i} className="flex items-start gap-2 text-xs font-bold text-red-700">
                                            <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5"/>
                                            <span>{b}</span>
                                        </li>
                                    ))}
                                    {report.blockers.length > 3 && (
                                        <li className="text-[10px] text-slate-400 pl-6">...and {report.blockers.length - 3} more</li>
                                    )}
                                </ul>
                            ) : (
                                <p className="text-xs text-slate-400 italic">None detected.</p>
                            )}
                        </div>
                        <div>
                            <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">Warnings & Advisories</h4>
                            {warnings.length > 0 ? (
                                <ul className="space-y-2">
                                    {warnings.map((w, i) => (
                                        <li key={i} className="flex items-start gap-2 text-xs font-medium text-amber-700">
                                            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5"/>
                                            <span>{w}</span>
                                        </li>
                                    ))}
                                    {report.warnings.length > 3 && (
                                        <li className="text-[10px] text-slate-400 pl-6">...and {report.warnings.length - 3} more</li>
                                    )}
                                </ul>
                            ) : (
                                <p className="text-xs text-slate-400 italic">None detected.</p>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
