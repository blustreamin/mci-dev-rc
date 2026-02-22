import { SignalCorpusReader } from './signalCorpusReader';
import { SignalHarvesterDiagnostics, SignalHarvesterDiagResult } from './signalHarvesterDiagnostics';
import { SignalCorpusDiagnostics, SignalCorpusDiagnosticsResult, DeepDiveReadinessResult } from './signalCorpusDiagnostics';
import { DateUtils } from '../utils/dateUtils';
import { CORE_CATEGORIES } from '../constants';

export interface HealthCheckReport {
  verdict: 'GO' | 'WARN' | 'NO_GO';
  ts: string;
  target: { envMode: string };
  blockers: string[];
  warnings: string[];
  checks: {
    signalHarvesterDiagnostics: SignalHarvesterDiagResult;
    signalCorpusDiagnostics: SignalCorpusDiagnosticsResult;
    deepDiveInputReadiness: DeepDiveReadinessResult;
    [key: string]: any;
  };
}

export const SystemHealthCheck = {
  async run(): Promise<HealthCheckReport> {
    const ts = new Date().toISOString();
    const envMode = (import.meta as any).env?.MODE || 'development';
    const report: HealthCheckReport = {
        verdict: 'GO',
        ts,
        target: { envMode },
        blockers: [],
        warnings: [],
        checks: {
            signalHarvesterDiagnostics: {} as any,
            signalCorpusDiagnostics: {} as any,
            deepDiveInputReadiness: {} as any
        }
    };

    // Default category for probing
    const catId = 'shaving'; 
    const monthKey = DateUtils.getCurrentMonthKey();

    // 1. Signal Harvester
    try {
        report.checks.signalHarvesterDiagnostics = await SignalHarvesterDiagnostics.runDiagnostics(catId, monthKey);
        if (!report.checks.signalHarvesterDiagnostics.ok) {
            report.warnings.push("Signal Harvester Read Failed");
        }
    } catch (e: any) {
        report.warnings.push(`Harvester Diag Error: ${e.message}`);
    }

    // 2. Signal Corpus
    try {
        report.checks.signalCorpusDiagnostics = await SignalCorpusDiagnostics.probeSnapshot(catId, monthKey);
        if (!report.checks.signalCorpusDiagnostics.exists) {
            // Warn only, as Harvester fallback might exist
            report.warnings.push(`Signal Corpus Missing for ${catId}/${monthKey}`);
        }
    } catch (e: any) {
        report.warnings.push(`Corpus Diag Error: ${e.message}`);
    }

    // 3. Deep Dive Readiness
    try {
        report.checks.deepDiveInputReadiness = await SignalCorpusDiagnostics.checkDeepDiveReadiness(catId, monthKey);
        if (!report.checks.deepDiveInputReadiness.ok) {
            // If demand is missing, it's a blocker for Deep Dive
            if (report.checks.deepDiveInputReadiness.demandMode === 'MISSING') {
                report.blockers.push("Deep Dive Blocked: Demand Snapshot Missing");
            } else {
                report.warnings.push("Deep Dive Inputs Partial/Missing");
            }
        }
    } catch (e: any) {
        report.warnings.push(`Readiness Check Error: ${e.message}`);
    }

    // Verdict Logic
    if (report.blockers.length > 0) report.verdict = 'NO_GO';
    else if (report.warnings.length > 0) report.verdict = 'WARN';

    return report;
  }
};