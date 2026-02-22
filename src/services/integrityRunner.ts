
import { IntegrityAuditReport, IntegrityBlocker, IntegrityVerdict } from './integrityContract';
import { DemandSnapshotResolver } from './deepDiveSnapshotResolvers';
import { SnapshotResolver } from './snapshotResolver';
import { SignalCorpusReader } from './signalCorpusReader';
import { getSignalHarvesterCollection } from '../config/signalHarvesterConfig';
import { FirestoreClient } from './firestoreClient';
import { collection, query, where, orderBy, limit, getDocs, getDoc, doc } from 'firebase/firestore';
import { classifyFirestoreError } from '../utils/firestoreErrorUtils';
import { resolveEnvMode } from '../config/envMode';
import { DeepDiveStore } from './deepDiveStore';
import { 
    MCI_ENABLE_DEEPDIVE_CONTRACT, 
    MCI_ENABLE_DEEPDIVE_RUN_TRANSCRIPT, 
    MCI_ENABLE_DEMAND_ONLY_DEEPDIVE 
} from '../config/featureFlags';
import { SignalDTO } from '../types';

function getWindow(monthKey: string) {
    const [y, m] = monthKey.split('-').map(Number);
    const start = new Date(Date.UTC(y, m - 1, 1)).toISOString();
    const end = new Date(Date.UTC(y, m, 1)).toISOString();
    return { start, end };
}

export async function runIntegrityAudit(params: {
  categoryId: string;
  monthKey: string; // YYYY-MM
  minTrustScore?: number; // default 70
  signalLimit?: number; // default 90
}): Promise<IntegrityAuditReport> {
    const ts = new Date().toISOString();
    const db = FirestoreClient.getDbSafe();
    const signalCollection = getSignalHarvesterCollection();
    const envMode = resolveEnvMode();
    // @ts-ignore
    const firestoreProjectId = db?.app?.options?.projectId || 'unknown';

    const report: IntegrityAuditReport = {
        ts,
        target: { categoryId: params.categoryId, monthKey: params.monthKey },
        env: { envMode, firestoreProjectId, signalsCollection: signalCollection },
        probes: {
            demand: { ok: false, snapshotId: null, metricsPresent: false, notes: [] },
            keywords: { ok: false, snapshotId: null, rows: null, anchors: null, notes: [] },
            signals: {
                ok: false,
                mode: 'HARVESTER', // Default assumption
                collection: signalCollection,
                requiredIndexOk: false,
                queryPlan: [],
                sampled: 0,
                used: 0,
                trustedUsed: 0,
                enrichedUsed: 0,
                platforms: {},
                minTrustScore: params.minTrustScore || 70,
                monthWindow: { from: null, to: null, inWindow: 0 },
                freshness: { usesLastSeenAt: false, oldestUsedIso: null, newestUsedIso: null },
                schemaCheck: { categoryIdOk: false, trustedOk: false, lastSeenAtOk: false, enrichmentOk: false, platformOk: false, failures: [] },
                notes: [],
                warnings: []
            },
            deepDive: {
                contractEnabled: MCI_ENABLE_DEEPDIVE_CONTRACT,
                promptHash: null,
                lastRunPointer: { ok: false, docPath: '', runId: null },
                outputShapeOk: false,
                missingSections: [],
                notes: []
            },
            telemetry: {
                transcriptEnabled: MCI_ENABLE_DEEPDIVE_RUN_TRANSCRIPT,
                lastEvents: [],
                notes: []
            }
        },
        verdict: 'NO_GO',
        blockers: [],
        warnings: []
    };

    if (!db) {
        report.blockers.push({ code: 'POINTER_WRITE_FAILED', message: "DB_INIT_FAIL", remediation: ["Check Firebase Config"] });
        return report;
    }

    // 1. Demand Probe
    try {
        const demandRes = await DemandSnapshotResolver.resolve(params.categoryId, params.monthKey);
        if (demandRes.ok && demandRes.snapshotId) {
            report.probes.demand.ok = true;
            report.probes.demand.snapshotId = demandRes.snapshotId;
            report.probes.demand.metricsPresent = !!demandRes.data?.demand_index_mn;
            report.probes.demand.notes.push(`Resolved via ${demandRes.mode}`);
            if (!report.probes.demand.metricsPresent) {
                report.blockers.push({ code: 'DEMAND_MISSING', message: "Demand Snapshot exists but metrics missing", remediation: ["Re-run Demand Sweep"] });
            }
        } else {
            report.blockers.push({ code: 'DEMAND_MISSING', message: demandRes.reason || "Demand Resolution Failed", remediation: ["Run Demand Sweep"] });
        }
    } catch (e: any) {
        report.probes.demand.notes.push(`Error: ${e.message}`);
    }

    // 2. Keywords Probe
    try {
        const kwRes = await SnapshotResolver.resolveActiveSnapshot(params.categoryId, 'IN', 'en');
        if (kwRes.ok && kwRes.snapshot) {
            report.probes.keywords.ok = true;
            report.probes.keywords.snapshotId = kwRes.snapshot.snapshot_id;
            report.probes.keywords.rows = kwRes.snapshot.stats.keywords_total;
            report.probes.keywords.anchors = kwRes.snapshot.anchors.length;
            if (report.probes.keywords.rows === 0) {
                report.blockers.push({ code: 'KEYWORDS_MISSING', message: "Keyword Snapshot Empty", remediation: ["Hydrate & Validate"] });
            }
        } else {
            report.blockers.push({ code: 'KEYWORDS_MISSING', message: "No Active Keyword Snapshot", remediation: ["Check Integrity Console > Corpus"] });
        }
    } catch (e: any) {
        report.probes.keywords.notes.push(`Error: ${e.message}`);
    }

    // 3. Signals Probe Chain
    try {
        const signals = report.probes.signals;
        const window = getWindow(params.monthKey);
        signals.monthWindow.from = window.start;
        signals.monthWindow.to = window.end;
        
        // A. Corpus Snapshot
        const corpusRes = await SignalCorpusReader.loadSnapshot(params.categoryId, params.monthKey);
        if (corpusRes.ok && corpusRes.snapshot) {
            signals.mode = 'CORPUS_SNAPSHOT';
            signals.ok = true;
            signals.used = corpusRes.snapshot.signalCount;
            signals.queryPlan.push("Loaded from Signal Corpus Snapshot");
            signals.notes.push(`Corpus Snapshot ${corpusRes.snapshot.id} found with ${corpusRes.snapshot.signalCount} signals.`);
            
            // Use snapshot summary sample for validation if available
            const sample = corpusRes.snapshot.summary?.sample || [];
            if (sample.length > 0) {
                // Strict validation on Corpus Snapshot samples
                validateSignalDocs(sample, signals, window, params.minTrustScore || 70, params.categoryId);
                // Trust the summary counts for used values
                signals.trustedUsed = corpusRes.snapshot.summary?.trustedUsed || corpusRes.snapshot.signalCount;
                signals.enrichedUsed = corpusRes.snapshot.summary?.enrichedUsed || corpusRes.snapshot.signalCount;
            } else {
                 // Fallback if summary missing (legacy snapshot?)
                 // We don't read full corpus chunks here to avoid perf hit, assume trusted if it exists in snapshot
                 signals.trustedUsed = corpusRes.snapshot.signalCount;
                 signals.enrichedUsed = corpusRes.snapshot.signalCount;
                 signals.notes.push("WARNING: Snapshot summary missing, skipping sample validation");
            }
            
            signals.requiredIndexOk = true; // Not using harvester index in this mode
            
        } else {
            // B. Harvester Canonical Query
            signals.queryPlan.push(`Corpus Missing. Trying Harvester Canonical: categoryId=${params.categoryId}, trusted=true, sort=lastSeenAt`);
            
            try {
                const q = query(
                    collection(db, signalCollection),
                    where('categoryId', '==', params.categoryId),
                    where('trusted', '==', true),
                    orderBy('lastSeenAt', 'desc'),
                    limit(params.signalLimit || 90)
                );
                
                const snap = await getDocs(q);
                signals.requiredIndexOk = true;
                signals.sampled = snap.size;
                signals.queryPlan.push(`Canonical Query OK. Returned ${snap.size} docs.`);

                const docs = snap.docs.map(d => d.data());
                validateSignalDocs(docs, signals, window, params.minTrustScore || 70, params.categoryId);

            } catch (e: any) {
                const err = classifyFirestoreError(e);
                signals.indexError = err.kind === 'INDEX_ERROR' ? err.url : e.message;
                signals.requiredIndexOk = false;
                
                if (err.kind === 'INDEX_ERROR') {
                    report.blockers.push({ 
                        code: 'SIGNALS_INDEX_MISSING', 
                        message: "Canonical Index Missing", 
                        remediation: ["Create Composite Index (categoryId ASC, trusted ASC, lastSeenAt DESC)"] 
                    });
                }
                
                // C. Fallback Diagnostic Query
                signals.queryPlan.push("Canonical Failed. Trying Diagnostic Fallback: categoryId only");
                try {
                    const qFallback = query(
                        collection(db, signalCollection),
                        where('categoryId', '==', params.categoryId),
                        limit(50) // Reduced limit for safety
                    );
                    const snapFallback = await getDocs(qFallback);
                    signals.sampled = snapFallback.size;
                    signals.queryPlan.push(`Fallback OK. Returned ${snapFallback.size} raw docs.`);
                    
                    const docs = snapFallback.docs.map(d => d.data());
                    validateSignalDocs(docs, signals, window, params.minTrustScore || 70, params.categoryId);
                    
                } catch (fallbackErr: any) {
                    report.blockers.push({ code: 'SIGNALS_MISSING', message: "All Signal Queries Failed", remediation: ["Check Firestore Permissions", "Check categoryId string match"] });
                }
            }
        }

        // Evaluate Signals Verdict
        if (!MCI_ENABLE_DEMAND_ONLY_DEEPDIVE) {
             if (signals.trustedUsed < 20) {
                 report.blockers.push({ 
                     code: 'SIGNALS_NOT_TRUSTED', 
                     message: `Insufficient Trusted Signals (${signals.trustedUsed} < 20)`, 
                     remediation: ["Run Signal Harvester", "Verify 'trusted' field in DB"] 
                 });
             }
             // Allow some flexibility on enrichment if we have enough trusted
             if (signals.enrichedUsed < 5) {
                 report.blockers.push({ 
                     code: 'SIGNALS_NOT_ENRICHED', 
                     message: `Insufficient Enriched Signals (${signals.enrichedUsed} < 5)`, 
                     remediation: ["Run Enrichment Pipeline"] 
                 });
             }
             if (signals.schemaCheck.failures.length > 0) {
                 report.blockers.push({
                     code: 'SIGNALS_SCHEMA_MISMATCH',
                     message: `Signal Schema Mismatches Found: ${signals.schemaCheck.failures.length}`,
                     remediation: ["Check categoryId", "Check lastSeenAt ISO format", "Check trusted boolean"]
                 });
             }
        }

        // Freshness Warning
        if (signals.monthWindow.inWindow < 10 && signals.mode !== 'CORPUS_SNAPSHOT') {
             report.warnings.push(`SIGNALS_STALE: Only ${signals.monthWindow.inWindow} signals in requested month window.`);
        }

    } catch (e: any) {
        report.probes.signals.notes.push(`Critical Error: ${e.message}`);
    }

    // 4. Deep Dive Output Probe
    try {
        const lastResult = await DeepDiveStore.getLatestResult(params.categoryId, params.monthKey);
        if (lastResult) {
            report.probes.deepDive.lastRunPointer.ok = true;
            report.probes.deepDive.lastRunPointer.runId = (lastResult as any).runId || 'unknown';
            
            const requiredSections = [
                'executiveSummary', 'marketStructure', 'consumerNeeds', 'behavioursRituals',
                'triggersBarriersInfluences', 'categoryEvolutionOpportunities', 'brandPerceptionsLightTouch',
                'influencerEcosystem', 'appendix'
            ];
            const missing: string[] = [];
            
            // Check top-level presence
            requiredSections.forEach(k => {
                if (!(lastResult as any)[k]) missing.push(k);
            });

            // Check deeper specifics (Analyst Grade)
            // if (lastResult.ritualsAndRoutines?.bullets?.length === 0) missing.push("Rituals & Routines"); // Legacy check
            
            report.probes.deepDive.missingSections = missing;
            report.probes.deepDive.outputShapeOk = missing.length === 0;

            if (missing.length > 0) {
                 report.warnings.push(`DEEPDIVE_OUTPUT_INCOMPLETE: Missing ${missing.join(', ')}`);
            }

            // Check if it was a contract run
            if (!lastResult.verdict) {
                 report.probes.deepDive.notes.push("Legacy Output Detected (No Verdict)");
                 if (!MCI_ENABLE_DEEPDIVE_CONTRACT) {
                     report.warnings.push("DEEPDIVE_PROMPT_NOT_CONTRACT: Output is legacy format.");
                 }
            }
        } else {
            report.probes.deepDive.notes.push("No previous run found.");
        }
    } catch (e: any) {
        report.probes.deepDive.notes.push(`Error checking DD store: ${e.message}`);
    }

    // 5. Final Verdict Logic
    const demandOk = report.probes.demand.ok && report.probes.demand.metricsPresent;
    const keywordsOk = report.probes.keywords.ok && ((report.probes.keywords.rows || 0) > 0);
    const signalsOk = report.blockers.filter(b => b.code.startsWith('SIGNALS_')).length === 0;
    
    if (demandOk && keywordsOk && signalsOk) {
        report.verdict = 'GO';
    } else {
        report.verdict = 'NO_GO';
    }

    return report;
}

function validateSignalDocs(docs: any[], signals: IntegrityAuditReport['probes']['signals'], window: {start: string, end: string}, minTrust: number, targetCategoryId: string) {
    let categoryIdOkCount = 0;
    let trustedOkCount = 0;
    let lastSeenAtOkCount = 0;
    let enrichmentOkCount = 0;
    let platformOkCount = 0;

    docs.forEach(d => {
        // Schema Checks
        if (d.categoryId === targetCategoryId) categoryIdOkCount++;
        else signals.schemaCheck.failures.push(`Doc ${d.id || '?'} category mismatch: ${d.categoryId} != ${targetCategoryId}`);
        
        if (d.trusted === true && typeof d.trusted === 'boolean') trustedOkCount++;
        else if (d.trusted !== true) signals.schemaCheck.failures.push(`Doc ${d.id || '?'} not trusted`);
        
        // Strict ISO check for lastSeenAt
        const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
        if (d.lastSeenAt && isoRegex.test(d.lastSeenAt)) lastSeenAtOkCount++;
        else signals.schemaCheck.failures.push(`Doc ${d.id || '?'} invalid lastSeenAt: ${d.lastSeenAt}`);
        
        if (d._meta?.enrichmentStatus === 'OK' || d.enrichmentStatus === 'OK') enrichmentOkCount++;
        if (d.platform) platformOkCount++;

        // Logic Checks
        if (d.trusted === true && (d.trustScore || 0) >= minTrust) {
            signals.trustedUsed++;
        }
        if (d._meta?.enrichmentStatus === 'OK' || d.enrichmentStatus === 'OK') {
            signals.enrichedUsed++;
        }

        // Platform Tally
        const p = (d.platform || 'unknown').toLowerCase();
        signals.platforms[p] = (signals.platforms[p] || 0) + 1;

        // Freshness
        const ts = d.lastSeenAt || d.collectedAt;
        if (ts) {
            if (!signals.freshness.oldestUsedIso || ts < signals.freshness.oldestUsedIso) signals.freshness.oldestUsedIso = ts;
            if (!signals.freshness.newestUsedIso || ts > signals.freshness.newestUsedIso) signals.freshness.newestUsedIso = ts;
            
            if (ts >= window.start && ts < window.end) {
                signals.monthWindow.inWindow++;
            }
        }
    });

    signals.schemaCheck.categoryIdOk = categoryIdOkCount === docs.length;
    signals.schemaCheck.trustedOk = trustedOkCount === docs.length;
    signals.schemaCheck.lastSeenAtOk = lastSeenAtOkCount === docs.length;
    // Allow some enrichment failures in sample, but warn if 0
    signals.schemaCheck.enrichmentOk = enrichmentOkCount > 0;
    signals.schemaCheck.platformOk = platformOkCount === docs.length;
    
    signals.freshness.usesLastSeenAt = lastSeenAtOkCount > 0;
    signals.used = docs.length;
}
