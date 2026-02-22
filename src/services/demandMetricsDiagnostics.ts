
import { FirestoreClient } from './firestoreClient';
import { doc, getDoc } from 'firebase/firestore';
import { SnapshotResolver } from './snapshotResolver';
import { DemandSnapshotResolver } from './deepDiveSnapshotResolvers';
import { FORCE_CERTIFY_MODE } from '../constants/runtimeFlags';
import { CategorySnapshotStore } from './categorySnapshotStore';
import { SweepResult } from '../types';

export type DiagVerdict = 'PASS' | 'WARN' | 'FAIL' | 'UNKNOWN';

export type DemandMetricsDiagnosticReport = {
    verdict: DiagVerdict;
    params: { categoryId: string; monthKey: string };
    checks: {
        corpus: {
            verdict: DiagVerdict;
            snapshotId: string | null;
            lifecycle: string | null;
            healthGrade: string | null;
            validTotal: number;
            zeroTotal: number;
            totalRows: number;
            notes: string[];
        };
        demandOutput: {
            verdict: DiagVerdict;
            snapshotId: string | null;
            lifecycle: string | null;
            metrics: { demand: number; readiness: number; spread: number };
            trendSource: string | null;
            linkedCorpusId: string | null;
            notes: string[];
        };
        cacheLock: {
            verdict: DiagVerdict;
            wouldServeCached: boolean;
            isPoisoned: boolean;
            reason: string;
        };
        trendLock: {
            verdict: DiagVerdict;
            lockExists: boolean;
            lockedAt: string | null;
            value: number | null;
        };
        config: {
            verdict: DiagVerdict;
            forceCertifyMode: boolean;
        };
    };
    rca: string[];
};

export async function runDemandMetricsDiagnostics(categoryId: string, monthKey: string): Promise<DemandMetricsDiagnosticReport> {
    const report: DemandMetricsDiagnosticReport = {
        verdict: 'UNKNOWN',
        params: { categoryId, monthKey },
        checks: {
            corpus: { verdict: 'UNKNOWN', snapshotId: null, lifecycle: null, healthGrade: null, validTotal: -1, zeroTotal: -1, totalRows: -1, notes: [] },
            demandOutput: { verdict: 'UNKNOWN', snapshotId: null, lifecycle: null, metrics: { demand: -1, readiness: -1, spread: -1 }, trendSource: null, linkedCorpusId: null, notes: [] },
            cacheLock: { verdict: 'UNKNOWN', wouldServeCached: false, isPoisoned: false, reason: '' },
            trendLock: { verdict: 'UNKNOWN', lockExists: false, lockedAt: null, value: null },
            config: { verdict: 'UNKNOWN', forceCertifyMode: FORCE_CERTIFY_MODE }
        },
        rca: []
    };

    const db = FirestoreClient.getDbSafe();
    if (!db) {
        report.rca.push("Database initialization failed.");
        return report;
    }

    // 1. Config Check
    if (FORCE_CERTIFY_MODE) {
        report.checks.config.verdict = 'WARN';
        report.rca.push("FORCE_CERTIFY_MODE is enabled. Empty/Red snapshots may be promoted to CERTIFIED, causing 0 demand.");
    } else {
        report.checks.config.verdict = 'PASS';
    }

    // 2. Corpus Check
    try {
        const corpusRes = await SnapshotResolver.resolveActiveSnapshot(categoryId, 'IN', 'en');
        if (corpusRes.ok && corpusRes.snapshot) {
            const snap = corpusRes.snapshot;
            report.checks.corpus.snapshotId = snap.snapshot_id;
            report.checks.corpus.lifecycle = snap.lifecycle;
            report.checks.corpus.validTotal = snap.stats.valid_total;
            report.checks.corpus.zeroTotal = snap.stats.zero_total;
            report.checks.corpus.totalRows = snap.stats.keywords_total;
            
            // Try to get health grade
            try {
                const healthSnap = await getDoc(doc(db, 'corpus_health_reports', categoryId));
                if (healthSnap.exists()) {
                    report.checks.corpus.healthGrade = healthSnap.data().healthGrade;
                }
            } catch (e) {}

            if (snap.stats.valid_total === 0) {
                report.checks.corpus.verdict = 'FAIL';
                report.rca.push("Active Corpus Snapshot has 0 valid keywords. Demand calculation will yield 0.");
            } else if (snap.stats.valid_total < 20) {
                report.checks.corpus.verdict = 'WARN';
                report.rca.push("Active Corpus has very low valid count (<20). Metrics may be unstable.");
            } else if (report.checks.corpus.healthGrade === 'RED') {
                report.checks.corpus.verdict = 'WARN';
                report.rca.push("Corpus Health is RED despite having valid keywords. Check distribution.");
            } else {
                report.checks.corpus.verdict = 'PASS';
            }
        } else {
            report.checks.corpus.verdict = 'FAIL';
            report.rca.push("No Active Corpus Snapshot found. Demand cannot be calculated.");
        }
    } catch (e: any) {
        report.checks.corpus.notes.push(`Error: ${e.message}`);
    }

    // 3. Demand Output Check
    try {
        const demandRes = await DemandSnapshotResolver.resolve(categoryId, monthKey);
        if (demandRes.ok && demandRes.data) {
            const out = demandRes.data;
            report.checks.demandOutput.snapshotId = demandRes.snapshotId || null;
            report.checks.demandOutput.lifecycle = demandRes.lifecycle || null;
            report.checks.demandOutput.metrics = {
                demand: out.demand_index_mn,
                readiness: out.metric_scores?.readiness || 0,
                spread: out.metric_scores?.spread || 0
            };
            report.checks.demandOutput.linkedCorpusId = demandRes.corpusSnapshotId || null;
            report.checks.demandOutput.trendSource = out.trend_5y?.source || null;

            if (out.demand_index_mn > 0) {
                report.checks.demandOutput.verdict = 'PASS';
            } else {
                report.checks.demandOutput.verdict = 'FAIL';
                report.rca.push("Demand Output exists but Index is 0.00 Mn.");
            }

            // 4. Cache Lock Inference
            const isCertified = ['CERTIFIED', 'CERTIFIED_FULL', 'CERTIFIED_LITE'].includes(demandRes.lifecycle || '');
            const hasNonZero = out.demand_index_mn > 0;
            
            if (isCertified) {
                if (hasNonZero) {
                    report.checks.cacheLock.wouldServeCached = true;
                    report.checks.cacheLock.verdict = 'PASS';
                    report.checks.cacheLock.reason = "Certified & Valid -> Served from Cache";
                } else {
                    report.checks.cacheLock.wouldServeCached = false;
                    report.checks.cacheLock.isPoisoned = true;
                    report.checks.cacheLock.verdict = 'WARN';
                    report.checks.cacheLock.reason = "Certified but Zero -> Cache Bypassed (Poisoned Snapshot)";
                    report.rca.push("A Certified snapshot exists with 0 demand. The runner will bypass it and attempt re-computation.");
                }
            } else {
                report.checks.cacheLock.wouldServeCached = false;
                report.checks.cacheLock.verdict = 'PASS';
                report.checks.cacheLock.reason = "Not Certified -> Cache Bypassed";
            }

        } else {
            report.checks.demandOutput.verdict = 'WARN'; // Not necessarily fail if never run
            report.checks.demandOutput.notes.push("No output snapshot found for this month.");
            report.rca.push("No demand output found. Run Demand Sweep.");
        }
    } catch (e: any) {
        report.checks.demandOutput.notes.push(`Error: ${e.message}`);
    }

    // 5. Trend Lock Check
    try {
        const lockSnap = await getDoc(doc(db, 'trend_locks', categoryId));
        if (lockSnap.exists()) {
            const data = lockSnap.data();
            report.checks.trendLock.lockExists = true;
            report.checks.trendLock.lockedAt = data.lockedAtISO;
            report.checks.trendLock.value = data.value_percent;
            report.checks.trendLock.verdict = typeof data.value_percent === 'number' ? 'PASS' : 'WARN';
        } else {
            report.checks.trendLock.verdict = 'WARN';
            report.checks.trendLock.lockExists = false;
            report.rca.push("Trend Lock missing. First run will fetch fresh trends.");
        }
    } catch (e: any) {
        report.checks.trendLock.verdict = 'FAIL';
    }

    // Final Verdict Logic
    const failures = Object.values(report.checks).filter(c => c.verdict === 'FAIL').length;
    const warnings = Object.values(report.checks).filter(c => c.verdict === 'WARN').length;
    
    if (failures > 0) report.verdict = 'FAIL';
    else if (warnings > 0) report.verdict = 'WARN';
    else report.verdict = 'PASS';

    return report;
}
