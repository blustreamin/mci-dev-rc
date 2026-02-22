
import { doc, getDoc, writeBatch, setDoc } from 'firebase/firestore';
import { FirestoreClient } from './firestoreClient';
import { normalizeKeywordString } from '../driftHash';
import { sanitizeForFirestore } from '../utils/firestoreSanitize';
import { KeywordVolumeRecord } from '../types';

const COLLECTION = 'keyword_volume_cache';

export const FirestoreVolumeCache = {
    getKey(country: string, lang: string, location: number, keyword: string) {
        return `${country}__${lang}__${location}__${normalizeKeywordString(keyword)}`;
    },

    getAmazonKey(keyword: string) {
        // Deterministic ID for Amazon India: amz_in_<normalized_keyword>
        return `amz_in_${normalizeKeywordString(keyword)}`;
    },

    async getAmazonVolume(keyword: string): Promise<{ volume: number; updatedAt: string } | null> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return null;
        try {
            const key = this.getAmazonKey(keyword);
            const snap = await getDoc(doc(db, COLLECTION, key));
            if (snap.exists()) {
                const data = snap.data();
                if (data.marketplace === 'amazon.in' && typeof data.amazon_volume === 'number') {
                    return { volume: data.amazon_volume, updatedAt: data.updatedAt };
                }
            }
        } catch (e) {}
        return null;
    },

    async setAmazonVolume(keyword: string, volume: number): Promise<void> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return;
        try {
            const key = this.getAmazonKey(keyword);
            const ref = doc(db, COLLECTION, key);
            const data = {
                keyword: keyword,
                normalized_keyword: normalizeKeywordString(keyword),
                marketplace: 'amazon.in',
                amazon_volume: volume,
                updatedAt: new Date().toISOString(),
                source: 'DFS_LABS_AMZ'
            };
            await setDoc(ref, sanitizeForFirestore(data));
        } catch (e) {
            console.error("Cache Write Error (Amazon)", e);
        }
    },

    async getMany(keywords: string[], country: string, lang: string, location: number = 2356): Promise<Map<string, KeywordVolumeRecord>> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return new Map();

        const resultMap = new Map<string, KeywordVolumeRecord>();
        
        // Parallel fetch limited concurrency
        const chunkSize = 20;
        for (let i = 0; i < keywords.length; i += chunkSize) {
            const batch = keywords.slice(i, i + chunkSize);
            const promises = batch.map(async (kw) => {
                const norm = normalizeKeywordString(kw);
                const key = this.getKey(country, lang, location, kw);
                try {
                    const snap = await getDoc(doc(db, COLLECTION, key));
                    if (snap.exists()) {
                        const data = snap.data();
                        const updated = data.updatedAt ? new Date(data.updatedAt).getTime() : 0;
                        const now = Date.now();
                        const ageDays = (now - updated) / (1000 * 60 * 60 * 24);
                        
                        // 30 Day TTL
                        if (ageDays < 30) {
                            resultMap.set(norm, {
                                keyword_norm: norm,
                                volume: data.volume || 0,
                                cpc: data.cpc || 0,
                                competition: data.competition || 0,
                                fetched_at_iso: data.updatedAt,
                                source: 'CACHE'
                            });
                        }
                    }
                } catch (e) {
                    // Ignore read errors
                }
            });
            await Promise.all(promises);
        }

        return resultMap;
    },

    async setMany(entries: Array<{keyword: string, volume: number, cpc: number, competition: number, country: string, lang: string, location: number}>): Promise<void> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return;

        const BATCH_LIMIT = 450;
        for (let i = 0; i < entries.length; i += BATCH_LIMIT) {
            const chunk = entries.slice(i, i + BATCH_LIMIT);
            const batch = writeBatch(db);
            const now = new Date().toISOString();

            chunk.forEach(e => {
                const key = this.getKey(e.country, e.lang, e.location, e.keyword);
                const ref = doc(db, COLLECTION, key);
                const data = {
                    keyword: e.keyword,
                    normalized_keyword: normalizeKeywordString(e.keyword),
                    countryCode: e.country,
                    languageCode: e.lang,
                    locationCode: e.location,
                    volume: e.volume,
                    cpc: e.cpc,
                    competition: e.competition,
                    source: 'DATAFORSEO',
                    updatedAt: now
                };
                batch.set(ref, sanitizeForFirestore(data));
            });

            await batch.commit();
        }
    }
};
