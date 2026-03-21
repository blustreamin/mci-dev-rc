
import { GoogleGenAI } from "@google/genai";
import { HEAD_TERMS, BRAND_PACKS } from './categoryKeywordGuard';
import { FirestoreClient } from './firestoreClient';
import { doc, getDoc, setDoc } from 'firebase/firestore';

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

export async function getDeterministicTrend5y(categoryId: string, skipRemote: boolean = false, dynamicTerms?: string[]): Promise<TrendLockData> {
    const db = FirestoreClient.getDbSafe();
    const lockId = categoryId;
    const nowIso = new Date().toISOString();

    // 1. Try Read Lock
    if (db) {
        try {
            const lockRef = doc(db, 'trend_locks', lockId);
            const snap = await getDoc(lockRef);
            
            if (snap.exists()) {
                const data = snap.data();
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
        return {
            value_percent: null,
            trend_label: 'Stable',
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
    
    // Use dynamic terms from corpus if no hardcoded terms exist
    const effectiveTerms = headTerms.length > 0 ? headTerms.slice(0, 3) : (dynamicTerms || []).slice(0, 5);
    const topBrand = brands.length > 0 ? [brands[0]] : [];
    const queryKey = [...effectiveTerms, ...topBrand].join(", ") || categoryId.replace(/-/g, ' ');

    console.log(`[DEMAND][TREND_LOCK] Fetching FRESH trend for ${categoryId} (query="${queryKey}" dynamicTerms=${!!dynamicTerms})`);

    const fresh = await GoogleTrendsService.fetch5yTrendPct(categoryId, effectiveTerms.length > 0 ? effectiveTerms : undefined);
    
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
    async fetch5yTrendPct(categoryId: string, dynamicTerms?: string[]): Promise<TrendsResult> {
        const headTerms = dynamicTerms || HEAD_TERMS[categoryId] || [];
        const brands = BRAND_PACKS[categoryId] || [];
        
        if (headTerms.length === 0) {
            // For dynamic categories, use the category ID as a search term
            const fallbackTerm = categoryId.replace(/-/g, ' ').replace(/_/g, ' ');
            console.log(`[DEMAND_V3][TRENDS] No HEAD_TERMS for ${categoryId}, using fallback: "${fallbackTerm}"`);
            return this._fetchWithTerms(fallbackTerm);
        }

        // Deterministic term selection
        const top3Head = headTerms.slice(0, 3);
        const topBrand = brands.length > 0 ? [brands[0]] : [];
        const queryTerms = [...top3Head, ...topBrand].join(", ");

        return this._fetchWithTerms(queryTerms);
    },

    async _fetchWithTerms(queryTerms: string): Promise<TrendsResult> {
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
