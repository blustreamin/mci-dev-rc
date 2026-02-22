import { SnapshotKeywordRow } from '../types';
import { SignalDTO } from './signalHarvesterClient';
import { safeText } from '../utils/safety';

export interface ChunkedInputs {
    demandChunks: Array<{
        anchor: string;
        keywords: Array<{
            term: string;
            vol: number;
            amazonVol: number;
            intent: string;
            score: number;
        }>;
    }>;
    signalsChunk: SignalDTO[];
    totals: {
        demandKeywords: number;
        anchors: number;
        signals: number;
    };
}

export const DeepDiveChunkPlanner = {
    
    plan(rows: SnapshotKeywordRow[], signals: SignalDTO[]): ChunkedInputs {
        
        // 1. Demand Planning
        const anchors = Array.from(new Set(rows.map(r => r.anchor_id)));
        const demandChunks = [];
        let totalDemandKw = 0;

        const MAX_KW_PER_ANCHOR = 80;
        const GLOBAL_KW_CAP = 900;

        // Sort anchors by total volume to prioritize impact
        const anchorVols: Record<string, number> = {};
        rows.forEach(r => {
            anchorVols[r.anchor_id] = (anchorVols[r.anchor_id] || 0) + (r.volume || 0);
        });
        anchors.sort((a,b) => anchorVols[b] - anchorVols[a]);

        for (const anchor of anchors) {
            if (totalDemandKw >= GLOBAL_KW_CAP) break;

            const anchorRows = rows.filter(r => r.anchor_id === anchor && r.active);
            
            // Selection Strategy:
            // 1. Top Volume (Head)
            // 2. High Intent (Long Tail)
            // 3. Amazon Winners (Commerce)
            
            const scoredRows = anchorRows.map(r => {
                let score = (r.volume || 0) * 0.5; // Base vol weight
                if (r.amazonVolume) score += r.amazonVolume * 1.5; // Commerce boost
                if (r.intent_bucket === 'Decision' || r.intent_bucket === 'Consideration') score *= 1.2;
                return { ...r, _score: score };
            });

            // Sort desc
            scoredRows.sort((a,b) => b._score - a._score);
            
            const selected = scoredRows.slice(0, MAX_KW_PER_ANCHOR).map(r => ({
                term: safeText(r.keyword_text),
                vol: r.volume || 0,
                amazonVol: r.amazonVolume || 0,
                intent: safeText(r.intent_bucket),
                score: r._score
            }));

            if (selected.length > 0) {
                demandChunks.push({
                    anchor,
                    keywords: selected
                });
                totalDemandKw += selected.length;
            }
        }

        // 2. Signals Planning
        // Just take Top 120 (sorted by trustScore / recency in fetcher)
        // Ensure some platform diversity if possible (naive approach: just take top)
        // With limit=120, we assume the fetcher gave us the best ones.
        const signalsChunk = signals.slice(0, 120);

        return {
            demandChunks,
            signalsChunk,
            totals: {
                demandKeywords: totalDemandKw,
                anchors: demandChunks.length,
                signals: signalsChunk.length
            }
        };
    }
};