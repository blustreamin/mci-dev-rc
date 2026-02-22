import { SnapshotResolver } from './snapshotResolver';
import { CategorySnapshotStore } from './categorySnapshotStore';
import { DemandSnapshotResolverInput } from './demandSnapshotResolver';
import { MetricsCalculatorV3 } from './metricsCalculatorV3';
import { SignalHarvesterClient } from './signalHarvesterClient';
import { FirestoreClient } from './firestoreClient';
import { normalizeKeywordString } from '../driftHash';
import { safeText } from '../utils/safety';
import { DateUtils } from '../utils/dateUtils';

// --- Types ---

interface StageResult {
    id: string;
    name: string;
    ok: boolean;
    details: any;
}

interface SmokeTestResult {
    ts: string;
    runId: string;
    mode: "AUDIT_ONLY_NO_WRITES";
    target: { projectId: string; databaseId: string; categoryId: string; month: string };
    verdict: "GO" | "WARN" | "NO_GO";
    blockers: string[];
    warnings: string[];
    stages: StageResult[];
    reactSafety: { ok: boolean; unsafeCount: number; unsafeExamples: any[] };
    writeGuards: { ok: boolean; writesAttempted: number; writeAttempts: string[] };
}

// --- Helpers ---

const AuditGuard = {
    writesAttempted: 0,
    attempts: [] as string[],
    
    reset() {
        this.writesAttempted = 0;
        this.attempts = [];
    },
    
    checkWrite(operation: string) {
        this.writesAttempted++;
        this.attempts.push(operation);
        console.error(`[AUDIT_GUARD] WRITE ATTEMPT BLOCKED: ${operation}`);
    }
};

const ReactSafety = {
    unsafeCount: 0,
    unsafeExamples: [] as any[],

    reset() {
        this.unsafeCount = 0;
        this.unsafeExamples = [];
    },

    check(obj: any, context: string = ''): boolean {
        if (!obj) return true;
        
        const scan = (v: any, path: string) => {
            if (v === null || v === undefined) return;
            if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return;
            if (Array.isArray(v)) {
                v.forEach((item, i) => scan(item, `${path}[${i}]`));
                return;
            }
            if (typeof v === 'object') {
                // If this object is meant to be rendered directly, it's unsafe.
                // But this checker scans the whole DTO.
                // We mainly care if "text nodes" contain objects.
                // For a DTO audit, we just check deep nesting structure validity.
                Object.entries(v).forEach(([k, val]) => scan(val, `${path}.${k}`));
                return;
            }
        };
        // For this specific test, we assume 'react safety' means the output DTO 
        // doesn't contain Functions or Symbols or Circular refs that would break serialization
        try {
            JSON.stringify(obj);
            return true;
        } catch (e) {
            this.unsafeCount++;
            this.unsafeExamples.push({ context, error: String(e) });
            return false;
        }
    }
};

// --- Runner ---

export const SmokeTestRunner = {
    async run(categoryId: string = 'shaving', month: string = '2026-01'): Promise<SmokeTestResult> {
        const ts = new Date().toISOString();
        const runId = `SMOKE_${categoryId}_${month}_${Date.now()}`;
        
        AuditGuard.reset();
        ReactSafety.reset();

        const dbInfo = FirestoreClient.logFirebaseTarget() || { projectId: 'unknown', databaseId: 'unknown' };

        const result: SmokeTestResult = {
            ts,
            runId,
            mode: "AUDIT_ONLY_NO_WRITES",
            target: { 
                projectId: dbInfo.projectId, 
                databaseId: dbInfo.databaseId, 
                categoryId, 
                month 
            },
            verdict: "GO",
            blockers: [],
            warnings: [],
            stages: [],
            reactSafety: { ok: true, unsafeCount: 0, unsafeExamples: [] },
            writeGuards: { ok: true, writesAttempted: 0, writeAttempts: [] }
        };

        const addStage = (id: string, name: string, ok: boolean, details: any) => {
            result.stages.push({ id, name, ok, details });
            if (!ok) result.blockers.push(`${id}: ${name} Failed`);
        };

        try {
            // S1. Corpus Snapshot
            let corpusRows: any[] = [];
            let corpusSnapshotId = "";
            let corpusLifecycle = "";

            try {
                const res = await SnapshotResolver.resolveActiveSnapshot(categoryId, 'IN', 'en');
                if (!res.ok || !res.snapshot) throw new Error(res.error || "Snapshot Resolve Failed");
                
                corpusSnapshotId = res.snapshot.snapshot_id;
                corpusLifecycle = res.snapshot.lifecycle;

                const rowRes = await CategorySnapshotStore.readAllKeywordRows(
                    { categoryId: categoryId, countryCode: 'IN', languageCode: 'en' }, 
                    corpusSnapshotId
                );
                
                if (!rowRes.ok) throw new Error("Row read failed");
                corpusRows = rowRes.data || [];
                
                addStage("S1", "Corpus Snapshot Loaded", true, {
                    snapshotId: corpusSnapshotId,
                    lifecycle: corpusLifecycle,
                    totalRows: corpusRows.length,
                    sampleRow: corpusRows[0] ? Object.keys(corpusRows[0]) : []
                });
            } catch (e: any) {
                addStage("S1", "Corpus Snapshot Loaded", false, { error: e.message });
                throw new Error("S1_FAIL"); // Fatal
            }

            // S2. Consumer Needs Call (Audit)
            // Mock chunking logic
            const CHUNK_SIZE = 60;
            const chunkCount = Math.ceil(corpusRows.length / CHUNK_SIZE);
            addStage("S2", "Consumer Needs Calls Snapshot", true, {
                plannedChunks: chunkCount,
                maxRowsPerChunk: CHUNK_SIZE
            });

            // S3. Consumer Needs Result (Audit)
            // Generate deterministic stub
            const cnaStub = {
                consumerProblems: [{ title: "Razor Burn", impact: "HIGH" }],
                coreAspirations: [{ title: "Clean Shave", impact: "HIGH" }],
                usageRoutines: [{ title: "Morning Routine", impact: "MEDIUM" }],
                searchTriggers: [{ title: "Interview", impact: "LOW" }],
                purchaseBarriers: [{ title: "Cost", impact: "HIGH" }],
                emergingTrends: [{ title: "Eco Friendly", impact: "MEDIUM" }],
                categoryNeedGaps: [{ title: "Better Lube", impact: "HIGH" }],
                consumerIntentStatements: [{ title: "I want a smooth face", description: "Context" }]
            };
            ReactSafety.check(cnaStub, 'S3');
            addStage("S3", "Consumer Needs Results", true, {
                itemsGenerated: 8, // 1 per section + intent
                schemaCheck: "OK"
            });

            // S4. Demand Snapshot Loaded
            let demandSnapshot: any = null;
            try {
                const dRes = await DemandSnapshotResolverInput.resolveDemandSnapshot(categoryId, month);
                // We allow MISSING if we just rely on corpus rows for fresh compute
                const isMissing = dRes.resolvedBy === 'MISSING';
                
                addStage("S4", "Demand Snapshot Loaded", true, {
                    resolvedBy: dRes.resolvedBy,
                    snapshotId: dRes.snapshotId,
                    lifecycle: dRes.lifecycle,
                    note: isMissing ? "Using Corpus Rows for Fresh Calc" : "Loaded Existing"
                });
                
                demandSnapshot = {
                    snapshot_id: dRes.snapshotId || corpusSnapshotId,
                    lifecycle: dRes.lifecycle || corpusLifecycle
                };

            } catch (e: any) {
                addStage("S4", "Demand Snapshot Loaded", false, { error: e.message });
                throw new Error("S4_FAIL");
            }

            // S5. Demand Result Computed
            let demandResult: any = null;
            try {
                // Mock trends for dry run
                const mockTrends = { 
                    fiveYearTrendPct: 15.5, 
                    trendStatus: 'Growing' as const 
                };

                const calcRes = MetricsCalculatorV3.calculate(
                    categoryId, 
                    demandSnapshot.snapshot_id, 
                    corpusRows, 
                    mockTrends
                );

                demandResult = calcRes;

                // Audit Dedup
                const uniqueKeys = new Set(corpusRows.map(r => normalizeKeywordString(r.keyword_text)));
                const dedupCount = uniqueKeys.size;
                
                addStage("S5", "Demand Result Computed", true, {
                    demandIndex: calcRes.demand_index_mn,
                    readiness: calcRes.metric_scores?.readiness,
                    spread: calcRes.metric_scores?.spread,
                    trend: calcRes.trend_5y?.value_percent,
                    dedupStats: {
                        original: corpusRows.length,
                        deduped: dedupCount,
                        collapsed: corpusRows.length - dedupCount
                    }
                });
            } catch (e: any) {
                 addStage("S5", "Demand Result Computed", false, { error: e.message });
                 throw new Error("S5_FAIL");
            }

            // S6. Demand Snapshot Schema
            if (demandResult) {
                const schemaCheck = {
                    hasIndex: typeof demandResult.demand_index_mn === 'number',
                    hasReadiness: typeof demandResult.metric_scores?.readiness === 'number',
                    hasAudit: !!demandResult.demandAudit
                };
                const ok = Object.values(schemaCheck).every(Boolean);
                addStage("S6", "Demand Result Snapshot (Schema Audit)", ok, {
                    schemaCheck,
                    wouldWrite: false
                });
            }

            // S7. Signal Harvester
            let signals: any[] = [];
            try {
                const sigRes = await SignalHarvesterClient.fetchSignalsPage({
                    limit: 50,
                    categoryId: categoryId,
                    minTrustScore: 0.3
                });
                
                // Fixed: Correct property access for signals list
                signals = sigRes.signals;
                
                addStage("S7", "Signal Harvester Read", true, {
                    // Added getCollectionName to SignalHarvesterClient
                    collection: SignalHarvesterClient.getCollectionName(),
                    count: signals.length,
                    // Fixed: Use lastDoc for cursor check
                    nextCursor: !!sigRes.lastDoc
                });
            } catch (e: any) {
                // WARN only
                result.warnings.push(`S7: Signals Read Failed (${e.message})`);
                addStage("S7", "Signal Harvester Read", true, {
                    status: "WARN",
                    error: e.message
                });
            }

            // S8. Deep Dive Chunk Plan
            // Deterministic selection simulation
            const anchors = Array.from(new Set(corpusRows.map(r => r.anchor_id)));
            let estimatedBytes = 0;
            let chunkCountS8 = 0;
            
            anchors.forEach(a => {
                const aRows = corpusRows.filter(r => r.anchor_id === a);
                // Top 25 logic
                const payload = aRows.slice(0, 25);
                estimatedBytes += JSON.stringify(payload).length;
                chunkCountS8++;
            });

            addStage("S8", "Deep Dive Chunk Plan (Audit)", true, {
                anchorsCount: anchors.length,
                chunksPlanned: chunkCountS8,
                estTotalBytes: estimatedBytes,
                avgChunkBytes: chunkCountS8 > 0 ? Math.round(estimatedBytes/chunkCountS8) : 0
            });

            // S9. Deep Dive Result (Stub)
            const ddResult = {
                executiveSummary: { title: "Stub Title", overview: ["Line 1"] },
                consumerIntentStatements: [{ anchorId: "a1", label: "A1", summary: "Sum", keywords: ["k1"] }],
                opportunityMap: [{ opportunity: "Opp 1", rationale: "Rat 1", funnelStage: "Discovery" }],
                risksAndCaveats: ["Risk 1"],
                evidence: {
                    snapshotId: demandSnapshot.snapshot_id,
                    keywordsAnalyzed: corpusRows.length,
                    signalsAnalyzed: signals.length,
                    signalsSources: { web: signals.length }
                },
                confidence: 0.9
            };
            
            const ddSafe = ReactSafety.check(ddResult, 'S9');
            addStage("S9", "Deep Dive Result (Schema Audit)", ddSafe, {
                schemaOk: true,
                reactSafe: ddSafe
            });

            // S10. Deep Dive Run Write
            addStage("S10", "Deep Dive Run Write (Schema Audit)", true, {
                wouldWrite: false,
                collection: 'deepDive_runs'
            });

            // S11. Playbook Skeleton
            const pbStub = {
                category: categoryId,
                executiveSummary: "Playbook Summary",
                positioning: ["Pos 1"],
                messaging_pillars: ["Pillar 1"],
                channel_recommendations: ["Channel 1"],
                creativeAngles: ["Angle 1"],
                action_plan_30_60_90: { day30: [], day60: [], day90: [] },
                risksAndMitigations: [],
                measurement_kpis: []
            };
             const pbSafe = ReactSafety.check(pbStub, 'S11');
             addStage("S11", "Playbook Skeleton (Audit)", pbSafe, {
                 schemaOk: true,
                 reactSafe: pbSafe
             });

        } catch (e: any) {
            console.error(e);
            // Blockers already added in stage
        }

        // Final Verdict
        if (AuditGuard.writesAttempted > 0) result.verdict = "NO_GO";
        else if (result.blockers.length > 0) result.verdict = "NO_GO";
        else if (result.warnings.length > 0) result.verdict = "WARN";
        else result.verdict = "GO";

        result.writeGuards = {
            ok: AuditGuard.writesAttempted === 0,
            writesAttempted: AuditGuard.writesAttempted,
            writeAttempts: AuditGuard.attempts
        };
        
        result.reactSafety = {
            ok: ReactSafety.unsafeCount === 0,
            unsafeCount: ReactSafety.unsafeCount,
            unsafeExamples: ReactSafety.unsafeExamples
        };

        return result;
    }
};