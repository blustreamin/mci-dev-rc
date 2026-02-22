
import { SeedKeywordRow } from './csvIngestion/types';
// Fixed: src/services/strategyPack.ts should import from ../../types (root) not ../types
import { StrategyPack, StrategyPackItem } from '../../types';
import { normalizeKeywordString } from '../driftHash';

// --- Simple PRNG for Determinism ---
// SplitMix32 hash function
function xmur3(str: string) {
    let h = 1779033703 ^ str.length;
    for(let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
        h = h << 13 | h >>> 19;
    }
    return function() {
        h = Math.imul(h ^ (h >>> 16), 2246822507);
        h = Math.imul(h ^ (h >>> 13), 3266489909);
        return (h ^= h >>> 16) >>> 0;
    }
}

// SFC32 Generator
function sfc32(a: number, b: number, c: number, d: number) {
    return function() {
        a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
        let t = (a + b) | 0;
        a = b ^ b >>> 9;
        b = c + (c << 3) | 0;
        c = (c << 21 | c >>> 11);
        d = (d + 1) | 0;
        t = (t + d) | 0;
        c = (c + t) | 0;
        return (t >>> 0) / 4294967296;
    }
}

function getRNG(seed: string) {
    const seedFn = xmur3(seed);
    return sfc32(seedFn(), seedFn(), seedFn(), seedFn());
}

export const StrategyPackService = {

    buildStrategyPack(
        categoryId: string,
        rows: SeedKeywordRow[],
        windowId: string
    ): StrategyPack {
        
        const seedStr = `${categoryId}-${windowId}-StrategyPackV1`;
        const rng = getRNG(seedStr);
        
        // 1. Initial Filtering & Sorting
        // Reject garbage: numeric only, single char, etc.
        const validRows = rows.filter(r => {
            const t = r.keywordText;
            if (t.length < 3) return false;
            if (/^\d+$/.test(t)) return false; // Pure numeric
            return true;
        });

        // Dedup by normalized key
        const uniqueMap = new Map<string, SeedKeywordRow>();
        validRows.forEach(r => uniqueMap.set(normalizeKeywordString(r.keywordText), r));
        const uniqueRows = Array.from(uniqueMap.values());

        // Sort by Volume DESC (Deterministic baseline)
        uniqueRows.sort((a, b) => (b.baseVolume || 0) - (a.baseVolume || 0));

        // 2. Bucketing Logic
        const packSet = new Map<string, StrategyPackItem>();
        const addToPack = (row: SeedKeywordRow, bucket: string) => {
            const k = normalizeKeywordString(row.keywordText);
            if (!packSet.has(k) && packSet.size < 800) {
                packSet.set(k, {
                    t: row.keywordText,
                    v: row.baseVolume || 0,
                    tr: row.trend_label !== 'Unknown' ? row.trend_label : undefined,
                    s: bucket
                });
                return true;
            }
            return false;
        };

        // A. HEAD_TOP_BY_VOLUME (200)
        let headCount = 0;
        for (const row of uniqueRows) {
            if (headCount >= 200) break;
            if (addToPack(row, 'HEAD')) headCount++;
        }

        // B. HIGH_INTENT_LONG_TAIL (150)
        const intentPatterns = /\b(buy|price|cost|best|top|review|vs|compare|near me|how to|benefits|side effects|brands|kit|guide)\b/i;
        let intentCount = 0;
        // Scan full list again
        for (const row of uniqueRows) {
            if (intentCount >= 150) break;
            if (packSet.has(normalizeKeywordString(row.keywordText))) continue;
            
            if (intentPatterns.test(row.keywordText)) {
                if (addToPack(row, 'INTENT')) intentCount++;
            }
        }

        // C. TREND_RISERS (50)
        let trendCount = 0;
        const trendRows = uniqueRows.filter(r => 
            r.trend_label === 'Growing' || r.trend_label === 'Rising' || (r.trend_5y_cagr_pct && r.trend_5y_cagr_pct > 20)
        );
        for (const row of trendRows) {
            if (trendCount >= 50) break;
            if (addToPack(row, 'TREND')) trendCount++;
        }

        // D. MID_TAIL_STRATIFIED (200)
        // Sampling from different volume bands
        let tailCount = 0;
        const remaining = uniqueRows.filter(r => !packSet.has(normalizeKeywordString(r.keywordText)));
        
        // Split remaining into 4 bands
        const bandSize = Math.floor(remaining.length / 4);
        if (bandSize > 0) {
            for (let b = 0; b < 4; b++) {
                const start = b * bandSize;
                const end = start + bandSize;
                const band = remaining.slice(start, end);
                
                // Sample 50 from each band using seeded RNG
                let picked = 0;
                while (picked < 50 && band.length > 0) {
                    const idx = Math.floor(rng() * band.length);
                    const row = band[idx];
                    if (addToPack(row, 'MID_TAIL')) {
                        picked++;
                        tailCount++;
                    }
                    band.splice(idx, 1); // Remove used
                }
            }
        }

        // E. Backfill if needed (up to 800)
        if (packSet.size < 800) {
            const leftovers = uniqueRows.filter(r => !packSet.has(normalizeKeywordString(r.keywordText)));
            for (const row of leftovers) {
                if (packSet.size >= 800) break;
                addToPack(row, 'BACKFILL');
            }
        }

        // 3. Stats Generation
        const totalVol = uniqueRows.reduce((sum, r) => sum + (r.baseVolume || 0), 0);
        const zeroVolCount = uniqueRows.filter(r => (r.baseVolume || 0) === 0).length;
        
        // Extract Bigrams for context
        const bigramCounts: Record<string, number> = {};
        uniqueRows.slice(0, 2000).forEach(r => {
            const words = r.keywordText.toLowerCase().split(/\s+/);
            for(let i=0; i<words.length-1; i++) {
                const bg = `${words[i]} ${words[i+1]}`;
                bigramCounts[bg] = (bigramCounts[bg] || 0) + (r.baseVolume || 1);
            }
        });
        const topBigrams = Object.entries(bigramCounts)
            .sort((a,b) => b[1] - a[1])
            .slice(0, 15)
            .map(e => e[0]);

        return {
            categoryId,
            windowId,
            seedHash: seedStr,
            keywords: Array.from(packSet.values()),
            buckets: {
                head: headCount,
                midTail: tailCount,
                highIntent: intentCount,
                trendRisers: trendCount,
                brandTerms: 0 // Optional, skipped for speed
            },
            stats: {
                totalCorpus: uniqueRows.length,
                zeroVolumeCount: zeroVolCount,
                volumePercentiles: {
                    p20: uniqueRows[Math.floor(uniqueRows.length * 0.8)]?.baseVolume || 0,
                    p50: uniqueRows[Math.floor(uniqueRows.length * 0.5)]?.baseVolume || 0,
                    p80: uniqueRows[Math.floor(uniqueRows.length * 0.2)]?.baseVolume || 0
                },
                topBigrams
            }
        };
    }
};
