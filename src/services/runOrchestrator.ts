
import React from 'react';
import { 
    RunPlan, WorkflowGear, JobType, AuditLogEntry, 
    FetchableData, PreSweepData, SweepResult, DeepDiveResult, PlaybookResult, TaskStage
} from '../types';
import { CORE_CATEGORIES } from '../constants';
import { JobRunner } from './jobRunner';
import { getCachedResult, setCachedResult } from '../persistenceService';
import { runPreSweepIntelligence, runCategorySweep, runSingleDeepDive, runSinglePlaybook } from './geminiService';

export interface AppSetters {
    setStrategyResults: React.Dispatch<React.SetStateAction<Record<string, FetchableData<PreSweepData>>>>;
    setDemandResults: React.Dispatch<React.SetStateAction<Record<string, FetchableData<SweepResult>>>>;
    setDeepDiveResults: React.Dispatch<React.SetStateAction<Record<string, FetchableData<DeepDiveResult>>>>;
    setPlaybookResults: React.Dispatch<React.SetStateAction<Record<string, FetchableData<PlaybookResult>>>>;
}

export const RunOrchestrator = {
    
    activePlanAbortController: null as AbortController | null,

    createPlan(
        categoryIds: string[], 
        gears: WorkflowGear[], 
        mode: RunPlan['executionMode'] = 'SEQUENTIAL_BY_CATEGORY',
        batchSize: number = 3,
        concurrency: number = 2
    ): RunPlan {
        return {
            id: `PLAN-${Date.now()}`,
            createdAt: new Date().toISOString(),
            selectedCategories: categoryIds,
            selectedGears: gears,
            executionMode: mode,
            batch: {
                categoryBatchSize: batchSize,
                maxConcurrency: concurrency
            },
            status: 'PENDING',
            totalTasks: categoryIds.length * gears.length, 
            completedTasks: 0
        };
    },

    stopPlan() {
        if (this.activePlanAbortController) {
            this.activePlanAbortController.abort();
            this.activePlanAbortController = null;
        }
    },

    async executePlan(plan: RunPlan, setters: AppSetters, onTaskUpdate?: () => void) {
        this.activePlanAbortController = new AbortController();
        const signal = this.activePlanAbortController.signal;

        try {
            plan.status = 'RUNNING';
            
            // Sequential Worker for V1 Stability
            for (const catId of plan.selectedCategories) {
                if (signal.aborted) break;
                
                try {
                    await this.runCategoryPipeline(catId, plan.selectedGears, setters, signal, plan.id);
                    plan.completedTasks += plan.selectedGears.length;
                    onTaskUpdate?.();
                } catch (error) {
                    console.error(`Pipeline failed for ${catId}`, error);
                }
            }

            if (signal.aborted) {
                plan.status = 'CANCELLED';
            } else {
                plan.status = 'COMPLETED';
            }

        } catch (e) {
            console.error("Plan Execution Critical Failure", e);
            plan.status = 'FAILED';
        } finally {
            this.activePlanAbortController = null;
            onTaskUpdate?.();
        }
    },

    /**
     * Runs the sequence of gears for a single category.
     * Enforces dependencies: Strategy -> Demand -> Deep Dive -> Playbook.
     */
    async runCategoryPipeline(
        catId: string, 
        selectedGears: WorkflowGear[], 
        setters: AppSetters, 
        signal: AbortSignal, 
        planId: string
    ) {
        const cat = CORE_CATEGORIES.find(c => c.id === catId);
        if (!cat) return;

        // Context accumulator for this category pipeline
        const context: {
            strategy?: PreSweepData;
            demand?: SweepResult;
            deepDive?: DeepDiveResult;
        } = {};

        // Helper to check if a gear is requested
        const isRequested = (g: WorkflowGear) => selectedGears.includes(g);

        // --- STEP 1: STRATEGY ---
        if (isRequested(WorkflowGear.STRATEGY) || isRequested(WorkflowGear.DEMAND) || isRequested(WorkflowGear.DEEP_DIVE) || isRequested(WorkflowGear.PLAYBOOK)) {
            const shouldRun = isRequested(WorkflowGear.STRATEGY);
            
            // Check cache first
            const cachedStrat = await getCachedResult<PreSweepData>(`preSweepV1::${cat.id}`);
            
            if (cachedStrat) {
                context.strategy = cachedStrat;
                if (shouldRun) {
                     // Register quick job to show it checked
                     const job = await JobRunner.createJob('BUILD_STRATEGY', catId, 'v1');
                     await JobRunner.updateJob(job, { status: 'COMPLETED', progress: 100, message: 'Loaded from cache' });
                }
                setters.setStrategyResults(prev => ({ ...prev, [cat.id]: { status: 'Success', data: cachedStrat, lastAttempt: new Date().toISOString() } }));
            } else if (shouldRun) {
               await this.runStep(catId, 'BUILD_STRATEGY', planId, signal, async (logFn) => {
                   const res = await runPreSweepIntelligence(cat, 'India', logFn, signal);
                   if (res.ok) {
                       context.strategy = res.data;
                       await setCachedResult(`preSweepV1::${cat.id}`, res.data);
                       setters.setStrategyResults(prev => ({ ...prev, [cat.id]: { status: 'Success', data: res.data, lastAttempt: new Date().toISOString() } }));
                   } else {
                       throw new Error((res as any).error || "Strategy generation produced no data");
                   }
               });
            } else {
                // Dependency needed but missing. Auto-run? For V1, we'll try to run it.
                await this.runStep(catId, 'BUILD_STRATEGY', planId, signal, async (logFn) => {
                   const res = await runPreSweepIntelligence(cat, 'India', logFn, signal);
                   if (res.ok) {
                       context.strategy = res.data;
                       await setCachedResult(`preSweepV1::${cat.id}`, res.data);
                       setters.setStrategyResults(prev => ({ ...prev, [cat.id]: { status: 'Success', data: res.data, lastAttempt: new Date().toISOString() } }));
                   } else {
                        // Soft fail for dependency
                        console.warn("Skipping dependent gears due to Strategy failure");
                        throw new Error("Dependency Failed: Strategy");
                   }
               });
            }
        }

        // Check if strategy exists before proceeding
        if (!context.strategy) return;

        // --- STEP 2: DEMAND ---
        if (isRequested(WorkflowGear.DEMAND) || isRequested(WorkflowGear.DEEP_DIVE) || isRequested(WorkflowGear.PLAYBOOK)) {
            // Auto-run demand if downstream gears need it
            await this.runStep(catId, 'RUN_DEMAND', planId, signal, async (logFn) => {
                const res = await runCategorySweep(cat, context.strategy, 'India', logFn, signal, undefined, { jobId: 'PLAN', runId: planId, windowId: 'now', registryHash: '', keywordBaseHash: '', budget: {} as any });
                if (res.ok) {
                    context.demand = res.data;
                    setters.setDemandResults(prev => ({ ...prev, [cat.id]: { status: 'Success', data: res.data, lastAttempt: new Date().toISOString() } }));
                } else {
                    throw new Error((res as any).error || "Demand sweep failed");
                }
            });
        }

        // --- STEP 3: DEEP DIVE ---
        if ((isRequested(WorkflowGear.DEEP_DIVE) || isRequested(WorkflowGear.PLAYBOOK)) && context.demand) {
            // Auto-run deep dive if Playbook needs it
            await this.runStep(catId, 'RUN_DEEP_DIVE', planId, signal, async () => {
                const res = await runSingleDeepDive(catId, planId, context.demand);
                if (res.ok) {
                    context.deepDive = res.data;
                    setters.setDeepDiveResults(prev => ({ ...prev, [catId]: { status: 'Success', data: res.data, lastAttempt: new Date().toISOString() } }));
                } else {
                    throw new Error((res as any).error || "Deep Dive failed");
                }
            });
        }

        // --- STEP 4: PLAYBOOK ---
        if (isRequested(WorkflowGear.PLAYBOOK) && context.deepDive) {
            await this.runStep(catId, 'GENERATE_PLAYBOOK', planId, signal, async () => {
                const res = await runSinglePlaybook(catId, context.deepDive);
                if (res.ok) {
                    setters.setPlaybookResults(prev => ({ ...prev, [catId]: { status: 'Success', data: res.data, lastAttempt: new Date().toISOString() } }));
                } else {
                    throw new Error((res as any).error || "Playbook generation failed");
                }
            });
        }
    },

    async runStep(
        catId: string, 
        type: JobType, 
        planId: string, 
        signal: AbortSignal, 
        action: (logFn: (l: AuditLogEntry) => void) => Promise<void>
    ) {
        if (signal.aborted) return;
        const job = await JobRunner.createJob(type, catId, 'v1');
        await JobRunner.updateJob(job, { status: 'RUNNING', message: 'Starting...' });
        
        try {
            await action((l) => JobRunner.updateJob(job, { logs: [...(job.logs||[]), l.message] }));
            await JobRunner.updateJob(job, { status: 'COMPLETED', progress: 100, message: 'Done' });
        } catch (e: any) {
            if (signal.aborted) {
                await JobRunner.updateJob(job, { status: 'CANCELLED', message: 'Plan Cancelled' });
            } else {
                await JobRunner.updateJob(job, { status: 'FAILED', error: e.message, message: 'Failed' });
                throw e; // Propagate to stop pipeline
            }
        }
    }
};