
export interface SeedKeywordRow {
    // Keys
    categoryId: string;
    monthWindowId: string; 
    keywordKey: string; 
    
    // Core Data
    keywordText: string;
    baseVolume: number | null; 
    
    // Derived Metrics
    trend_12m_pct?: number;
    trend_5y_cagr_pct?: number;
    trend_label?: string; // 'Rising' | 'Stable' | 'Declining'
    seasonality_index?: number;
    
    // Classification
    intentBucket: 'Decision' | 'Need' | 'Problem' | 'Habit' | 'Aspirational' | 'Discovery' | 'UNKNOWN';
    anchorId: string;
    subCategory?: string;
    
    // Meta
    source: 'MANGOOLS_SNAPSHOT';
    sourceFileName: string;
    ingestedAt: string;
    
    // Raw Data for provenance
    rawRowData?: any; 
}

export interface SeedMeta {
    categoryId: string;
    monthWindowId: string;
    truthWindowId: string;
    seedHash: string; 
    rowCount: number;
    collapsedCount?: number; // New: Distinct concepts
    resolvedVolumePct: number;
    trendCoveragePct: number;
    zeroVolumePct: number;
    lastIngestedAt: string;
    status: 'INGESTED' | 'PROCESSED' | 'FAILED';
    sourceFileName: string;
    mappingUsed: string[];
    // Strict Gating V2
    blockingStatus?: boolean;
    blockingReason?: string;
    acceptedCount?: number;
    acceptedRate?: number;
}

export type IngestionStage = 
    | 'IDLE' 
    | 'FILE_READ' 
    | 'PARSE_HEADERS' 
    | 'PARSE_ROWS' 
    | 'COLLAPSE'  // New Stage
    | 'DERIVE_TRENDS' 
    | 'WRITE_MASTER' 
    | 'WRITE_TRUTH' 
    | 'COMPLETE' 
    | 'FAILED';

export interface IngestionProgress {
    stage: IngestionStage;
    percent: number;
    message: string;
    details?: any;
    error?: string;
}

export interface IngestionDiagnostics {
    volumeColumnHeader?: string;
    volumeColumnIndex?: number;
    volumeParseSuccessCount: number;
    volumeParseFailCount: number; // Nulls/NaNs
    volumeRawSample: string[]; // Top 10
    volumeParsedSample: (number | null)[]; // Top 10
    // Rejection Counters
    keywordBlankRejectedCount: number;
    volumeBlankRejectedCount: number;
    volumeNullRejectedCount: number;
    volumeZeroRejectedCount: number;
    volumeNaNRejectedCount: number;
    acceptedCount: number;
    acceptedSamples: { k: string, v: number }[];
    rejectedSamples: { k: string, v: any, reason: string }[];
}

export interface IngestionReport {
    categoryId: string;
    monthWindowId: string;
    status: 'SUCCESS' | 'FAILED';
    message: string;
    durationMs: number;
    stats: {
        totalRowsRead: number;
        rowsAccepted: number; // Post-collapse unique concepts > 0 vol
        duplicatesRemoved: number; // Exact dupes
        collapsedVariants: number; // Semantic duplicates
        invalidRows: number;
        missingVolumeRows: number;
        resolvedCoveragePct: number;
        zeroVolumePct: number;
        trendCoveragePct: number;
        anchorsIdentified: number;
        snapshotWindowId: string;
        // Gating
        blockingStatus: boolean;
        blockingReason?: string;
        acceptedRate: number;
    };
    mappingUsed: string[];
    errors: { row: number; msg: string; raw?: string }[];
    diagnostics?: IngestionDiagnostics;
    // Debug Sections
    debug?: {
        rejectionHistogram: Record<string, number>;
        rejectedSamples: { reason: string; rowSample: string[] }[];
        parsedRowSamples: { rowIndex: number; keyword: string; volume: number; seriesPoints: number }[];
        timeSeriesDebug: { detected: boolean; columns: number; avgPoints: number };
    };
}
