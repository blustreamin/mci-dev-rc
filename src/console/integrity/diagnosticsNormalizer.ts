
import { SignalHarvesterDiagResult } from '../../services/signalHarvesterDiagnostics';

export type NormalizedSignalHarvesterDiagnostics = SignalHarvesterDiagResult & { _missing: boolean };

export function normalizeSignalHarvesterDiagnostics(raw: any): NormalizedSignalHarvesterDiagnostics {
    // Default safe object
    const empty: NormalizedSignalHarvesterDiagnostics = {
        ok: false,
        timestamp: new Date().toISOString(),
        config: {
            envMode: 'unknown',
            collectionName: 'unknown',
            projectId: 'unknown',
            fields: { categoryField: '?', timeField: '?', trustFilter: '?' }
        },
        probes: {
            latestRead: { ok: false, latencyMs: 0 },
            categoryQuery: { ok: false, latencyMs: 0, found: false },
            monthWindow: { ok: false, sampledCount: 0, inWindowCount: 0, targetMonth: '?', windowUsed: '?' }
        },
        advisories: [],
        _missing: true
    };

    if (!raw || typeof raw !== 'object') return empty;

    // Deep merge / safe access
    return {
        ok: !!raw.ok,
        timestamp: raw.timestamp || empty.timestamp,
        config: {
            envMode: raw.config?.envMode || 'unknown',
            collectionName: raw.config?.collectionName || 'unknown',
            projectId: raw.config?.projectId || 'unknown',
            fields: {
                categoryField: raw.config?.fields?.categoryField || '?',
                timeField: raw.config?.fields?.timeField || '?',
                trustFilter: raw.config?.fields?.trustFilter || '?'
            }
        },
        probes: {
            latestRead: {
                ok: !!raw.probes?.latestRead?.ok,
                latencyMs: raw.probes?.latestRead?.latencyMs || 0,
                error: raw.probes?.latestRead?.error,
                indexUrl: raw.probes?.latestRead?.indexUrl,
                docId: raw.probes?.latestRead?.docId,
                platform: raw.probes?.latestRead?.platform,
                collectedAt: raw.probes?.latestRead?.collectedAt
            },
            categoryQuery: {
                ok: !!raw.probes?.categoryQuery?.ok,
                latencyMs: raw.probes?.categoryQuery?.latencyMs || 0,
                found: !!raw.probes?.categoryQuery?.found,
                error: raw.probes?.categoryQuery?.error,
                indexUrl: raw.probes?.categoryQuery?.indexUrl,
                modeUsed: raw.probes?.categoryQuery?.modeUsed
            },
            monthWindow: {
                ok: !!raw.probes?.monthWindow?.ok,
                sampledCount: raw.probes?.monthWindow?.sampledCount || 0,
                inWindowCount: raw.probes?.monthWindow?.inWindowCount || 0,
                targetMonth: raw.probes?.monthWindow?.targetMonth || '?',
                windowUsed: raw.probes?.monthWindow?.windowUsed || '?',
                error: raw.probes?.monthWindow?.error
            }
        },
        advisories: Array.isArray(raw.advisories) ? raw.advisories : [],
        _missing: false
    };
}
