
import React from 'react';
import { DeepDiveLibraryPanel } from '../../components/DeepDiveLibraryPanel';
import { SimpleErrorBoundary } from '../../components/SimpleErrorBoundary';

interface Props {
    onOpenReport: (catId: string, monthKey: string) => void;
}

export const DeepDiveLibraryTab: React.FC<Props> = ({ onOpenReport }) => {
    return (
        <SimpleErrorBoundary>
            <div className="animate-in fade-in duration-500">
                <DeepDiveLibraryPanel onOpenReport={onOpenReport} />
                <div className="mt-8 p-6 bg-slate-50 border-2 border-dashed border-slate-200 rounded-xl text-center">
                    <p className="text-xs text-slate-500 font-medium">
                        Deep Dive reports are immutable artifacts stored in `deepDive_runs`. <br/>
                        The library shows pointers from `deepDive_latest` for quick access.
                    </p>
                </div>
            </div>
        </SimpleErrorBoundary>
    );
};
