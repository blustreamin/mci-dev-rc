
import React, { useState, useEffect, useRef } from 'react';
import { Key, X, Save, Loader2, Activity, CheckCircle, AlertTriangle, Ban, Clock, Server, Database, Stethoscope, Globe } from 'lucide-react';
import { CredsStore } from '../services/demand_vNext/credsStore';
import { DataForSeoClient, DataForSeoTestResult, DataForSeoRow } from '../services/demand_vNext/dataforseoClient';
import { DfsConnectivityTriage, DfsTriageReport } from '../services/demand_vNext/dfsConnectivityTriage';

interface DataForSeoCredsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const TEST_KEYWORDS = [
    "gillette razor", 
    "shaving cream", 
    "beard trimmer", 
    "hair wax", 
    "face wash for men"
];

export const DataForSeoCredsModal: React.FC<DataForSeoCredsModalProps> = ({ isOpen, onClose }) => {
    const [login, setLogin] = useState('');
    const [password, setPassword] = useState('');
    const [proxyUrl, setProxyUrl] = useState('');
    const [status, setStatus] = useState<string>('');
    const [isLoading, setIsLoading] = useState(false);
    
    // Testing State
    const [isTesting, setIsTesting] = useState(false);
    const [testResult, setTestResult] = useState<DataForSeoTestResult | null>(null);
    const [elapsedMs, setElapsedMs] = useState(0);
    
    // Triage State
    const [triageReport, setTriageReport] = useState<DfsTriageReport | null>(null);
    const [showTriage, setShowTriage] = useState(false);
    
    const abortControllerRef = useRef<AbortController | null>(null);
    const timerRef = useRef<number | null>(null);
    const timeoutRef = useRef<number | null>(null);

    useEffect(() => {
        if (isOpen) {
            const load = async () => {
                setTestResult(null);
                setTriageReport(null);
                setShowTriage(false);
                setStatus('');
                setElapsedMs(0);
                
                // Load from unified config resolution
                const config = await CredsStore.resolveDfsConfig();
                setLogin(config.login || '');
                setPassword(config.password || '');
                setProxyUrl(config.proxyUrl || '');
            };
            load();
        }
        
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            if (abortControllerRef.current) abortControllerRef.current.abort();
        };
    }, [isOpen]);

    const handleSave = async () => {
        setIsLoading(true);
        setStatus('Persisting...');
        try {
            // 1. Save to Runtime Flags (Local Session)
            CredsStore.setRuntimeFlags({
                dfsLogin: login,
                dfsPassword: password,
                dfsProxyUrl: proxyUrl
            });
            
            // 2. Persist to Firestore (Background Job accessibility)
            await CredsStore.persistToFirestore({
                login,
                password,
                proxyUrl
            });
            
            setStatus('Saved & Synchronized');
            setTimeout(() => {
                setStatus('');
                onClose();
            }, 1000);
        } catch (e: any) {
            console.error("Save failed", e);
            setStatus(`Error: ${e.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    const handleClear = async () => {
        if (!confirm("Clear credentials from local storage and remote settings?")) return;
        
        setIsLoading(true);
        try {
            CredsStore.setRuntimeFlags({
                dfsLogin: null,
                dfsPassword: null,
                dfsProxyUrl: null
            });
            
            // Note: We don't necessarily want to wipe Firestore on clear unless explicitly needed,
            // but for a true "Clear" we should null them out remotely too.
            await CredsStore.persistToFirestore({ login: "", password: "", proxyUrl: "" });
            
            setLogin('');
            setPassword('');
            setProxyUrl('');
            setStatus('Settings Cleared');
            setTestResult(null);
            setTriageReport(null);
        } catch (e) {
            setStatus('Clear failed');
        } finally {
            setIsLoading(false);
        }
    };

    const handleCancel = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            if (timerRef.current) clearInterval(timerRef.current);
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            
            setTestResult({
                ok: false,
                status: 0,
                latency: elapsedMs,
                error: "Cancelled by user",
                /* Added required viaProxy and urlUsed properties */
                viaProxy: false,
                urlUsed: ''
            });
            setIsTesting(false);
        }
    };

    const handleTriage = async () => {
        setIsLoading(true);
        setTriageReport(null);
        setShowTriage(true);
        try {
            // Ensure triage uses current input even if not saved yet
            CredsStore.setRuntimeFlags({
                dfsLogin: login,
                dfsPassword: password,
                dfsProxyUrl: proxyUrl
            });
            
            const report = await DfsConnectivityTriage.run();
            setTriageReport(report);
        } catch (e) {
            console.error("Triage failed", e);
        } finally {
            setIsLoading(false);
        }
    };

    const handleTest = async () => {
        // Resolve Config for Audit
        const config = await CredsStore.resolveDfsConfig();
        
        if (!login || !password) {
            setTestResult({ 
                ok: false, status: 0, latency: 0, 
                error: "Enter API Login & Password to test.",
                /* Added required viaProxy and urlUsed properties */
                viaProxy: false,
                urlUsed: ''
            });
            return;
        }

        setIsTesting(true);
        setTestResult(null);
        setTriageReport(null);
        setShowTriage(false);
        setElapsedMs(0);

        const controller = new AbortController();
        abortControllerRef.current = controller;
        const start = Date.now();

        timerRef.current = window.setInterval(() => {
            setElapsedMs(Date.now() - start);
        }, 250);

        timeoutRef.current = window.setTimeout(() => {
            controller.abort();
            if (abortControllerRef.current === controller) { 
                if (timerRef.current) clearInterval(timerRef.current);
                setTestResult({
                    ok: false,
                    status: 408,
                    latency: 30000,
                    error: "DFS_PROXY_TIMEOUT: Exceeded 30s limit",
                    /* Added required viaProxy and urlUsed properties */
                    viaProxy: false,
                    urlUsed: ''
                });
                setIsTesting(false);
            }
        }, 30000);

        try {
            const result = await DataForSeoClient.fetchGoogleVolumes_DFS({
                keywords: TEST_KEYWORDS,
                location: 2356,
                language: 'en',
                creds: { login, password },
                signal: controller.signal
            });
            
            if (!controller.signal.aborted) {
                setTestResult(result);
            }
        } catch (e: any) {
            if (!controller.signal.aborted) {
                setTestResult({ 
                    ok: false, 
                    status: 500, 
                    latency: Date.now() - start, 
                    error: `DFS_CLIENT_EXCEPTION: ${e.message}`,
                    /* Added required viaProxy and urlUsed properties */
                    viaProxy: false,
                    urlUsed: ''
                });
            }
        } finally {
            if (timerRef.current) clearInterval(timerRef.current);
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            if (abortControllerRef.current === controller && !controller.signal.aborted) {
                setIsTesting(false);
            }
        }
    };

    if (!isOpen) return null;

    const parsedRowsCount = testResult?.parsedRows?.length || 0;
    const validVolumeCount = testResult?.parsedRows?.filter(r => (r.search_volume || 0) > 0).length || 0;
    const sampleRows = testResult?.parsedRows?.slice(0, 3) || [];

    return (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={onClose} />
            <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 shrink-0">
                    <h3 className="font-bold text-slate-900 flex items-center gap-2">
                        <Key className="w-4 h-4 text-indigo-600"/> DataForSEO Credentials
                    </h3>
                    <button onClick={onClose} className="p-1 hover:bg-slate-200 rounded-full text-slate-400 transition-colors">
                        <X className="w-4 h-4" />
                    </button>
                </div>
                
                <div className="p-6 space-y-4 overflow-y-auto">
                    <div className="bg-indigo-50 border border-indigo-100 p-3 rounded-lg text-[10px] text-indigo-800 mb-4">
                         <strong>System Sync:</strong> Settings saved here are persisted to Firestore to ensure background rebuild jobs remain operational.
                    </div>

                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">API Login</label>
                            <input 
                                type="text" 
                                value={login}
                                onChange={e => setLogin(e.target.value)}
                                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-indigo-500 outline-none"
                                placeholder="DataForSEO Login"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">API Password</label>
                            <input 
                                type="password" 
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-indigo-500 outline-none"
                                placeholder="DataForSEO Password"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5 flex items-center gap-2">
                                <Globe className="w-3 h-3"/> Proxy URL
                            </label>
                            <input 
                                type="text" 
                                value={proxyUrl}
                                onChange={e => setProxyUrl(e.target.value)}
                                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-indigo-500 outline-none"
                                placeholder="https://your-proxy.com"
                            />
                            <p className="text-[10px] text-slate-400 mt-1">Leave empty for Direct Mode (often blocked by CORS)</p>
                        </div>
                    </div>

                    {showTriage && triageReport && (
                        <div className={`p-4 rounded-xl border flex flex-col gap-2 ${triageReport.verdict === 'GO' ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-900 border-slate-800'}`}>
                            <div className="flex justify-between items-center">
                                <span className={`text-xs font-black uppercase tracking-widest ${triageReport.verdict === 'GO' ? 'text-emerald-700' : 'text-slate-300'}`}>
                                    Connectivity Triage: {triageReport.verdict}
                                </span>
                                <span className="text-[10px] font-mono text-slate-400">
                                    {new Date(triageReport.ts).toLocaleTimeString()}
                                </span>
                            </div>
                            
                            <div className="space-y-1 text-[10px] font-mono mt-2">
                                <div className={triageReport.checks.apiHostPing.ok ? 'text-emerald-500' : 'text-red-400'}>
                                    Host Ping: {triageReport.checks.apiHostPing.ok ? 'OK' : 'FAIL'} ({triageReport.checks.apiHostPing.latencyMs}ms)
                                </div>
                                <div className={triageReport.checks.proxyPing.ok ? 'text-emerald-500' : 'text-red-400'}>
                                    Proxy Ping: {triageReport.checks.proxyPing.ok ? 'OK' : 'FAIL'} ({triageReport.checks.proxyPing.latencyMs}ms)
                                </div>
                                <div className={triageReport.checks.dfsCall.ok ? 'text-emerald-500' : 'text-red-400'}>
                                    DFS Call: {triageReport.checks.dfsCall.ok ? 'OK' : 'FAIL'} (HTTP {triageReport.checks.dfsCall.status || 'N/A'})
                                </div>
                            </div>

                            {triageReport.blockers.length > 0 && (
                                <div className="mt-2 p-2 bg-red-900/50 rounded border border-red-800 text-red-200 text-[10px] font-bold">
                                    BLOCKERS: {triageReport.blockers.join(', ')}
                                </div>
                            )}
                        </div>
                    )}

                    {testResult && !showTriage && (
                        <div className={`p-4 rounded-xl border flex flex-col gap-3 ${testResult.ok ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                            <div className="flex items-start gap-3">
                                {testResult.ok ? (
                                    <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                                ) : (
                                    <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                                )}
                                <div className="flex-1 min-w-0">
                                    <div className={`text-sm font-bold mb-1 ${testResult.ok ? 'text-emerald-800' : 'text-red-800'}`}>
                                        {testResult.ok ? 'Validation Successful' : 'Validation Failed'}
                                    </div>
                                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] font-mono text-slate-600">
                                        <div className="flex justify-between">
                                            <span>Status:</span>
                                            <span className="font-bold">{testResult.status || 'ERR'}</span>
                                        </div>
                                        <div className="flex justify-between">
                                                                                        <span>Latency:</span>
                                            <span className="font-bold">{testResult.latencyMs || 0}ms</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                    <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:text-slate-800">Cancel</button>
                    <button 
                        onClick={handleSave}
                        disabled={saving}
                        className="px-6 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 disabled:opacity-50 shadow-lg"
                    >
                        {saving ? 'Saving...' : 'Save Credentials'}
                    </button>
                </div>
            </div>
        </div>
    );
};
