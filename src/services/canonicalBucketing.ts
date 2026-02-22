import { MasterCsvRecord } from './masterCsvStore';
import { CanonicalUtils } from '../contracts/canonicalAnchors';
import { CanonicalGraph, BucketedKeyword, CanonicalAnchor } from '../types';

export const CanonicalBucketing = {
    process(categoryId: string, windowId: string, records: MasterCsvRecord[]): CanonicalGraph {
        const schema = CanonicalUtils.getSchema(categoryId);
        const buckets: BucketedKeyword[] = [];
        const anchorStats: CanonicalGraph['anchors'] = {};

        // Initialize Stats
        schema.anchors.forEach(a => {
            anchorStats[a.id] = { volume: 0, keywordCount: 0, topKeywords: [] };
        });
        anchorStats['unclassified'] = { volume: 0, keywordCount: 0, topKeywords: [] };

        let totalVolume = 0;

        for (const record of records) {
            const norm = record.keywordNormalized;
            const text = record.rawKeyword.toLowerCase();
            const vol = record.volume;

            // STRICT: Ignore 0 volume in bucketing (they are not demand)
            if (vol <= 0) continue;

            let assigned = false;
            
            // Priority matching based on schema order
            for (const anchor of schema.anchors) {
                if (this.matches(text, anchor)) {
                    buckets.push({
                        keyword: record.rawKeyword,
                        normalized: norm,
                        volume: vol,
                        anchorId: anchor.id,
                        subCategory: anchor.subCategory,
                        intent: anchor.intent
                    });
                    
                    anchorStats[anchor.id].volume += vol;
                    anchorStats[anchor.id].keywordCount++;
                    
                    // Simple top keyword maintenance (Costly to sort every time, optimized later)
                    if (anchorStats[anchor.id].topKeywords.length < 50) {
                        anchorStats[anchor.id].topKeywords.push(record.rawKeyword); 
                    }
                    
                    assigned = true;
                    break; // Single assignment rule
                }
            }

            if (!assigned) {
                buckets.push({
                    keyword: record.rawKeyword,
                    normalized: norm,
                    volume: vol,
                    anchorId: 'unclassified',
                    subCategory: 'Other',
                    intent: 'Discovery'
                });
                anchorStats['unclassified'].volume += vol;
                anchorStats['unclassified'].keywordCount++;
            }

            totalVolume += vol;
        }

        return {
            categoryId,
            windowId,
            totalVolume,
            keywords: buckets,
            anchors: anchorStats
        };
    },

    matches(text: string, anchor: CanonicalAnchor): boolean {
        // Exclusions first
        if (anchor.fingerprint.exclude?.some(t => text.includes(t))) return false;
        // Inclusions
        return anchor.fingerprint.include.some(t => text.includes(t));
    }
};