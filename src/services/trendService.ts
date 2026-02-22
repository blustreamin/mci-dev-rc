
import { GoogleGenAI } from "@google/genai";
import { FirestoreClient } from './firestoreClient';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { Trend5yOutput, TrendLabel, TrendSource } from '../types';

const safeProcess = (typeof process !== 'undefined' && process && process.env) 
    ? process 
    : { env: {} as Record<string, string | undefined> };

function getAI() {
  const apiKey = safeProcess.env.API_KEY;
  if (!apiKey) throw new Error("API Key missing");
  return new GoogleGenAI({ apiKey });
}

// 30 Days Cache for Trend Data
const TREND_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const TrendService = {
    
    async getCategoryTrend(
        categoryId: string, 
        categoryName: string, 
        topKeywords: string[]
    ): Promise<Trend5yOutput> {
        
        // 1. Check Cache (Firestore)
        const db = FirestoreClient.getDbSafe();
        if (db) {
            try {
                const docRef = doc(db, 'category_trend_store', categoryId);
                const snap = await getDoc(docRef);
                
                if (snap.exists()) {
                    const data = snap.data() as Trend5yOutput;
                    const age = Date.now() - new Date(data.timestamp).getTime();
                    
                    if (age < TREND_TTL_MS) {
                        console.log(`[TREND][FETCH_OK] Served from cache for ${categoryId}`);
                        return data;
                    }
                }
            } catch (e) {
                console.warn(`[TREND] Cache read error for ${categoryId}`, e);
            }
        }

        // 2. Fetch from Gemini (Google Trends Source)
        const result = await this.fetchFromGemini(categoryName, topKeywords);
        
        // 3. Persist
        if (db) {
            try {
                await setDoc(doc(db, 'category_trend_store', categoryId), FirestoreClient.sanitize(result));
            } catch (e) {
                console.error(`[TREND] Cache write error`, e);
            }
        }

        return result;
    },

    async fetchFromGemini(categoryName: string, keywords: string[]): Promise<Trend5yOutput> {
        const ai = getAI();
        const top5 = keywords.slice(0, 5).join(", ");
        
        const prompt = `
            Acting as a data analyst, retrieve Google Trends interest over time data for the category '${categoryName}' in India for the past 5 years (60 months).
            
            Context keywords for grounding: ${top5}
            
            Task:
            1. Analyze the trend line.
            2. Calculate the average interest of the first 12 months (Year 1).
            3. Calculate the average interest of the last 12 months (Year 5).
            4. Compute growth percentage: ((Last12 - First12) / First12) * 100.
            5. Assign a label: 'Growing' (>10%), 'Stable' (-10% to 10%), 'Declining' (< -10%), 'Strong Up' (>25%), 'Strong Down' (< -25%).

            Output STRICT JSON:
            {
              "start_avg": number,
              "end_avg": number,
              "trend_pct": number,
              "label": "string"
            }
            
            If reliable data is unavailable, return {"trend_pct": 0, "label": "Unknown", "error": true}.
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

            const text = response.text || "{}";
            const data = JSON.parse(text);
            
            if (data.error || typeof data.trend_pct !== 'number') {
                throw new Error("Invalid trend data from LLM");
            }

            console.log(`[TREND][FETCH_OK] ${categoryName}: ${data.trend_pct}% (${data.label})`);

            return {
                value_percent: data.trend_pct,
                trend_label: this.normalizeLabel(data.label),
                source: 'Google Trends (Gemini 3 Flash)',
                trend_source: 'GOOGLE_TRENDS',
                coverage: 1,
                windowId: 'now',
                keywordCountTotal: keywords.length,
                keywordCountWithTrend: keywords.length,
                method: 'MODEL_ESTIMATE',
                period: '5y',
                timestamp: new Date().toISOString()
            };

        } catch (e) {
            console.warn(`[TREND][FALLBACK_USED] Failed to fetch trend for ${categoryName}`, e);
            
            // Fallback: DERIVED_PROXY (0%)
            return {
                value_percent: 0,
                trend_label: 'Unknown',
                source: 'Fallback (Proxy)',
                trend_source: 'DERIVED_PROXY',
                coverage: 0,
                windowId: 'now',
                keywordCountTotal: keywords.length,
                keywordCountWithTrend: 0,
                method: 'UNKNOWN',
                period: '5y',
                timestamp: new Date().toISOString()
            };
        }
    },

    normalizeLabel(raw: string): TrendLabel {
        const lower = raw.toLowerCase();
        if (lower.includes('strong up')) return 'Strong Up';
        if (lower.includes('strong down')) return 'Strong Down';
        if (lower.includes('growing') || lower.includes('up') || lower.includes('rising')) return 'Growing';
        if (lower.includes('declining') || lower.includes('down')) return 'Declining';
        return 'Stable';
    }
};
