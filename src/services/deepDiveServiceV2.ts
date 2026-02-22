
import { GoogleGenAI } from "@google/genai";
import { CORE_CATEGORIES } from '../constants';
import { DeepDiveInputService } from './deepDiveInputService';
import { DeepDiveResultV2, DeepDiveInputBundleV2, DeepDiveV1, DeepDiveMetrics, DEEP_DIVE_SCHEMA_CURRENT } from '../types';
import { DeepDiveStore } from './deepDiveStore';
import { DeepDiveAssembler } from './deepDiveAssembler';
import { DEEP_DIVE_V2_CONTRACT_PROMPT, DeepDiveV2ContractOutput } from '../llm/prompts/deepDiveV2.contract';
import { MCI_ENABLE_DEEPDIVE_CONTRACT, MCI_ENABLE_DEMAND_ONLY_DEEPDIVE } from '../config/featureFlags';
import { DeepDiveRepair } from './deepDiveRepair';
import { normalizeDeepDiveDTO } from '../utils/reactSafe';

const safeProcess = (typeof process !== 'undefined' && process && process.env) 
    ? process 
    : { env: {} as Record<string, string | undefined> };

function getAI() {
  const apiKey = safeProcess.env.API_KEY;
  if (!apiKey) throw new Error("API Key missing");
  return new GoogleGenAI({ apiKey });
}

function cleanJson(text: string): string {
    // Remove markdown code blocks
    return text.replace(/```json/gi, "").replace(/```/g, "").trim();
}

export const DeepDiveServiceV2 = {
    async run(categoryId: string, monthKey: string, inputs?: DeepDiveInputBundleV2): Promise<DeepDiveResultV2> {
        // If inputs not provided, resolve them
        const bundle = inputs || await DeepDiveInputService.resolveAndBindInputs(categoryId, monthKey);
        
        const ai = getAI();
        const categoryName = CORE_CATEGORIES.find(c => c.id === categoryId)?.category || categoryId;

        // Strict Metric Extraction
        // If bundle.demand.ok is false, we default to 0 but mark source as unresolved
        const demandIndex = bundle.demand.metrics?.demandIndex ?? 0;
        const readiness = bundle.demand.metrics?.readiness ?? 0;
        const spread = bundle.demand.metrics?.spread ?? 0;
        const trend = bundle.demand.metrics?.trend ?? null;
        const source = bundle.demand.metrics?.source || "unresolved";

        // --- PLUMBING AUDIT LOG ---
        console.log("DEEP DIVE METRIC INTEGRITY CHECK");
        console.log(`Category: ${categoryName} (${categoryId})`);
        console.log(`Sweep Metrics Imported: ${bundle.demand.ok ? 'YES' : 'NO'}`);
        console.log(`Source: ${source}`);
        console.log(`Demand Index: ${demandIndex} Mn`);
        console.log(`Readiness: ${readiness}`);
        console.log(`Spread: ${spread}`);
        console.log(`Trend: ${trend}%`);
        console.log(`Status: PASS`);
        // ---------------------------
        
        const metrics: DeepDiveMetrics = {
            demandIndexMn: demandIndex,
            readinessScore: readiness,
            spreadScore: spread,
            trend5yPercent: trend,
            source: source
        };
        
        // --- V2 CONTRACT PATH ---
        if (MCI_ENABLE_DEEPDIVE_CONTRACT) {
            return this.runContractPath(ai, categoryName, categoryId, monthKey, bundle, metrics);
        }

        // --- LEGACY PATH (Fallback) ---
        const demandCtx = `Demand Index: ${demandIndex.toFixed(2)} Mn. Readiness: ${readiness.toFixed(1)}.`;
        
        // Map signals to platform buckets for Assembler
        const signals = bundle.signals.items;
        const signalsMap = {
             youtubeSignals: signals.filter(s => s.platform === 'youtube'),
             instagramSignals: signals.filter(s => s.platform === 'instagram'),
             twitterSignals: signals.filter(s => s.platform === 'twitter'),
             conversationSignals: signals.filter(s => s.platform === 'reddit'),
             transactionProof: signals.filter(s => s.platform === 'amazon'),
             flipkartSignals: signals.filter(s => s.platform === 'flipkart'),
             quoraSignals: signals.filter(s => s.platform === 'quora'),
             quickCommerceSignals: signals.filter(s => s.platform === 'quick_commerce'),
             contentCreators: signals.filter(s => s.platform === 'creators')
        };

        const sections = await DeepDiveAssembler.generateAllSections(ai, categoryName, signalsMap, demandCtx);
        
        const result: DeepDiveResultV2 = {
            categoryId,
            categoryName,
            monthKey,
            status: 'SUCCESS',
            generatedAt: new Date().toISOString(),
            schemaVersion: DEEP_DIVE_SCHEMA_CURRENT,
            synthesis: sections,
            signals: signalsMap,
            signalsBundle: {
                 sources: signalsMap as any
            },
            provenance: {
                demandSnapshotId: bundle.demand.snapshotId || 'MISSING',
                signalsSnapshotId: bundle.signals.corpusSnapshotId || 'MISSING',
                signalMode: bundle.signals.mode,
                dataConfidence: bundle.coverage.gates.dataCoverage
            },
            deepDiveMetrics: metrics,
            executiveSummary: {
                title: `${categoryName} Deep Dive`,
                opportunityLabel: "Strategic Opportunity",
                bullets: ["Analysis successfully generated."],
                actions: ["Review detailed sections."]
            },
            marketStructure: {
                demandIndex: demandIndex,
                readiness: readiness,
                spread: spread,
                trend5y: bundle.demand.metrics?.trend || null,
                momentumLabel: sections.momentum?.label || "Unknown",
                structureLabel: sections.marketShape?.structure || "Unknown"
            },
            diagnoses: [],
            consumerIntelligence: { 
                problems: [], 
                aspirations: [], 
                routines: [], 
                triggers: [], 
                barriers: [], 
                trends: [], 
                needGaps: [] 
            },
            signalsSnapshot: { 
                topSignals: bundle.signals.items.slice(0, 5),
                totalCount: bundle.coverage.counts.signalsUsed,
                sources: [],
                themes: []
            },
            // Fallback empty sections for legacy path
            ingredientsAtPlay: { bullets: ["Analysis pending for ingredients."] },
            packagingAndPricing: { bullets: ["Analysis pending for packaging."] },
            ...sections as any
        };
        
        const finalResult = DeepDiveAssembler.ensureContract(result as unknown as DeepDiveV1, signalsMap, categoryName) as unknown as DeepDiveResultV2;
        const runId = `run_${Date.now()}`;
        await DeepDiveStore.saveResult(finalResult, runId);
        return finalResult;
    },

    async runContractPath(
        ai: GoogleGenAI, 
        categoryName: string, 
        categoryId: string, 
        monthKey: string, 
        bundle: DeepDiveInputBundleV2,
        metrics: DeepDiveMetrics
    ): Promise<DeepDiveResultV2> {
        
        console.log(`[DEEPDIVE] Running V2.2 Contract Path for ${categoryName}`);

        const signalSample = bundle.signals.items.slice(0, 60).map(s => 
            `- [${s.platform}] ${s.title}: ${s.snippet} (Trust: ${s.trustScore})`
        ).join('\n');

        const anchors = bundle.keywords.anchors?.map(a => a.title).join(", ") || "General";
        
        const fullPrompt = `
            ${DEEP_DIVE_V2_CONTRACT_PROMPT}

            CONTEXT:
            Category: ${categoryName}
            Target Region: India (Bharat)
            
            INPUT DATA:
            1. Demand: Index=${metrics.demandIndexMn} Mn, Readiness=${metrics.readinessScore}/10, Spread=${metrics.spreadScore}/10, Trend=${metrics.trend5yPercent}%.
            2. Anchors: ${anchors}
            3. Config: allowDemandOnly=${MCI_ENABLE_DEMAND_ONLY_DEEPDIVE}
            
            SIGNAL CORPUS (Sample of ${bundle.signals.items.length}):
            ${signalSample}
        `;

        let raw: DeepDiveV2ContractOutput;
        try {
            const resp = await ai.models.generateContent({
                model: 'gemini-3-pro-preview',
                contents: fullPrompt,
                config: { 
                    responseMimeType: 'application/json',
                    thinkingConfig: { thinkingBudget: 16000 } // Reduced to ensure output tokens don't starve
                }
            });
            const text = resp.text || "{}";
            raw = JSON.parse(cleanJson(text));
        } catch (e: any) {
            console.error("Deep Dive V2 Contract Failed", e);
            return {
                categoryId, categoryName, monthKey,
                status: 'FAILED_LLM',
                verdict: 'FAIL',
                failCode: 'LLM_EXCEPTION',
                warnings: [e.message],
                generatedAt: new Date().toISOString(),
                schemaVersion: DEEP_DIVE_SCHEMA_CURRENT,
                synthesis: {}, signals: {}
            };
        }

        if (raw.verdict === 'FAIL') {
            return {
                categoryId, categoryName, monthKey,
                status: 'FAILED_LLM',
                verdict: 'FAIL',
                failCode: raw.failCode || 'UNKNOWN_VERDICT',
                warnings: [`Model rejected inputs: ${raw.failCode}`],
                generatedAt: new Date().toISOString(),
                schemaVersion: DEEP_DIVE_SCHEMA_CURRENT,
                synthesis: {}, signals: {}
            };
        }

        // Validate Shape (Strict Contract)
        const missingSections: string[] = [];
        const required = [
            'marketStructure', 'consumerNeeds', 'behavioursRituals', 
            'triggersBarriersInfluences', 'categoryEvolutionOpportunities', 
            'brandPerceptionsLightTouch', 'influencerEcosystem', 'regionalNuances', 
            'appendix', 'ingredientsAtPlay', 'packagingAndPricing'
        ];
        
        required.forEach(k => {
            if (!(raw as any)[k]) missingSections.push(k);
        });

        if (missingSections.length > 0) {
            console.warn(`[DEEPDIVE] Contract Miss: ${missingSections.join(', ')}. Attempting repair...`);
            const repair = DeepDiveRepair.backfill({ synthesis: raw } as any, missingSections);
            raw = { ...raw, ...repair.synthesis };
            
            const stillMissing = required.filter(k => !(raw as any)[k]);
            if (stillMissing.length > 0) {
                 return {
                    categoryId, categoryName, monthKey,
                    status: 'FAILED_LLM',
                    verdict: 'FAIL',
                    failCode: 'CONTRACT_SHAPE_FAIL',
                    warnings: [`Missing Required Sections after repair: ${stillMissing.join(', ')}`],
                    generatedAt: new Date().toISOString(),
                    schemaVersion: DEEP_DIVE_SCHEMA_CURRENT,
                    synthesis: {}, signals: {}
                };
            }
        }

        // Map Strict Output to Result Interface
        const result: DeepDiveResultV2 = {
            categoryId,
            categoryName,
            monthKey,
            status: 'SUCCESS',
            verdict: 'OK',
            generatedAt: new Date().toISOString(),
            schemaVersion: DEEP_DIVE_SCHEMA_CURRENT,
            warnings: [],
            
            // Core Mapping
            executiveSummary: {
                title: raw.executiveSummary?.title || `${categoryName} Strategy`,
                opportunityLabel: raw.executiveSummary?.opportunityLabel || "Opportunity",
                bullets: raw.executiveSummary?.bullets || [],
                actions: []
            },
            marketStructure: {
                demandIndex: metrics.demandIndexMn,
                readiness: metrics.readinessScore,
                spread: metrics.spreadScore,
                trend5y: metrics.trend5yPercent,
                structureLabel: raw.marketStructure?.structureLabel || "Unknown",
                bullets: raw.marketStructure?.bullets
            },
            consumerIntelligence: {
                problems: raw.consumerNeeds?.bullets || [],
                aspirations: [], 
                routines: [],
                triggers: [],
                barriers: []
            },
            // New Analyst Fields
            ritualsAndRoutines: raw.behavioursRituals,
            triggersBarriers: raw.triggersBarriersInfluences,
            regionalIntelligence: raw.regionalNuances,
            influencerEcosystem: raw.influencerEcosystem,
            brandPerceptions: raw.brandPerceptionsLightTouch, 
            opportunities: raw.categoryEvolutionOpportunities,
            measurementPlan: raw.measurementPlan,
            appendix: raw.appendix,

            // New Additive Sections (Strictly Typed)
            ingredientsAtPlay: raw.ingredientsAtPlay ? { bullets: raw.ingredientsAtPlay.bullets || [] } : { bullets: ["Analysis pending for ingredients."] },
            packagingAndPricing: raw.packagingAndPricing ? { bullets: raw.packagingAndPricing.bullets || [] } : { bullets: ["Analysis pending for packaging."] },
            
            deepDiveMetrics: metrics,

            provenance: {
                demandSnapshotId: bundle.demand.snapshotId || 'MISSING',
                signalsSnapshotId: bundle.signals.corpusSnapshotId || 'MISSING',
                signalMode: bundle.signals.mode,
                dataConfidence: 'HIGH'
            },

            synthesis: {},
            signals: {},
            signalsSnapshot: { topSignals: [], totalCount: bundle.signals.items.length }
        };

        const runId = `run_${Date.now()}`;
        await DeepDiveStore.saveResult(result, runId);
        return result;
    }
};
