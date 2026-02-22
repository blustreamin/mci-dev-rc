
import React, { useState, useEffect } from 'react';
import { Loader2, RefreshCw, FileJson, Download, Activity } from 'lucide-react';
import { SystemHealthCheck, HealthCheckReport } from '../../services/systemHealthCheck';
import { QuickSummaryCard } from './QuickSummaryCard';
import { SimpleErrorBoundary } from '../../components/SimpleErrorBoundary';

export const SystemHealthTab: React.FC = () => {
    const [report, setReport] = useState<HealthCheckReport | null>(null);
    const [loading, setLoading] = useState(true);
    const [jsonMode, setJsonMode] = useState(false);

    const run = async () => {
        setLoading(true);
        try {
            const res = await SystemHealthCheck.run();
            setReport(res);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { run(); }, []);

    if (loading) return <div className="p-12 text-center text-slate-400 flex items-center justify-center gap-2"><Loader2 className="w-5 h-5 animate-spin"/> Diagnostic Probe Running...</div>;
    if (!report) return <div className="p-8 text-center text-red-400">Health Check Failed to Initialize</div>;

    const exportJson = () => {
        const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `health_report_${new Date().toISOString()}.json`;
        a.click();
    };

    return (
        <SimpleErrorBoundary>
            <div className="space-y-6 animate-in fade-in duration-500">
                <div className="flex justify-between items-center">
                    <h2 className="text-lg font-black text-slate-800 flex items-center gap-2">
                        <Activity className="w-5 h-5 text-indigo-600"/> System Health Status
                    </h2>
                    <div className="flex items-center gap-2">
                         <button onClick={exportJson} className="p-2 hover:bg-slate-100 rounded-lg text-indigo-600 transition-all" title="Download JSON"><Download className="w-4 h-4"/></button>
                         <button onClick={() => setJsonMode(!jsonMode)} className={`p-2 rounded-lg border transition-all ${jsonMode ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'hover:bg-slate-50 border-transparent'}`} title="View JSON"><FileJson className="w-4 h-4"/></button>
                         <button onClick={run} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 transition-all" title="Refresh"><RefreshCw className="w-4 h-4"/></button>
                    </div>
                </div>

                <QuickSummaryCard report={report} />

                {jsonMode && (
                    <div className="bg-slate-900 rounded-xl p-4 overflow-auto max-h-96 text-[10px] font-mono text-emerald-400 mb-6 border border-slate-700">
                        <pre>{JSON.stringify(report, null, 2)}</pre>
                    </div>
                )}
                
                {/* Guidance Footer */}
                <div className="text-center text-xs text-slate-400 pt-8 border-t border-slate-200">
                    <p>Integrity Probe v2.0 • Environment: {report.target.envMode}</p>
                </div>
            </div>
        </SimpleErrorBoundary>
    );
};
