
export type IntegrityVerdict = "GO" | "NO_GO";

export type IntegrityBlocker = {
  code:
    | "DEMAND_MISSING"
    | "KEYWORDS_MISSING"
    | "SIGNALS_MISSING"
    | "SIGNALS_INDEX_MISSING"
    | "SIGNALS_SCHEMA_MISMATCH"
    | "SIGNALS_STALE"
    | "SIGNALS_NOT_TRUSTED"
    | "SIGNALS_NOT_ENRICHED"
    | "DEEPDIVE_PROMPT_NOT_CONTRACT"
    | "DEEPDIVE_OUTPUT_INCOMPLETE"
    | "POINTER_WRITE_FAILED"
    | "MODEL_TIMEOUT_RISK";
  message: string;
  evidence?: Record<string, any>;
  remediation: string[];
};

export type IntegrityAuditReport = {
  ts: string; // ISO
  target: { categoryId: string; monthKey: string };
  env: { envMode: string; firestoreProjectId: string; signalsCollection: string };
  probes: {
    demand: { ok: boolean; snapshotId: string | null; metricsPresent: boolean; notes: string[] };
    keywords: { ok: boolean; snapshotId: string | null; rows: number | null; anchors: number | null; notes: string[] };
    signals: {
      ok: boolean;
      mode: "CORPUS_SNAPSHOT" | "HARVESTER" | "DEMAND_ONLY";
      collection: string;
      requiredIndexOk: boolean;
      indexError?: string;
      queryPlan: string[];
      sampled: number;
      used: number;
      trustedUsed: number;
      enrichedUsed: number;
      platforms: Record<string, number>;
      minTrustScore: number;
      monthWindow: { from: string | null; to: string | null; inWindow: number };
      freshness: { usesLastSeenAt: boolean; oldestUsedIso: string | null; newestUsedIso: string | null };
      schemaCheck: { categoryIdOk: boolean; trustedOk: boolean; lastSeenAtOk: boolean; enrichmentOk: boolean; platformOk: boolean; failures: string[] };
      notes: string[];
      warnings: string[];
    };
    deepDive: {
      contractEnabled: boolean;
      promptHash: string | null;
      lastRunPointer: { ok: boolean; docPath: string; runId: string | null };
      outputShapeOk: boolean;
      missingSections: string[];
      notes: string[];
    };
    telemetry: { transcriptEnabled: boolean; lastEvents: string[]; notes: string[] };
  };
  verdict: IntegrityVerdict;
  blockers: IntegrityBlocker[];
  warnings: string[];
};
