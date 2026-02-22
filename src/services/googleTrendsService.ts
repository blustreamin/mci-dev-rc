
import { GoogleGenAI } from "@google/genai";
import { HEAD_TERMS, BRAND_PACKS } from './categoryKeywordGuard';
import { FirestoreClient } from './firestoreClient';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const safeProcess = (typeof process !== 'undefined' && process && process.env) 
    ? process 
    : { env: {} as Record<string, string | undefined> };

function getAI() {
  const apiKey = safeProcess.env.API_KEY;
  if (!apiKey) throw new Error("API Key missing");
  return new GoogleGenAI({ apiKey });
}

export interface TrendsResult {
    fiveYearTrendPct: number | null;
    trendStatus: 'Growing' | 'Stable' | 'Declining' | 'UNKNOWN';
    trendError?: string;
    diagnostic?: any;
}

export interface TrendLockData {
    value_percent: number | null;
    trend_label: string | null;
    source: 'GOOGLE_TRENDS' | 'LOCKED_CACHE' | 'BASELINE_DEFAULT';
    status: 'OK' | 'FAIL';
    lockId: string;
    queryKey: string;
    lockedAtISO: string;
    error?: string;
}

export async function getDeterministicTrend5y(categoryId: string, skipRemote: boolean = false): Promise<TrendLockData> {
    const db = FirestoreClient.getDbSafe();
    const lockId = categoryId; // Requirement: trend_locks/{categoryId}
    const nowIso = new Date().toISOString();

    // 1. Try Read Lock
    if (db) {
        try {
            const lockRef = doc(db, 'trend_locks', lockId);
            const snap = await getDoc(lockRef);
            
            if (snap.exists()) {
                const data = snap.data();
                // Check if it looks like a valid lock
                if (data.lockedAtISO && data.source === 'GOOGLE_TRENDS') {
                    console.log(`[DEMAND][TREND_LOCK] Reused existing lock for ${categoryId}: ${data.value_percent}% (${data.trend_label})`);
                    return {
                        value_percent: data.value_percent,
                        trend_label: data.trend_label,
                        source: 'LOCKED_CACHE',
                        status: 'OK',
                        lockId,
                        queryKey: data.queryKey || categoryId,
                        lockedAtISO: data.lockedAtISO,
                        error: undefined
                    };
                }
            }
        } catch (e) {
            console.warn(`[DEMAND][TREND_LOCK] Read failed for ${lockId}, skipping cache`, e);
        }
    }

    if (skipRemote) {
        console.log(`[DEMAND][TREND_LOCK] Offline Mode: Skipping fresh fetch for ${categoryId}. Returning Baseline Default.`);
        return {
            value_percent: null,
            trend_label: 'Stable', // Safe default for baseline
            source: 'BASELINE_DEFAULT',
            status: 'OK',
            lockId,
            queryKey: 'offline_mode',
            lockedAtISO: nowIso
        };
    }

    // 2. Fetch Fresh & Lock
    const headTerms = HEAD_TERMS[categoryId] || [];
    const brands = BRAND_PACKS[categoryId] || [];
    
    // Stable Query Key Construction
    const top3Head = headTerms.slice(0, 3);
    const topBrand = brands.length > 0 ? [brands[0]] : [];
    const queryKey = [...top3Head, ...topBrand].join(", ") || categoryId;

    console.log(`[DEMAND][TREND_LOCK] Fetching FRESH trend for ${categoryId} (query="${queryKey}")`);

    const fresh = await GoogleTrendsService.fetch5yTrendPct(categoryId);
    
    const lockPayload = {
        categoryId,
        value_percent: fresh.fiveYearTrendPct,
        trend_label: fresh.trendStatus === 'UNKNOWN' ? null : fresh.trendStatus,
        source: 'GOOGLE_TRENDS',
        queryKey,
        lockedAtISO: nowIso
    };

    // 3. Write Lock
    if (db) {
        try {
            await setDoc(doc(db, 'trend_locks', lockId), lockPayload);
            console.log(`[DEMAND][TREND_LOCK] Created NEW lock for ${lockId}`);
        } catch (e) {
            console.error(`[DEMAND][TREND_LOCK] Write failed for ${lockId}`, e);
        }
    }

    return {
        value_percent: lockPayload.value_percent,
        trend_label: lockPayload.trend_label,
        source: 'GOOGLE_TRENDS',
        status: fresh.trendError ? 'FAIL' : 'OK',
        lockId,
        queryKey,
        lockedAtISO: nowIso,
        error: fresh.trendError || undefined
    };
}

export const GoogleTrendsService = {
    /**
     * Fetches 5-year trend data for a category using search-grounded Gemini.
     */
    async fetch5yTrendPct(categoryId: string): Promise<TrendsResult> {
        const headTerms = HEAD_TERMS[categoryId] || [];
        const brands = BRAND_PACKS[categoryId] || [];
        
        if (headTerms.length === 0) {
            return { fiveYearTrendPct: null, trendStatus: 'UNKNOWN', trendError: "MISSING_HEAD_TERMS" };
        }

        // Deterministic term selection
        const top3Head = headTerms.slice(0, 3);
        const topBrand = brands.length > 0 ? [brands[0]] : [];
        const queryTerms = [...top3Head, ...topBrand].join(", ");

        const ai = getAI();
        const prompt = `
            Act as a Category Intelligence Analyst. 
            Analyze Google Trends interest over time for the following search terms in India over the LAST 5 YEARS:
            Terms: ${queryTerms}

            Task:
            1. Retrieve or simulate the monthly interest series (0-100) for these combined terms.
            2. Calculate the average interest for the First 12 months (Year 1).
            3. Calculate the average interest for the Last 12 months (Year 5).
            4. Compute Five Year Trend %: ((LastYearAvg - FirstYearAvg) / FirstYearAvg) * 100.
            5. Determine status: 'Growing' (> +5%), 'Stable' (-5% to +5%), 'Declining' (< -5%).

            Output STRICT JSON:
            {
                "firstYearAvg": number,
                "lastYearAvg": number,
                "fiveYearTrendPct": number,
                "trendStatus": "Growing" | "Stable" | "Declining"
            }
        `;

        try {
            const response = await ai.models.generateContent({
                model: 'gemini-3-flash-preview',
                contents: prompt,
                config: { 
                    responseMimeType: 'application/json',
                    tools: [{ googleSearch: {} }] 
                }
            });

            const data = JSON.parse(response.text || "{}");
            
            return {
                fiveYearTrendPct: data.fiveYearTrendPct,
                trendStatus: data.trendStatus || 'UNKNOWN',
                diagnostic: { ...data, queryTerms }
            };
        } catch (e: any) {
            console.error(`[DEMAND_V3][TRENDS][FAIL] ${e.message}`);
            return {
                fiveYearTrendPct: null,
                trendStatus: 'UNKNOWN',
                trendError: e.message
            };
        }
    }
};
