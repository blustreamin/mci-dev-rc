
import { GoogleGenAI } from "@google/genai";

// Safe env access
const safeProcess = (typeof process !== 'undefined' && process && process.env) 
    ? process 
    : { env: {} as Record<string, string | undefined> };

function getApiKey(): string | undefined {
    if (safeProcess.env.API_KEY) return safeProcess.env.API_KEY;
    try {
        // @ts-ignore
        if (import.meta && import.meta.env) {
            // @ts-ignore
            if (import.meta.env.VITE_GOOGLE_API_KEY) return import.meta.env.VITE_GOOGLE_API_KEY;
            // @ts-ignore
            if (import.meta.env.VITE_GEMINI_API_KEY) return import.meta.env.VITE_GEMINI_API_KEY;
        }
    } catch (e) {}
    return undefined;
}

function getAI() {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("API Key missing. Set VITE_GOOGLE_API_KEY.");
  return new GoogleGenAI({ apiKey });
}

export interface SchemaPlan {
    format: "STANDARD_CSV" | "PIPE_JOINED_HEADER" | "MANGOOLS_EXPORT_V1" | "UNKNOWN";
    delimiter: string;
    headerRowIndex: number;
    keyword: { index: number; confidence: number; reason: string };
    volume: { 
        index: number; 
        source: string; 
        confidence: number;
        priorityUsed?: number; 
    };
    monthlySeries: {
        present: boolean;
        monthColumns: { index: number; month: string }[]; // YYYY-MM
    };
    sanity: {
        looksLikeMangools: boolean;
        issues: string[];
    };
}

const MANGOOLS_DEFINITIONS = {
    KEYWORD_HEADER: "Keyword", 
    // STRICT: Only one allowed column for volume. No fallbacks.
    STRICT_VOLUME_HEADER: "Avg. Search Volume (Last Known Values)",
    // "Search Volume M/YYYY" e.g. "Search Volume 4/2015"
    TIME_SERIES_REGEX: /^Search Volume \d{1,2}\/\d{4}$/i
};

export const CsvAiMapping = {
    
    async inferSchema(fileName: string, rawContent: string): Promise<SchemaPlan> {
        // 1. Pre-processing
        const lines = rawContent.split(/\r?\n/).slice(0, 15);
        if (lines.length < 2) throw new Error("CSV too short");

        // 2. Delimiter Detection
        let headerLine = lines[0];
        let delimiter = ',';
        if (headerLine.includes('|') && !headerLine.includes('","')) delimiter = '|';
        else if (headerLine.includes('\t')) delimiter = '\t';

        // 3. Header Parsing
        const headers = headerLine.split(delimiter).map(h => h.trim().replace(/^"|"$/g, '').trim());
        
        // 4. Column Classification
        let keywordIdx = -1;
        let volumeIdx = -1;
        const monthColumns: { index: number, month: string }[] = [];

        headers.forEach((h, i) => {
            const hClean = h.trim();
            const hLower = hClean.toLowerCase();
            
            // A) Keyword (Required)
            if (hLower === "keyword" || hLower === "search term") {
                keywordIdx = i;
            }

            // B) Volume (STRICT but case-insensitive safe)
            // Exact text match REQUIRED but handle potential CSV lowercasing or whitespace
            if (hClean.toLowerCase() === MANGOOLS_DEFINITIONS.STRICT_VOLUME_HEADER.toLowerCase()) {
                volumeIdx = i;
            }

            // C) Time Series
            if (MANGOOLS_DEFINITIONS.TIME_SERIES_REGEX.test(hClean)) {
                const parts = hClean.match(/(\d{1,2})\/(\d{4})/);
                if (parts) {
                    const month = parts[1].padStart(2, '0');
                    const year = parts[2];
                    monthColumns.push({ index: i, month: `${year}-${month}` });
                }
            }
        });

        // 5. Schema Identification
        const isMangools = keywordIdx !== -1 && (volumeIdx !== -1 || monthColumns.length > 0);
        
        let format: SchemaPlan['format'] = isMangools ? 'MANGOOLS_EXPORT_V1' : 'STANDARD_CSV';
        if (delimiter === '|') format = 'PIPE_JOINED_HEADER';

        monthColumns.sort((a, b) => a.month.localeCompare(b.month));

        // 6. Plan Construction
        const plan: SchemaPlan = {
            format,
            delimiter,
            headerRowIndex: 0,
            keyword: { 
                index: keywordIdx, 
                confidence: keywordIdx !== -1 ? 1 : 0, 
                reason: keywordIdx !== -1 ? "Header Match" : "Missing 'Keyword' column" 
            },
            volume: { 
                index: volumeIdx, 
                source: volumeIdx !== -1 ? MANGOOLS_DEFINITIONS.STRICT_VOLUME_HEADER : "MISSING", 
                confidence: volumeIdx !== -1 ? 1 : 0
            },
            monthlySeries: {
                present: monthColumns.length > 0,
                monthColumns
            },
            sanity: {
                looksLikeMangools: isMangools,
                issues: []
            }
        };

        if (keywordIdx === -1) plan.sanity.issues.push("MISSING_REQUIRED_COLUMN:Keyword");
        if (volumeIdx === -1) plan.sanity.issues.push(`CRITICAL: Missing required volume column: '${MANGOOLS_DEFINITIONS.STRICT_VOLUME_HEADER}'`);

        return plan;
    }
};
