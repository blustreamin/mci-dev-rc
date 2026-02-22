
// --- Enums & Literals ---

export type Country = 'India' | 'USA' | 'UK';
export type TaskStage = string;
export type JobType = string;
export type SnapshotLifecycle = 'DRAFT' | 'HYDRATED' | 'VALIDATED' | 'VALIDATED_LITE' | 'CERTIFIED' | 'CERTIFIED_LITE' | 'CERTIFIED_FULL' | 'POISONED';
export type CertificationTier = 'LITE' | 'FULL';
export type TrendLabel = 'Growing' | 'Stable' | 'Declining' | 'Strong Up' | 'Strong Down' | 'Unknown' | 'n/a';
export type TrendSource = 'GOOGLE_TRENDS' | 'DERIVED_PROXY' | 'LOCKED';
export type DemandContractStatus = 'VALID' | 'INVALID';

export enum WorkflowGear {
    ONBOARDING = 'ONBOARDING',
    STRATEGY = 'STRATEGY',
    DEMAND = 'DEMAND',
    DEEP_DIVE = 'DEEP_DIVE',
    PLAYBOOK = 'PLAYBOOK',
    IMAGE_LAB = 'IMAGE_LAB',
    SIGNALS = 'SIGNALS'
}

export const VALID_DEEP_DIVE_SCHEMAS = ["v2.0", "v2.1", "v2.2-contract"];
export const DEEP_DIVE_SCHEMA_CURRENT = "v2.2-contract";

// --- Generic Interfaces ---

export interface FetchableData<T> {
    status: 'Success' | 'Failed' | 'Running' | 'Pending';
    data?: T;
    error?: { type: string; message: string } | string;
    lastAttempt: string;
}

export interface ApiResponse<T> {
    ok: boolean;
    data?: T;
    error?: string;
}

export interface AuditLogEntry {
    timestamp: string;
    stage: string;
    category: string;
    step: string;
    attempt: number;
    status: string;
    durationMs: number;
    message: string;
    errorType?: string;
}

export interface RunContext {
    jobId: string;
    runId: string;
    windowId: string;
    registryHash: string;
    keywordBaseHash: string;
    budget: any;
}

// --- Category & Strategy ---

export interface CategoryBaseline {
    id: string;
    category: string;
    demandIndex: number;
    engagementReadiness: string;
    demandSpread: string;
    shortlist: boolean;
    consumerDescription: string;
    anchors: string[];
    subCategories: { name: string, anchors: string[] }[];
    defaultKeywords: string[];
    kantarMapping: any;
    nielsenMapping: any;
    coverageNotes: string;
    keyBrands: string[];
}

export interface KeywordMetric {
    term: string;
    avg_monthly_volume: number;
    est_monthly_impressions: number;
    est_ctr: number;
    intent_bucket: string;
    is_winner: boolean;
    volume_used_for_index: number;
    anchor: string;
    status: string;
}

export interface AnchorData {
    id: string;
    term: string;
    total_volume: number;
    cluster_count: number;
    clusters: any[];
    dominant_intent_mix: any;
}

export interface ConsumerStatement {
    statement: string;
    who?: string;
    situation?: string;
}

export interface AnalystPoint {
    id: number;
    statement: string;
    evidence: string[];
    impact: string;
    // Richer fields for V2 UI
    context?: string;
    score?: number;
    score_rationale?: string[];
    consumer_statements?: ConsumerStatement[];
}

export interface AnalystSynthesisSection {
    meta: { status: string; reason?: string };
    points: AnalystPoint[];
}

export interface PreSweepData {
    category: string;
    keywordBaseHash: string;
    isFromCache: boolean;
    summary: string;
    strategicNote: string[];
    intentMap: any[];
    selected_keywords: any[];
    validityMeta: any;
    problems: any[];
    aspirations: any[];
    routines: any[];
    triggers: any[];
    barriers: any[];
    trends: any[];
    category_need_gaps: any[];
    need_gaps: any[];
    needGaps: any[];
    anchors_frozen: string[];
    anchor_intelligence: any[];
    strict_synthesis?: Record<string, AnalystSynthesisSection>;
    strategyContract?: StrategyContractV1;
}

export interface StrategyContractV1 {
    contract_name: string;
    contract_version: string;
    category_id: string;
    generated_at: string;
    status: string;
    contract_hash: string;
    payload: PreSweepData;
}

export interface StrategyPack {
    categoryId: string;
    windowId: string;
    seedHash: string;
    keywords: StrategyPackItem[];
    buckets: {
        head: number;
        midTail: number;
        highIntent: number;
        trendRisers: number;
        brandTerms: number;
    };
    stats: {
        totalCorpus: number;
        zeroVolumeCount: number;
        volumePercentiles: { p20: number; p50: number; p80: number };
        topBigrams: string[];
    };
}

export interface StrategyPackItem {
    t: string; // text
    v: number; // volume
    tr?: string; // trend
    s: string; // source bucket
}

export interface StrategyArtifact {
    id: string;
    categoryId: string;
    windowId: string;
    createdAt: string;
    corpusMeta: any;
    refinementMeta: any;
    strategyPack: StrategyPack;
    derivedSignals: any;
}

export interface StrategyOverride {
    categoryId: string;
    strategySource: string;
    targetWindowId: string;
    selected_keywords: any[];
    keywordBaseHash: string;
    createdAt: string;
    mappingProfileId: string;
}

// --- Demand ---

export interface Trend5yOutput {
    value_percent: number | null;
    trend_label: string;
    source: string;
    coverage: number;
    windowId: string;
    keywordCountTotal: number;
    keywordCountWithTrend: number;
    method: string;
    period: string;
    timestamp: string;
    trend_source?: string;
    trendStatus?: string;
    trendError?: string;
}

export interface DemandMetricsV4 {
    version: string;
    computedAt: string;
    inputs: any;
    demand: {
        absolute_mn: number;
        normalized_index_0_100: number;
        normalization: any;
    };
    readiness: {
        score_0_5: number;
        label: string;
        method: string;
        components: any;
    };
    spread: {
        score_0_5: number;
        label: string;
        method: string;
        components: any;
    };
    diagnostics: any;
}

export interface DemandInsight {
    title: string;
    executiveSummary: string;
    opportunity: string;
    riskFlag: string;
    breakdown: string[];
    source: string;
    generatedAt: string;
}

export interface SweepResult {
    category: string;
    demand_index_mn: number;
    metric_scores: { readiness: number; spread: number };
    engagement_readiness: string;
    demand_spread: string;
    trend_5y: Trend5yOutput;
    anchors: AnchorData[];
    synthesis: {
        key_takeaway: string;
        summary_statement: string;
        early_outlook: string;
    };
    analyst_insight: string[];
    runId: string;
    resolvedCoverage: number;
    unresolvedPercent: number;
    zeroVolumePercent: number;
    totalKeywordsInput: number;
    totalKeywordsResolved: number;
    totalKeywordsUsedInMetrics: number;
    resolvedKeywordCount: number;
    activeAnchorsCount: number;
    zeroVolumeAnchorsCount: number;
    isFailedDataQuality: boolean;
    methodologyVersion: string;
    indexSource: string;
    metricsVersion?: string;
    demandIndexAbsolute?: number;
    demandIndexMn?: number;
    readinessScore?: number;
    spreadScore?: number;
    fiveYearTrendPct?: number | null;
    trendStatus?: string;
    demandAudit?: any;
    metrics_v2?: any;
    metrics_v4?: DemandMetricsV4;
    forensic?: any;
    corpusFingerprint?: string;
    demand_insights?: DemandInsight; // Added P0
}

export interface DemandArtifact {
    id: string;
    categoryId: string;
    windowId: string;
    result: SweepResult;
}

export interface CategoryMetrics {
    snapshotId: string;
    snapshotStatus: SnapshotLifecycle | 'UNKNOWN';
    computedAt: number;
    demandIndex: {
        value: number;
        unit: string;
        display: string;
    };
    readinessScore: {
        value: number;
        scaleMax: number;
        label: string;
    };
    spreadScore: {
        value: number;
        scaleMax: number;
        label: string;
    };
    trend: {
        label: string;
        valuePercent?: number;
    };
    inputs: {
        keywordCountTotal: number;
        keywordCountValidated: number;
        volumeSumValidated: number;
        volumeSumAllKnown: number;
        coverage: number;
    };
    quality: {
        isPartial: boolean;
        reasons: string[];
    };
}

export interface DemandForensicReport {
    version: string;
    category_key: string;
    run_id: string;
    created_at_iso: string;
    contract_hash: string;
    contract_status: DemandContractStatus;
    violations: Array<{ code: string; path: string; message: string; severity: 'WARN' | 'FAIL' }>;
    raw_metrics: any;
    normalized_display: any;
    benchmark?: {
        benchmark_id: string;
        certified_at_iso: string;
        runs: number;
        deltas: {
            demand_index_pct: number | null;
            engagement_pct: number | null;
            spread_pct: number | null;
        }
    };
    notes: string[];
}

export interface SweepInputsMeta {
    timestamp: string;
    [key: string]: any;
}

export interface SweepContract {
    payload: any;
    payloadString: string;
    hash: string;
    outputDigest: string;
}

// --- Deep Dive ---

export interface DeepDiveResult {
    categoryId: string;
    monthKey: string;
    status: string;
    generatedAt: string;
    schemaVersion?: string;
    provenance?: any;
    executiveSummary?: any;
    marketStructure?: any;
    consumerIntelligence?: any;
    signalsSnapshot?: any;
    diagnoses?: any;
    competitiveLandscape?: any;
    opportunities?: any;
    messaging?: any;
    activation?: any;
    methodology?: any;
    warnings?: string[];
    synthesis: any;
    signals: any;
    signalsBundle?: any;
    categoryName?: string;
    sources?: any;
    mode?: string;
    category?: string; // Legacy
    consumer_intelligence?: any; // Legacy
    market_dynamics?: any; // Legacy
    content_intelligence?: any; // Legacy
}

export interface DeepDiveResultV2 extends DeepDiveResult {
    verdict?: string;
    failCode?: string;
    deepDiveMetrics?: DeepDiveMetrics;
    ritualsAndRoutines?: any;
    triggersBarriers?: any;
    regionalIntelligence?: any;
    influencerEcosystem?: any;
    brandPerceptions?: any;
    measurementPlan?: any;
    appendix?: any;
    ingredientsAtPlay?: any;
    packagingAndPricing?: any;
    consumerTruthForCategory?: { truth: string; supportingBullets: string[] };
}

export interface DeepDiveMetrics {
    demandIndexMn: number;
    readinessScore: number;
    spreadScore: number;
    trend5yPercent: number | null;
    source: string;
}

export interface DeepDiveInputBundleV2 {
    categoryId: string;
    monthKey: string;
    generatedAtIso: string;
    demand: {
        ok: boolean;
        snapshotId: string | null;
        lifecycle: string | null;
        metrics: {
            demandIndex: number;
            readiness: number;
            spread: number;
            trend: number | null;
            trendLabel: string;
            source: string;
        } | null;
        reasonIfMissing: string | null;
    };
    keywords: {
        ok: boolean;
        snapshotId: string | null;
        lifecycle: string | null;
        anchors: { id: string; title: string; keywords: any[] }[] | null;
        clusters: any[] | null;
        rowCount: number | null;
        reasonIfMissing: string | null;
    };
    signals: {
        mode: string;
        corpusSnapshotId: string | null;
        harvesterCollection: string;
        items: SignalDTO[];
        reasonIfEmpty: string | null;
    };
    coverage: {
        window: any;
        counts: any;
        ratios: any;
        platformMix: any[];
        topProvenance: any[];
        gates: any;
        notes: string[];
    };
}

export interface DeepDiveSectionsV1 {
    primaryTension?: any;
    whatsDrivingDemand?: any;
    marketShape?: any;
    momentum?: any;
    brandImplications?: any;
    opportunityMap?: any;
    consumerSegmentation?: any;
    contentIntelligence?: any;
    regionalIntelligence?: any;
    consumerTruth?: string;
    contentSignalSummary?: string;
    conversationSignalSummary?: string;
    transactionSignalSummary?: string;
}

export interface DeepDiveSignalsV1 {
    youtubeSignals?: any[];
    instagramSignals?: any[];
    twitterSignals?: any[];
    conversationSignals?: any[];
    transactionProof?: any[];
    flipkartSignals?: any[];
    quoraSignals?: any[];
    quickCommerceSignals?: any[];
    contentCreators?: any[];
}

export interface DeepDiveV1 {
    categoryId: string;
    categoryName: string;
    synthesis: DeepDiveSectionsV1;
    signals: DeepDiveSignalsV1;
    qualityFlags?: any;
}

export interface PersonaV1 {
    name: string;
    ageGroup: string;
    region: string;
    language: string;
    whatTheyAreThinking: string[];
    needs: string[];
    aspirations: string[];
    doubts: string[];
    emotionalDrivers: string[];
    quotes: { quote: string; sourceType: string }[];
}

export interface PlaybookResult {
    category: string;
    executiveSummary: string;
    positioning: string[];
    messaging_pillars: string[];
    content_plan: string[];
    channel_recommendations: string[];
    creativeAngles: string[];
    action_plan_30_60_90: {
        day30: string[];
        day60: string[];
        day90: string[];
    };
    risksAndMitigations: { risk: string; mitigation: string }[];
    measurement_kpis: string[];
    evidenceAppendix?: any[];
    targetSegments?: any[];
    priorityOpportunities?: any[];
    signalsUsed?: {
        contentCount: number;
        conversationCount: number;
        transactionCount: number;
    };
    generated_at?: string;
}

export interface PlaybookInputV1 {
    categoryId: string;
    categoryName: string;
    consumerTruth: string;
    contentSummary: string;
    conversationSummary: string;
    transactionSummary: string;
    topSignals: {
        content: any[];
        conversation: any[];
        transaction: any[];
    };
    marketContext: any;
}

// --- Snapshot & Corpus ---

export interface SnapshotKeywordRow {
    keyword_id: string;
    keyword_text: string;
    volume: number | null;
    amazonVolume?: number;
    amazonBoosted?: boolean;
    cpc?: number;
    competition?: number;
    anchor_id: string;
    intent_bucket: string;
    status: string; // 'VALID' | 'ZERO' | 'UNVERIFIED' | 'ERROR' | 'LOW'
    active: boolean;
    language_code: string;
    country_code: string;
    category_id: string;
    created_at_iso: string;
    validated_at_iso?: string;
    pruned_reason?: string;
    demandScore?: number;
    validation_tier?: string;
}

export interface SnapshotAnchor {
    anchor_id: string;
    order: number;
    source: string;
}

export interface CategorySnapshotDoc {
    snapshot_id: string;
    category_id: string;
    country_code: string;
    language_code: string;
    lifecycle: SnapshotLifecycle;
    created_at_iso: string;
    updated_at_iso: string;
    anchors: SnapshotAnchor[];
    targets: { per_anchor: number; validation_min_vol: number };
    stats: {
        anchors_total: number;
        keywords_total: number;
        valid_total: number;
        zero_total: number;
        validated_total: number;
        low_total: number;
        error_total: number;
        per_anchor_valid_counts?: Record<string, number>;
        per_anchor_total_counts?: Record<string, number>;
    };
    integrity: {
        sha256: string;
        chunk_count: number;
        chunk_size: number;
        last_published_iso?: string;
    };
    certificationReportV2?: CertificationReportV2;
    certify_state?: any;
    validation_job?: any;
    rebuildStatus?: string;
    certV3LeanVerdict?: string;
    certV3LeanStats?: any;
}

export interface OutputSnapshotDoc {
    docId: string;
    snapshot_id?: string;
    categoryId: string;
    category_id?: string;
    month: string;
    country: string;
    country_code?: string;
    language: string;
    language_code?: string;
    corpusSnapshotId: string;
    corpusFingerprint?: string;
    computedAt: string;
    created_at_iso?: string;
    updated_at_iso?: string;
    metricsVersion: string;
    version: string;
    demand_index_mn: number;
    metric_scores: { readiness: number; spread: number };
    trend_5y: any;
    totalKeywordsInput: number;
    totalKeywordsUsedInMetrics: number;
    eligibleCount?: number;
    result?: any;
    strategy?: any;
    demand?: any;
    integrity?: any;
    lifecycle?: string;
}

export interface DeepDiveSnapshotDoc {
    snapshot_id: string;
    output_snapshot_id: string;
    category_id: string;
    country_code: string;
    language_code: string;
    created_at_iso: string;
    updated_at_iso: string;
    lifecycle: string;
    deep_dive: any;
    integrity: { sha256: string };
}

export interface CorpusIndexDoc {
    categoryId: string;
    countryCode: string;
    languageCode: string;
    activeSnapshotId: string;
    snapshotStatus: string;
    keywordTotals: {
        total: number;
        validated: number;
        valid: number;
        zero: number;
    };
    anchorStats: Array<{
        anchorId: string;
        total: number;
        valid: number;
        zero: number;
        yieldRate: number;
    }>;
    updatedAt: string;
    source?: string;
}

export interface CertificationReportV2 {
    ok: boolean;
    lifecycle: string;
    anchorCount: number;
    anchorsPassing: number;
    validNonZeroKeywords: number;
    totalKeywords: number;
    coveragePct: number;
    healthGrade: string;
    failureReasons: string[];
    timestamp: string;
}

export interface ReadinessTierReport {
    pass: boolean;
    reasons: string[];
    missing: {
        global_valid_needed: number;
        global_validated_needed: number;
        min_valid_per_anchor: Record<string, number>;
    };
}

export interface CertificationReadiness {
    category_id: string;
    snapshot_id: string;
    lifecycle: string;
    anchors_total: number;
    target_per_anchor: number;
    validation_min_vol: number;
    totals: {
        keywords_total: number;
        validated_total: number;
        valid_total: number;
        low_total: number;
        zero_total: number;
        error_total: number;
    };
    per_anchor: Record<string, { total: number, valid: number }>;
    lite: ReadinessTierReport;
    full: ReadinessTierReport;
    status: ReadinessStatus;
    score: number;
    summary: string;
    checks: any;
    blockers: ReadinessBlocker[];
    nextStep: {
        primaryAction: 'NONE' | 'GROW' | 'VALIDATE' | 'CERTIFY' | 'RESUME';
        description: string;
        expectedOutcome: string;
    };
    anchorDetails: Record<string, { total: number, valid: number, status: 'GOOD' | 'OK' | 'WEAK' }>;
}

export interface ReadinessBlocker {
    id: string;
    title: string;
    message: string;
    severity: 'BLOCKER' | 'WARNING';
    actionType: 'VALIDATE' | 'GROW' | 'CERTIFY' | 'RESUME';
    actionLabel: string;
}

export type ReadinessStatus = 'READY' | 'WARNING' | 'BLOCKED';

// --- Jobs ---

export interface JobState {
    jobId: string;
    type: string;
    stage_name: string;
    categoryId: string;
    windowId?: string;
    snapshotId?: string;
    status: string; // 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'CANCELLING' | 'STOPPED' | 'INITIALIZING'
    progress: number | { processed: number; total: number };
    message: string;
    createdAt: string;
    startedAt: string;
    updatedAt: string;
    logs: string[];
    activity_log: any[];
    currentStage?: string;
    inputsUsed?: any[];
    outputsExpected?: any[];
    isMinimized?: boolean;
    error?: string;
    kind?: string;
    phase?: string; // Added
}

export type MasterJob = JobState; // Alias

export interface CorpusJobControl extends JobState {
    kind: string;
    telemetry: any;
    stopRequested?: boolean;
    completedAt?: number;
}

export interface ValidationJob {
    id: string;
    categoryId: string;
    countryCode: string;
    languageCode: string;
    snapshotId: string;
    status: 'RUNNING' | 'PAUSED' | 'FAILED' | 'COMPLETE';
    cursor: { chunkIdx: number; rowIdx: number };
    totals: { totalRows: number; rowsNeedingValidation: number };
    counters: { 
        processed: number; 
        success: number; 
        skipped: number; 
        rateLimited: number; 
        failures: number; 
        apiCalls: number; 
        cacheHits: number; 
    };
    timings: { 
        startedAt: number; 
        updatedAt: number; 
        lastProgressAt: number;
        completedAt?: number;
    };
    config: any;
    lastError?: any;
}

export type ValidationJobState = ValidationJob; // Alias

export interface BatchCertificationJob {
    jobId: string;
    tier: BatchCertifyTier;
    status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
    startedAtIso: string;
    updatedAtIso: string;
    cursorIndex: number;
    totalCategories: number;
    summary: { attempted: number; certified: number; skipped: number; failed: number };
    rows: BatchCertifyRow[];
}

export interface BatchCertifyRow {
    categoryId: string;
    categoryName: string;
    tier: BatchCertifyTier;
    status: 'PENDING' | 'CERTIFIED' | 'SKIPPED' | 'FAILED';
    snapshotId?: string;
    lifecycle?: string;
    reasons?: string[];
    tookMs: number;
    timestamp: string;
}

export type BatchCertifyTier = 'LITE' | 'FULL';

export interface BatchVerificationJob {
    jobId: string;
    type: 'LITE_VERIFICATION';
    status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
    startedAtIso: string;
    updatedAtIso: string;
    cursorIndex: number;
    totalCategories: number;
    summary: { attempted: number; validated: number; skipped: number; failed: number };
    rows: BatchVerificationRow[];
}

export interface BatchVerificationRow {
    categoryId: string;
    categoryName: string;
    status: 'PENDING' | 'VALIDATED_LITE' | 'SKIPPED' | 'FAILED';
    snapshotId?: string;
    lifecycle?: string;
    reasons?: string[];
    metrics?: { valid: number; total: number };
    tookMs: number;
    timestamp: string;
}

export interface RunPlan {
    id: string;
    createdAt: string;
    selectedCategories: string[];
    selectedGears: WorkflowGear[];
    executionMode: 'SEQUENTIAL_BY_CATEGORY' | 'SEQUENTIAL_BY_GEAR';
    batch: {
        categoryBatchSize: number;
        maxConcurrency: number;
    };
    status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
    totalTasks: number;
    completedTasks: number;
}

// --- Signals ---

export interface SignalItem {
    title: string;
    description: string;
    impact: "HIGH" | "MEDIUM" | "LOW";
    evidence: string[];
    keywords: string[];
}

export interface SignalSnapshot {
    snapshotId: string;
    harvestVersion: string;
    timeWindow: string;
    signals: {
        problems: SignalItem[];
        aspirations: SignalItem[];
        routines: SignalItem[];
        triggers: SignalItem[];
        barriers: SignalItem[];
        trends: SignalItem[];
        needGaps: SignalItem[];
    };
}

export interface SignalResolutionResult {
    ok: boolean;
    data?: SignalSnapshot;
    snapshotId?: string;
    harvestVersion?: string;
    resolvedMonthKey?: string;
    mode: "EXACT" | "FALLBACK_LATEST" | "NONE";
    reason?: string;
}

export interface SignalDTO {
    id: string;
    title: string;
    snippet: string;
    url: string;
    categoryId: string;
    platform: string;
    source: string;
    signalType: string;
    trustScore: number;
    confidence: number;
    firstSeenAt: string | null;
    lastSeenAt: string | null;
    collectedAt?: string;
    enrichmentStatus?: string;
    trusted?: boolean;
    provenance?: string;
}

export interface SignalCorpusSnapshot {
    id: string;
    categoryId: string;
    monthKey: string;
    version: string;
    signalCount: number;
    platforms: string[];
    languages: string[];
    createdAtIso: string;
    chunkCount: number;
    source: any;
    stats: any;
    warnings: string[];
    summary: any;
}

export interface SignalCorpusChunk {
    index: number;
    signals: SignalDTO[];
}

export interface SourceItem extends SignalDTO {
    is_backfilled?: boolean;
    capturedAt?: string; // Added
}

export interface SignalsBundle {
    sources: any; // DeepDiveSignalsV1 compatible
}

// --- Misc ---

export interface LockedKeyword {
    keywordCanonical: string;
    anchor: string;
    cluster: string | null;
    intent: string;
    language: string;
    canonicalFamilyId: string;
}

export interface KeywordRegister {
    categoryId: string;
    version: string;
    keywords: LockedKeyword[];
    hash: string;
    updatedAt: string;
}

export interface BenchmarkSnapshot {
    snapshotVersion: string;
    createdAtISO: string;
    expiresAtISO: string;
    registryHash: string;
    keywordBaseHash: string;
    iterations: number;
    status: string;
    categories: Record<string, CategoryBenchmarkStats>;
    global: {
        maxVariancePctAcrossAll: {
            demandIndexMn: number;
            readinessScore: number;
            spreadScore: number;
        }
    };
}

export interface CategoryBenchmarkStats {
    categoryId: string;
    iterations: number;
    metrics: string[];
    mean: { demandIndexMn: number; readinessScore: number; spreadScore: number };
    median: { demandIndexMn: number; readinessScore: number; spreadScore: number };
    stdev: { demandIndexMn: number; readinessScore: number; spreadScore: number };
    min: { demandIndexMn: number; readinessScore: number; spreadScore: number };
    max: { demandIndexMn: number; readinessScore: number; spreadScore: number };
    maxVariancePct: { demandIndexMn: number; readinessScore: number; spreadScore: number };
    confidenceBands?: any;
    keywordBasis: any[];
}

export type CertifiedBenchmarkV3 = BenchmarkSnapshot & {
    id: string;
    certifiedAtISO: string;
    methodologyVersion: string;
    global: {
        certifiedCategoriesCount: number;
    };
};

export interface StabilityLock {
    active: boolean;
    approvedAt: string;
    expiresAt: string;
    approvedBacktestRunId: string;
    baselineMedians: Record<string, any>;
}

export interface CsvMappingProfile {
    id: string;
    categoryId: string;
    detectedHeaders: string[];
    mapping: {
        keywordIndex: number;
        volumeIndex: number;
        trendPercentIndex?: number;
        trendSeriesIndices?: number[];
    };
    createdAt: string;
}

export interface KeywordVolumeRecord {
    keyword_norm: string;
    volume: number;
    cpc: number;
    competition: number;
    fetched_at_iso: string;
    source: string;
}

export interface ResolvedSnapshot {
    ok: boolean;
    categoryId: string;
    snapshotId: string | null;
    snapshotStatus: string;
    resolutionStatus: string;
    reason: string;
    source: string;
    snapshot: CategorySnapshotDoc | null;
    telemetry: any;
    error?: string;
}

export interface CategoryHydrationStats {
    categoryId: string;
    status: string;
    anchorsPlanned: number;
    anchorsHydrated: number;
    keywordsGenerated: number;
    keywordsValidated: number;
    zeroVolumeCount: number;
    lastRunAtIso: string | null;
    durationMs: number;
    targetPerAnchor: number;
    lastError?: string;
}

export interface CorpusLifecycleState {
    globalStatus: 'IDLE' | 'BUSY';
    categories: Record<string, CategoryHydrationStats>;
    lifecycleState: string;
    publishedAtIso?: string;
    publishedBy?: string;
}

export interface CanonicalCategory {
    id: string;
    anchors: CanonicalAnchor[];
}

export interface CanonicalAnchor {
    id: string;
    name: string;
    intent: string;
    subCategory: string;
    fingerprint: { include: string[]; exclude?: string[] };
}

export interface CanonicalGraph {
    categoryId: string;
    windowId: string;
    totalVolume: number;
    keywords: BucketedKeyword[];
    anchors: Record<string, { volume: number; keywordCount: number; topKeywords: string[] }>;
}

export interface BucketedKeyword {
    keyword: string;
    normalized: string;
    volume: number;
    anchorId: string;
    subCategory: string;
    intent: string;
}

export interface V4IntegrityReport {
  ts: string;
  verdict: "GO" | "NO_GO";
  checks: {
    firestore: { ok: boolean; readOk: boolean; writeOk: boolean; latencyMs: number; error: string };
    creds: { ok: boolean; amazon: boolean; details: string };
    amazonApi: { ok: boolean; status: number; latencyMs: number; keywordsSent: number; rowsParsed: number; matchedPath: string; error: string; hint?: string };
    cache: { ok: boolean; writes: number; readbacks: number; mismatches: number };
    snapshot: { ok: boolean; snapshotId: string | null; rowsUpdated: number; backwardOk: boolean; forwardOk: boolean; error: string };
    provenance: { ok: boolean; data?: any; error?: string };
  };
  blockers: string[];
  warnings: string[];
  nextSteps: string[];
}

export interface ValidityResult {
    isValid: boolean;
    validitySource: string;
    evidence: any;
    checkedAt: string;
}

export interface ValidityReport {
    windowId: string;
    categoryId: string;
    [key: string]: any;
}
export interface SignalItem {
    title: string;
    description: string;
    impact: "HIGH" | "MEDIUM" | "LOW";
    evidence: string[];
    keywords: string[];
}

export interface SignalSnapshot {
    snapshotId: string;
    harvestVersion: string;
    timeWindow: string;
    signals: {
        problems: SignalItem[];
        aspirations: SignalItem[];
        routines: SignalItem[];
        triggers: SignalItem[];
        barriers: SignalItem[];
        trends: SignalItem[];
        needGaps: SignalItem[];
    };
}

export interface SignalResolutionResult {
    ok: boolean;
    data?: SignalSnapshot;
    snapshotId?: string;
    harvestVersion?: string;
    resolvedMonthKey?: string;
    mode: "EXACT" | "FALLBACK_LATEST" | "NONE";
    reason?: string;
}
