
import React, { useEffect, useState } from 'react';
import { SignalHarvesterDiagnosticsPanel } from './SignalHarvesterDiagnosticsPanel';
import { SignalCorpusPanel } from './SignalCorpusPanel';
import { SimpleErrorBoundary } from '../../components/SimpleErrorBoundary';
import { SignalHarvesterDiagnostics, SignalHarvesterDiagResult } from '../../services/signalHarvesterDiagnostics';
import { Loader2 } from 'lucide-react';

interface Props {
    categoryId: string;
    monthKey: string;
}

export const SignalsPlumbingTab: React.FC<Props> = ({ categoryId, monthKey }) => {
    const [diagResult, setDiagResult] = useState<SignalHarvesterDiagResult | undefined>(undefined);
    const [loading, setLoading] = useState(false);

    const runDiag = async () => {
        setLoading(true);
        try {
            const res = await SignalHarvesterDiagnostics.runDiagnostics(categoryId, monthKey);
            setDiagResult(res);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        runDiag();
    }, [categoryId, monthKey]);

    return (
        <SimpleErrorBoundary>
            <div className="space-y-8 animate-in fade-in duration-500">
                <div className="space-y-4">
                    <div className="flex justify-between items-center">
                        <h3 className="text-sm font-black text-slate-700 uppercase tracking-widest">Signal Harvester Diagnostics</h3>
                        {loading && <Loader2 className="w-4 h-4 animate-spin text-slate-400"/>}
                    </div>
                    <SignalHarvesterDiagnosticsPanel result={diagResult} onRecompute={runDiag} />
                </div>

                <div className="space-y-4">
                    <h3 className="text-sm font-black text-slate-700 uppercase tracking-widest">Signal Corpus Snapshot</h3>
                    <SignalCorpusPanel categoryId={categoryId} monthKey={monthKey} />
                </div>
            </div>
        </SimpleErrorBoundary>
    );
};
