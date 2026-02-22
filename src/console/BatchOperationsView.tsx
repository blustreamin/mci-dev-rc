
import React, { useState, useEffect } from 'react';
import { Play, PauseCircle, CheckCircle2, XCircle, AlertTriangle, Loader2, ShieldCheck, ChevronDown, ChevronUp, Zap, StopCircle, Plus, Sparkles, FastForward, List, Grid3X3, HeartPulse, ArrowRight, RefreshCw } from 'lucide-react';
import { BatchCertificationService } from '../services/batchCertificationService';
import { BulkLiteVerificationService } from '../services/bulkLiteVerificationService';
import { BatchJobStore } from '../services/batchJobStore';
import { BatchCertificationJob, BatchCertifyTier, BatchCertifyRow, BatchVerificationJob, BatchVerificationRow, CorpusJobControl } from '../types';
import { JobControlService } from '../services/jobControlService';
import { CategoryKeywordGrowthService } from '../services/categoryKeywordGrowthService';
import { CategorySnapshotBuilder } from '../services/categorySnapshotBuilder';
import { SnapshotResolver } from '../services/snapshotResolver';
import { BulkCorpusAutomationService } from '../services/bulkCorpusAutomationService';
import { CorpusHealthRunner } from '../services/corpusHealthRunner';
import { WiringTrace } from '../services/wiringTrace';
import { RuntimeCache } from '../services/runtimeCache';
import { FirestoreClient } from '../services/firestoreClient';
import { CORE_CATEGORIES } from '../constants';
import { AnchorExpansionService } from '../services/anchorExpansionService';
import { runCategorySweep } from '../services/geminiService';
import { OutputSnapshotStore } from '../services/outputSnapshotStore';
import { DateUtils } from '../utils/dateUtils';

export const BatchOperationsView: React.FC = () => {
    const [certJob, setCertJob] = useState<BatchCertificationJob | null>(null);
    const [verifyJob, setVerifyJob] = useState<BatchVerificationJob | null>(null);
    const [loading, setLoading] = useState(false);
    const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
    const toggleRow = (catId: string) => {
        setExpandedRows(prev => ({ ...prev, [catId]: !prev[catId] }));
    };
    const [activeTab, setActiveTab] = useState<'VERIFY' | 'CERTIFY'>('VERIFY');
    const [activeCategoryJobs, setActiveCategoryJobs] = useState<Record<string, CorpusJobControl>>({});
    
    // Auto-Pilot & Batch State
    const [isAutoRunning, setIsAutoRunning] = useState(false);
    const [localStatusMsg, setLocalStatusMsg] = useState('');
    const [batchSize, setBatchSize] = useState(2);
    const [batchCursor, setBatchCursor] = useState(0);

    const loadJobs = async () => {
        try {
            const latestCert = await BatchJobStore.getLatestJob();
            if (latestCert) setCertJob(latestCert);
            const latestVerify = await BatchJobStore.getLatestVerificationJob();
            if (latestVerify) setVerifyJob(latestVerify);
        } catch (e) {
            console.error("Failed to load batch jobs", e);
        }
    };

    useEffect(() => {
        loadJobs();
        const interval = setInterval(async () => {
            const runningCert = certJob?.status === 'RUNNING';
            const runningVerify = verifyJob?.status === 'RUNNING';
            if (runningCert) {
                const updated = await BatchJobStore.getLatestJob();
                if (updated && updated.jobId === certJob?.jobId) setCertJob(updated);
            }
            if (runningVerify) {
                const updated = await BatchJobStore.getLatestVerificationJob();
                if (updated && updated.jobId === verifyJob?.jobId) setVerifyJob(updated);
            }
            if (isAutoRunning) {
                setLocalStatusMsg(BulkCorpusAutomationService.statusMessage || CorpusHealthRunner.statusMessage);
            }
        }, 2000);

        const unsub = RuntimeCache.subscribe(() => {
            loadJobs();
        });

        return () => {
            clearInterval(interval);
            unsub();
        };
    }, [certJob?.jobId, verifyJob?.jobId, certJob?.status, verifyJob?.status, isAutoRunning]);

    const handleRowAction = async (catId: string, action: 'GROW' | 'VALIDATE' | 'CERTIFY' | 'STOP' | 'FIX_DEMAND') => {
        try {
            if (action === 'STOP') {
                const active = await JobControlService.getActiveJobForCategory(catId);
                if (active) await JobControlService.requestStop(active.jobId);
                return;
            }

            if (action === 'FIX_DEMAND') {
                // One-click recovery flow
                const jobId = await JobControlService.startJob('GROW', catId, { message: 'Fixing Category Demand...' });
                try {
                    // 1. Resolve/Draft
                    let res = await SnapshotResolver.resolveActiveSnapshot(catId, 'IN', 'en');
                    let snapshotId = res.snapshot?.snapshot_id;
                    
                    if (!snapshotId) {
                        const draft = await CategorySnapshotBuilder.ensureDraft(catId, 'IN', 'en');
                        if (!draft.ok) throw new Error("Draft failed");
                        snapshotId = draft.data.snapshot_id;
                    }

                    // 2. Expand Anchors
                    await JobControlService.updateProgress(jobId, { message: 'Expanding Anchors...' });
                    await AnchorExpansionService.expandToMinPassingAnchors(catId, snapshotId, { jobId });

                    // 3. Hydrate & Grow (Ensures volume)
                    await JobControlService.updateProgress(jobId, { message: 'Hydrating & Validating...' });
                    await CategoryKeywordGrowthService.ensureAnchorQuotaAndValidate(catId, snapshotId, { tier: 'FULL' }, jobId);

                    // 4. Certify
                    await JobControlService.updateProgress(jobId, { message: 'Certifying...' });
                    const certRes = await CategorySnapshotBuilder.certify(snapshotId, catId, 'IN', 'en', 'FULL', jobId);
                    if (!certRes.ok) throw new Error(`Certification Failed: ${(certRes as any).error}`);

                    // 5. Run Demand Sweep
                    await JobControlService.updateProgress(jobId, { message: 'Running Demand Sweep...' });
                    const cat = CORE_CATEGORIES.find(c => c.id === catId);
                    if (!cat) throw new Error("Cat config missing");
                    
                    // Fixed: Passing correct arguments to runCategorySweep to satisfy expected signature.
                    const demandRes = await runCategorySweep(cat, null, 'India', () => {}, new AbortController().signal, undefined, { jobId, runId: `FIX_${Date.now()}`, windowId: DateUtils.getCurrentMonthKey(), registryHash: '', keywordBaseHash: '', budget: {} }, undefined, undefined, { forceRecalculate: true });
                    
                    if (!demandRes.ok || !demandRes.data) throw new Error("Demand Run Failed");
                    
                    // Save
                    // Fix: passed undefined for month (5th arg) to satisfy signature, {} for strategy, demandRes.data for demand
                    await OutputSnapshotStore.createOutputSnapshot(snapshotId, catId, 'IN', 'en', undefined, {}, demandRes.data);

                    await JobControlService.finishJob(jobId, 'COMPLETED', 'Demand Fixed');
                    alert(`Success! Demand Index: ${demandRes.data.demand_index_mn} Mn`);
                } catch (e: any) {
                    await JobControlService.finishJob(jobId, 'FAILED', e.message);
                    alert(`Fix Failed: ${e.message}`);
                }
                return;
            }

            const kindMap: Record<string, CorpusJobControl['kind']> = {
                GROW: 'GROW',
                VALIDATE: 'VALIDATE',
                CERTIFY: 'CERTIFY'
            };

            const jobId = await JobControlService.startJob(kindMap[action], catId);
            const stopHeartbeat = JobControlService.startHeartbeat(jobId);

            try {
                const res = await SnapshotResolver.resolveActiveSnapshot(catId, 'IN', 'en');
                if (res.ok && res.snapshot) {
                    const snapId = res.snapshot.snapshot_id;
                    if (action === 'GROW') await CategoryKeywordGrowthService.growCategory(catId, snapId, 300, undefined, jobId);
                    else if (action === 'VALIDATE') await CategoryKeywordGrowthService.validateSnapshot(catId, snapId, 'IN', 'en', undefined, jobId);
                    else if (action === 'CERTIFY') await CategorySnapshotBuilder.certify(snapId, catId, 'IN', 'en', 'FULL', jobId);
                    // Fix: use 'COMPLETED'
                    await JobControlService.finishJob(jobId, 'COMPLETED');
                } else {
                    await JobControlService.finishJob(jobId, 'FAILED', "No snapshot found");
                }
            } finally {
                stopHeartbeat();
            }
        } catch (e) {
            console.error("Row Action Failed", e);
        }
        // Immediate refresh to reflect new job state
        await loadJobs();
    };

    const runNextBatch = async () => {
        const batchCats = CORE_CATEGORIES.slice(batchCursor, batchCursor + batchSize);
        if (batchCats.length === 0) {
            alert("All categories processed!");
            return;
        }

        if (!confirm(`Run Health Fix for ${batchCats.length} categories (Start: ${batchCats[0].category})?`)) return;

        setIsAutoRunning(true);
        setLocalStatusMsg(`Batch processing ${batchCats.length} items...`);

        try {
            // Use the Runner for sequential execution of the batch
            await CorpusHealthRunner.runBatchHealthFix(batchCats.map(c => c.id), (msg) => setLocalStatusMsg(msg));
            
            setBatchCursor(prev => prev + batchCats.length);
            setLocalStatusMsg("Batch Complete.");
            await loadJobs();
        } catch (e: any) {
            console.error(e);
            setLocalStatusMsg(`Batch Failed: ${e.message}`);
        } finally {
            setIsAutoRunning(false);
        }
    };

    const handleStartVerify = async () => {
        setLoading(true);
        setActiveTab('VERIFY');
        try {
            await BulkLiteVerificationService.startBatch();
            await loadJobs();
        } finally {
            setLoading(false);
        }
    };

    const handleStop = async () => {
        if (isAutoRunning) BulkCorpusAutomationService.stop();
        else if (activeTab === 'CERTIFY') await BatchCertificationService.stopBatch();
        else await BulkLiteVerificationService.stopBatch();
        await loadJobs();
    };

    const renderRow = (catId: string, name: string, status: string, lifecycle: string) => (
        <div key={catId} className="border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
            <div className="flex items-center justify-between p-3 cursor-pointer" onClick={() => toggleRow(catId)}>
                <div className="flex items-center gap-3 flex-1">
                    <div className={`p-1 rounded ${status === 'CERTIFIED' || status === 'VALIDATED_LITE' ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                        {status === 'CERTIFIED' || status === 'VALIDATED_LITE' ? <CheckCircle2 className="w-4 h-4"/> : <Loader2 className="w-4 h-4"/>}
                    </div>
                    <div>
                        <div className="text-xs font-bold text-slate-800">{name}</div>
                        <div className="text-[10px] text-slate-400">{lifecycle}</div>
                    </div>
                </div>
            </div>
            {expandedRows[catId] && (
                <div className="bg-slate-50 p-3 pl-12 border-t border-slate-100">
                    <div className="flex items-center justify-end gap-2">
                        {activeCategoryJobs[catId] ? (
                             <span className="text-[10px] font-bold text-indigo-600 flex items-center gap-1">
                                <Loader2 className="w-3 h-3 animate-spin"/> {activeCategoryJobs[catId].kind}
                             </span>
                        ) : (
                            <>
                                <button onClick={() => handleRowAction(catId, 'FIX_DEMAND')} className="px-2 py-1 bg-indigo-600 text-white rounded text-[10px] font-bold flex items-center gap-1"><RefreshCw className="w-3 h-3"/> Fix Demand</button>
                                <button onClick={() => handleRowAction(catId, 'GROW')} className="px-2 py-1 bg-white border border-slate-200 text-slate-600 rounded text-[10px] font-bold">Grow</button>
                                <button onClick={() => handleRowAction(catId, 'VALIDATE')} className="px-2 py-1 bg-white border border-slate-200 text-slate-600 rounded text-[10px] font-bold">Validate</button>
                                <button onClick={() => handleRowAction(catId, 'CERTIFY')} className="px-2 py-1 bg-white border border-slate-200 text-slate-600 rounded text-[10px] font-bold">Certify</button>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );

    const activeJob = activeTab === 'CERTIFY' ? certJob : verifyJob;
    const pendingCount = CORE_CATEGORIES.length - batchCursor;

    return (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-8">
            <div className="p-6 border-b border-slate-100 bg-slate-50/50">
                <div className="flex flex-col md:flex-row justify-between items-center gap-6 mb-6">
                    <div className="flex items-center gap-4">
                        <div className="p-3 bg-indigo-100 text-indigo-600 rounded-xl shadow-sm">
                            <ShieldCheck className="w-6 h-6"/>
                        </div>
                        <div>
                            <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">Batch Operations</h3>
                            <div className="flex gap-4 mt-1">
                                <button onClick={() => setActiveTab('VERIFY')} className={`text-xs font-bold uppercase ${activeTab === 'VERIFY' ? 'text-indigo-600' : 'text-slate-400'}`}>Verification</button>
                                <button onClick={() => setActiveTab('CERTIFY')} className={`text-xs font-bold uppercase ${activeTab === 'CERTIFY' ? 'text-indigo-600' : 'text-slate-400'}`}>Certification</button>
                            </div>
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                        {isAutoRunning ? (
                            <button onClick={handleStop} className="flex items-center gap-2 px-6 py-3 bg-red-50 text-red-600 border border-red-100 rounded-xl text-xs font-bold hover:bg-red-100 transition-all">
                                <StopCircle className="w-4 h-4"/> Stop Operations
                            </button>
                        ) : activeTab === 'CERTIFY' ? (
                            <div className="flex flex-wrap gap-3 justify-end items-center bg-white p-2 rounded-xl border border-slate-200 shadow-sm">
                                <div className="flex items-center gap-2 px-2">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase">Batch Size:</span>
                                    <select 
                                        value={batchSize} 
                                        onChange={(e) => setBatchSize(Number(e.target.value))}
                                        className="text-xs font-bold border-slate-200 rounded p-1"
                                    >
                                        <option value={1}>1</option>
                                        <option value={2}>2</option>
                                        <option value={4}>4</option>
                                    </select>
                                </div>
                                <div className="h-6 w-px bg-slate-200" />
                                <button 
                                    onClick={runNextBatch}
                                    disabled={pendingCount <= 0}
                                    className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-black uppercase tracking-widest hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm transition-all"
                                >
                                    <FastForward className="w-3.5 h-3.5"/> Run Next Batch ({pendingCount} Left)
                                </button>
                            </div>
                        ) : (
                            <button onClick={handleStartVerify} className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 shadow-md">
                                <Zap className="w-4 h-4"/> Run Verify All
                            </button>
                        )}
                    </div>
                </div>

                {isAutoRunning && (
                    <div className="bg-indigo-50 p-3 rounded-lg border border-indigo-100 text-center animate-pulse flex items-center justify-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin text-indigo-600"/>
                        <span className="text-xs font-bold text-indigo-700">
                            {localStatusMsg || "Processing Task..."}
                        </span>
                    </div>
                )}
            </div>

            <div className="max-h-[400px] overflow-y-auto custom-scrollbar bg-white">
                {activeJob ? (
                    <div className="divide-y divide-slate-100">
                        {activeJob.rows.slice().reverse().map(row => renderRow(row.categoryId, row.categoryName, row.status, row.lifecycle || ''))}
                    </div>
                ) : (
                    <div className="p-8 text-center text-slate-400 text-xs font-medium italic">
                        Select an action to begin batch processing.
                    </div>
                )}
            </div>
        </div>
    );
};
