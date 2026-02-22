
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { FirestoreClient } from './firestoreClient';
import { CorpusIndexDoc, CategorySnapshotDoc } from '../types';
import { sanitizeForFirestore } from '../utils/firestoreSanitize';

const COLLECTION = 'corpus_index';

export const CorpusIndexStore = {
    getKey(categoryId: string, country: string, lang: string) {
        return `${categoryId}__${country}__${lang}`;
    },

    async get(categoryId: string, country: string = 'IN', lang: string = 'en'): Promise<CorpusIndexDoc | null> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return null;
        try {
            const snap = await getDoc(doc(db, COLLECTION, this.getKey(categoryId, country, lang)));
            if (snap.exists()) return snap.data() as CorpusIndexDoc;
            return null;
        } catch (e) {
            console.error("CorpusIndex get failed", e);
            return null;
        }
    },

    async upsertFromSnapshot(snapshot: CategorySnapshotDoc): Promise<void> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return;

        // LIFECYCLE PRIORITY GUARD
        const LIFECYCLE_PRIORITY: Record<string, number> = {
            'CERTIFIED_FULL': 100, 'CERTIFIED_LITE': 90, 'CERTIFIED': 80,
            'VALIDATED': 70, 'VALIDATED_LITE': 60, 'HYDRATED': 50, 'DRAFT': 40,
        };
        const newPriority = LIFECYCLE_PRIORITY[snapshot.lifecycle] || 0;
        try {
            const current = await this.get(snapshot.category_id, snapshot.country_code, snapshot.language_code);
            if (current && current.activeSnapshotId && current.activeSnapshotId !== snapshot.snapshot_id) {
                const currentPriority = LIFECYCLE_PRIORITY[current.snapshotStatus] || 0;
                if (currentPriority > newPriority) {
                    console.log(`[CORPUS_INDEX] SKIP: Not downgrading ${snapshot.category_id} from ${current.snapshotStatus} to ${snapshot.lifecycle}`);
                    return;
                }
            }
        } catch (e) { /* First time — proceed */ }

        console.log(`[CORPUS_INDEX] UPSERT: ${snapshot.category_id} → ${snapshot.snapshot_id} (${snapshot.lifecycle})`);

        const anchorStats: CorpusIndexDoc['anchorStats'] = [];
        
        if (snapshot.stats.per_anchor_total_counts) {
            Object.entries(snapshot.stats.per_anchor_total_counts).forEach(([aid, total]) => {
                const valid = snapshot.stats.per_anchor_valid_counts?.[aid] || 0;
                anchorStats.push({
                    anchorId: aid,
                    total: Number(total),
                    valid: Number(valid),
                    zero: Number(total) - Number(valid),
                    yieldRate: Number(total) > 0 ? Number(valid) / Number(total) : 0
                });
            });
        }

        const indexDoc: CorpusIndexDoc = {
            // Fix: property mapping
            categoryId: snapshot.category_id,
            countryCode: snapshot.country_code,
            languageCode: snapshot.language_code,
            activeSnapshotId: snapshot.snapshot_id,
            snapshotStatus: snapshot.lifecycle,
            keywordTotals: {
                total: snapshot.stats.keywords_total,
                validated: snapshot.stats.validated_total,
                valid: snapshot.stats.valid_total,
                zero: snapshot.stats.zero_total
            },
            anchorStats,
            updatedAt: new Date().toISOString()
        };

        const key = this.getKey(snapshot.category_id, snapshot.country_code, snapshot.language_code);
        await setDoc(doc(db, COLLECTION, key), sanitizeForFirestore(indexDoc));
    }
};
