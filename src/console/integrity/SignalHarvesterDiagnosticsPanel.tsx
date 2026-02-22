
import React from 'react';
import { SignalHarvesterDiagResult } from '../../services/signalHarvesterDiagnostics';
import { normalizeSignalHarvesterDiagnostics } from './diagnosticsNormalizer';
import { setSignalHarvesterCollectionOverride } from '../../config/signalHarvesterConfig';
import { Wifi, Search, Calendar, Database, AlertCircle, ExternalLink, Settings, CheckCircle2 } from 'lucide-react';
import { toReactText } from '../../utils/reactSafe';

interface Props {
    result?: SignalHarvesterDiagResult;
    onRecompute?: () => void;
}

const ProbeRow: React.FC<{ 
    label: string; 
    icon: any; 
    status: 'OK' | 'FAIL' | 'WARN'; 
    latency: number; 
    details?: React.ReactNode;
    indexUrl?: string;
}> = ({ label, icon: Icon, status, latency, details, indexUrl }) => {
    const color = status === 'OK' ? 'emerald' : status === 'WARN' ? 'amber' : 'red';
    
    return (
        <div className="flex items-start justify-between py-3 border-b border-slate-50 last:border-0">
            <div className="flex items-start gap-3 flex-1 min-w-0">
                <div className={`p-1.5 rounded-lg bg-${color}-50 text-${color}-600 mt-0.5`}>
                    <Icon className="w-3.5 h-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-slate-700 flex items-center gap-2">
                        {label}
                        {status === 'FAIL' && indexUrl && (
                            <span className="text-[9px] bg-red-100 text-red-700 px-1.5 rounded font-black">INDEX MISSING</span>
                        )}
                    </div>
                    {details && <div className="text-[10px] text-slate-500 mt-1 truncate">{details}</div>}
                    
                    {indexUrl && (
                        <a 
                            href={indexUrl} 
                            target="_blank" 
                            rel="noreferrer"
                            className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-[10px] font-bold rounded-lg hover:bg-indigo-700 transition-colors shadow-sm"
                        >
                            <ExternalLink className="w-3 h-3" /> Create Required Index
                        </a>
                    )}
                </div>
            </div>
            <div className={`text-[10px] font-mono font-bold text-${color}-600 whitespace-nowrap ml-4`}>
                {status} {latency > 0 && `(${latency}ms)`}
            </div>
        </div>
    );
};

export const SignalHarvesterDiagnosticsPanel: React.FC<Props> = ({ result, onRecompute }) => {
    // Ensure result is passed safely, even if undefined
    const data = normalizeSignalHarvesterDiagnostics(result || {});
    const { config, probes, _missing, advisories } = data;

    const toggleOverride = () => {
        // Safe access to config.collectionName with optional chaining fallback
        const current = config?.collectionName || 'unknown';
        const next = current.includes('staging') ? 'signal_harvester_v2' : 'signal_harvester_staging';
        if (confirm(`Switch collection to ${next} for debugging? This affects this session only.`)) {
            setSignalHarvesterCollectionOverride(next);
            if (onRecompute) onRecompute();
        }
    };

    if (_missing || !config) {
        return (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 text-center">
                <Wifi className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                <h4 className="text-sm font-bold text-slate-500">Diagnostics Unavailable</h4>
                <p className="text-xs text-slate-400 mt-1 mb-4">Run the health check to generate diagnostics.</p>
                {onRecompute && (
                    <button onClick={onRecompute} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-bold rounded-lg transition-colors">
                        Run Diagnostics
                    </button>
                )}
            </div>
        );
    }

    // Defensive access for probes and config with robust fallbacks
    const latestRead = probes?.latestRead || { ok: false, latencyMs: 0 };
    const categoryQuery = probes?.categoryQuery || { ok: false, latencyMs: 0, found: false };
    const monthWindow = probes?.monthWindow || { ok: false, sampledCount: 0, inWindowCount: 0, targetMonth: '?', windowUsed: '?' };

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest flex items-center gap-2">
                    <Wifi className="w-4 h-4 text-sky-500"/> Signal Harvester
                </h3>
                <div className="flex items-center gap-2">
                    <div className="text-[9px] font-mono font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100" title="Active Collection">
                        {toReactText(config.collectionName || 'unknown')}
                    </div>
                    <button onClick={toggleOverride} className="p-1 hover:bg-slate-200 rounded text-slate-400" title="Toggle Collection Override">
                        <Settings className="w-3 h-3"/>
                    </button>
                </div>
            </div>

            <div className="p-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-1">
                        <ProbeRow 
                            label="Connection Probe" 
                            icon={Database} 
                            status={latestRead.ok ? 'OK' : 'FAIL'}
                            latency={latestRead.latencyMs}
                            indexUrl={latestRead.indexUrl}
                            details={
                                latestRead.ok 
                                    ? `Read doc: ${latestRead.docId?.slice(0,6)}... (${latestRead.platform})`
                                    : <span className="text-red-600 font-medium">{toReactText(latestRead.error || 'Read Failed')}</span>
                            }
                        />

                        <ProbeRow 
                            label="Category Query" 
                            icon={Search} 
                            status={categoryQuery.ok ? 'OK' : 'FAIL'}
                            latency={categoryQuery.latencyMs}
                            indexUrl={categoryQuery.indexUrl}
                            details={
                                categoryQuery.ok ? (
                                    <span>
                                        {categoryQuery.found ? "Documents Found" : "Empty (Valid Query)"}
                                        <span className="ml-2 font-mono text-[9px] bg-slate-100 px-1 rounded text-slate-500">{categoryQuery.modeUsed}</span>
                                    </span>
                                ) : (
                                    <span className="text-red-600 font-medium">{toReactText(categoryQuery.error || 'Query Failed')}</span>
                                )
                            }
                        />

                        <ProbeRow 
                            label="Month Window" 
                            icon={Calendar} 
                            status={monthWindow.ok ? 'OK' : 'WARN'}
                            latency={0}
                            details={
                                monthWindow.ok ? (
                                    <span>
                                        Target: {monthWindow.targetMonth}
                                        <span className="ml-2 font-bold text-slate-700">
                                            {monthWindow.inWindowCount} / {monthWindow.sampledCount}
                                        </span>
                                    </span>
                                ) : <span className="text-red-500">{toReactText(monthWindow.error)}</span>
                            }
                        />
                    </div>

                    <div className="space-y-4">
                        <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 text-[10px] space-y-2">
                            <div className="font-black text-slate-400 uppercase tracking-widest mb-1">Configuration</div>
                            <div className="flex justify-between">
                                <span className="text-slate-500">Env Mode:</span>
                                <span className={`font-mono font-bold ${config.envMode === 'production' ? 'text-rose-600' : 'text-slate-700'}`}>
                                    {toReactText(config.envMode)}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-slate-500">Project ID:</span>
                                <span className="font-mono text-slate-700">{toReactText(config.projectId)}</span>
                            </div>
                            <div className="h-px bg-slate-200 my-1"/>
                            <div className="flex justify-between">
                                <span className="text-slate-500">Category Field:</span>
                                <span className="font-mono text-slate-700">{config.fields?.categoryField}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-slate-500">Time Field:</span>
                                <span className="font-mono text-slate-700">{config.fields?.timeField}</span>
                            </div>
                        </div>

                        {advisories && advisories.length > 0 && (
                            <div className="bg-amber-50 rounded-xl p-3 border border-amber-100 text-[10px]">
                                <div className="font-black text-amber-700 uppercase tracking-widest mb-2 flex items-center gap-1">
                                    <AlertCircle className="w-3 h-3"/> Advisories
                                </div>
                                <ul className="space-y-1 list-disc pl-3 text-amber-800">
                                    {advisories.map((adv, i) => (
                                        <li key={i}>{adv}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
