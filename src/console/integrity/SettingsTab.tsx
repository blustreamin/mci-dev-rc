
import React, { useState, useEffect } from 'react';
import { Key, Database, Info, RefreshCw, Save, AlertTriangle } from 'lucide-react';
import { DataForSeoCredsModal } from '../DataForSeoCredsModal';
import { SimpleErrorBoundary } from '../../components/SimpleErrorBoundary';
import { FirestoreClient } from '../../services/firestoreClient';
import { toReactText } from '../../utils/reactSafe';

const STORAGE_KEY = "mci_runtime_flags_v1";

export const SettingsTab: React.FC = () => {
    const [showCreds, setShowCreds] = useState(false);
    const dbInfo = FirestoreClient.logFirebaseTarget();

    // Runtime Flags State
    const [flagsText, setFlagsText] = useState("{}");
    const [flagsError, setFlagsError] = useState<string | null>(null);
    const [saveSuccess, setSaveSuccess] = useState(false);

    useEffect(() => {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            try {
                // Formatting for readability
                setFlagsText(JSON.stringify(JSON.parse(saved), null, 2));
            } catch {
                setFlagsText(saved);
            }
        }
    }, []);

    const handleSaveFlags = () => {
        try {
            const parsed = JSON.parse(flagsText);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
            setFlagsText(JSON.stringify(parsed, null, 2));
            setFlagsError(null);
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 2000);
        } catch (e: any) {
            setFlagsError(e.message);
            setSaveSuccess(false);
        }
    };

    return (
        <SimpleErrorBoundary>
            <div className="space-y-6 animate-in fade-in duration-500">
                <DataForSeoCredsModal isOpen={showCreds} onClose={() => setShowCreds(false)} />
                
                <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="p-2 bg-slate-100 rounded-lg text-slate-600"><Key className="w-5 h-5"/></div>
                        <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest">Credentials Management</h3>
                    </div>
                    <div className="flex items-center justify-between">
                        <div className="text-xs text-slate-500">
                            Configure access keys for external data providers (DataForSEO, etc).
                        </div>
                        <button 
                            onClick={() => setShowCreds(true)} 
                            className="px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-bold hover:bg-slate-800 transition-colors"
                        >
                            Manage Credentials
                        </button>
                    </div>
                </div>

                <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600"><Database className="w-5 h-5"/></div>
                        <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest">Database Connection</h3>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4 text-xs">
                        <div className="p-3 bg-slate-50 rounded border border-slate-100">
                            <span className="block text-slate-400 uppercase font-bold text-[10px] mb-1">Project ID</span>
                            <span className="font-mono font-bold text-slate-700">{toReactText(dbInfo?.projectId)}</span>
                        </div>
                        <div className="p-3 bg-slate-50 rounded border border-slate-100">
                             <span className="block text-slate-400 uppercase font-bold text-[10px] mb-1">Database ID</span>
                             <span className="font-mono font-bold text-slate-700">{toReactText(dbInfo?.databaseId)}</span>
                        </div>
                    </div>
                </div>

                <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="p-2 bg-slate-100 rounded-lg text-slate-600"><Info className="w-5 h-5"/></div>
                        <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest">Runtime Flags</h3>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <div className="flex justify-between items-center mb-2">
                                <label className="text-xs font-bold text-slate-500 uppercase">Editable Overrides (localStorage)</label>
                                {saveSuccess && <span className="text-xs font-bold text-emerald-600 animate-pulse">Saved Successfully</span>}
                            </div>
                            <textarea 
                                value={flagsText}
                                onChange={e => setFlagsText(e.target.value)}
                                className={`w-full h-40 font-mono text-xs p-3 bg-slate-50 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none ${flagsError ? 'border-red-300' : 'border-slate-200'}`}
                                spellCheck={false}
                                placeholder='{ "dfsProxyUrl": "..." }'
                            />
                            {flagsError && (
                                <div className="text-xs text-red-600 font-bold mt-2 flex items-center gap-2">
                                    <AlertTriangle className="w-3 h-3"/> Invalid JSON: {flagsError}
                                </div>
                            )}
                            <button 
                                onClick={handleSaveFlags}
                                className="mt-3 px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-bold hover:bg-slate-800 flex items-center gap-2 transition-colors"
                            >
                                <Save className="w-3 h-3"/> Save Runtime Flags
                            </button>
                        </div>
                        
                        <div className="pt-4 border-t border-slate-100">
                             <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Build Environment (Read-Only)</label>
                             <div className="p-3 bg-slate-50 rounded border border-slate-100 text-[10px] font-mono text-slate-500 overflow-x-auto max-h-32">
                                {toReactText(JSON.stringify((import.meta as any).env || {}, null, 2))}
                             </div>
                        </div>
                    </div>
                </div>
            </div>
        </SimpleErrorBoundary>
    );
};
