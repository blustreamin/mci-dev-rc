

export interface KeywordNode {
    term: string;
    intentBucket: string;
    rationale: string;
    source: 'SEED' | 'LLM_BACKFILL' | 'MANUAL';
    originalRow?: any;
    signals?: any; // KeywordSignals
}

export interface AnchorNarrative {
    anchorId: string;
    anchorName: string;
    intentBucket: "Discovery" | "Consideration" | "Decision" | "Care" | "Habit" | "Aspirational" | "Problem" | "Unknown";
    sharePercent: number;
    trendLabel: string;
    trendCoverage: number;
    problems: string[];
    aspirations: string[];
    emergingTrends: string[];
    evidenceTags: string[];
    exemplars: string[];
}

export interface IntentNode {
    id: string;
    name: string; // e.g. "Decision", "Discovery"
    anchors: AnchorNarrative[];
}

export interface AnchorIntelligence {
    anchorId: string;
    anchorName: string;
    intentBucket: "Discovery" | "Consideration" | "Decision" | "Care" | "Habit" | "Aspirational" | "Problem" | "Unknown";
    keywordCount: number;
    keywordExemplars: string[];
    signals: {
        problemStatements: string[];
        aspirations: string[];
        routines: string[];
        triggers: string[];
    };
    evidence: {
        topBigrams: string[];
        topModifiers: string[];
        intentRationale: string;
    };
}

export interface StrategyContract {
    categoryId: string;
    categoryName: string;
    windowId: string;
    createdAtISO: string;
    
    // Core Hierarchy
    intentMap: IntentNode[];
    
    // Synthesis
    strategicSummary: string[]; // 5-8 bullets
    dataQuality: {
        volumeCoveragePercent: number;
        monthlySeriesCoveragePercent: number;
        anchorsCount: number;
        topAnchorShares: Array<{anchorName: string, share: number}>;
    };

    // Lookup Optimization
    anchorKeywordSet: Record<string, string[]>; // anchorId -> normalized keywords
    selected_keywords: string[]; // All normalized unique keywords
    
    // Config
    intentMixTargets: Record<string, { min: number; max: number }>;
    exclusions: string[];
    
    // Quality & Audit
    keywordQualityReport: {
        total: number;
        deduped: number;
        invalid: number;
        generic: number;
        brandNoise: number;
        adultRisk: number;
        notes: string[];
    };
    
    strategyHash: string; // SHA-256 of anchorKeywordSet
    provenance: {
        usedTruthSeed: boolean;
        seedKeywordCount?: number;
        generatedKeywordCount: number;
        seedSource?: string;
    };
    
    // Legacy support (optional)
    anchorIntelligence?: Record<string, any>;
}