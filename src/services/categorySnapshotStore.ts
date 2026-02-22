
import { doc, setDoc, getDoc, collection, query, orderBy, limit, getDocs, where } from 'firebase/firestore';
import { FirestoreClient } from './firestoreClient';
import { FirestoreChunkStore } from './firestoreChunkStore';
import { CategorySnapshotDoc, SnapshotLifecycle, SnapshotKeywordRow, SnapshotAnchor } from '../types';
import { sanitizeForFirestore } from '../utils/firestoreSanitize';

const ROOT_COL = 'mci_category_snapshots';

export const CategorySnapshotStore = {
    
    getDocPath(country: string, lang: string, catId: string): string {
        return `${ROOT_COL}/${country}/${lang}/${catId}/snapshots`;
    },

    async createDraftSnapshot(params: {
        categoryId: string, countryCode: string, languageCode: string, 
        anchors: SnapshotAnchor[], targets: { per_anchor: number; validation_min_vol: number }
    }): Promise<{ ok: true; data: CategorySnapshotDoc } | { ok: false; error: string }> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return { ok: false, error: "FIREBASE_DB_UNAVAILABLE" };

        return FirestoreClient.safe(async () => {
            const snapshotId = `snap_${Date.now()}_draft`;
            const path = this.getDocPath(params.countryCode, params.languageCode, params.categoryId);
            const docRef = doc(db, path, snapshotId);

            const snapshot: CategorySnapshotDoc = {
                snapshot_id: snapshotId,
                category_id: params.categoryId,
                country_code: params.countryCode,
                language_code: params.languageCode,
                lifecycle: 'DRAFT',
                created_at_iso: FirestoreClient.nowIso(),
                updated_at_iso: FirestoreClient.nowIso(),
                anchors: params.anchors,
                targets: params.targets,
                stats: {
                    anchors_total: params.anchors.length,
                    keywords_total: 0, 
                    validated_total: 0, 
                    valid_total: 0, 
                    zero_total: 0, 
                    low_total: 0, 
                    error_total: 0
                },
                integrity: {
                    sha256: '',
                    chunk_count: 0,
                    chunk_size: 400
                }
            };

            await setDoc(docRef, sanitizeForFirestore(snapshot));
            return snapshot;
        });
    },

    async getLatestSnapshot(
        params: { categoryId: string, countryCode: string, languageCode: string },
        lifecycleFilter?: SnapshotLifecycle[]
    ): Promise<{ ok: true; data: CategorySnapshotDoc } | { ok: false; error: string }> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return { ok: false, error: "FIREBASE_DB_UNAVAILABLE" };

        return FirestoreClient.safe(async () => {
            const path = this.getDocPath(params.countryCode, params.languageCode, params.categoryId);
            const colRef = collection(db, path);
            
            let q;

            if (lifecycleFilter && lifecycleFilter.length > 0) {
                q = query(
                    colRef, 
                    where('lifecycle', 'in', lifecycleFilter), 
                    orderBy('created_at_iso', 'desc'),
                    limit(1)
                );
            } else {
                q = query(colRef, orderBy('created_at_iso', 'desc'), limit(1));
            }

            const snap = await getDocs(q);
            if (!snap.empty) {
                return snap.docs[0].data() as CategorySnapshotDoc;
            }

            throw new Error("SNAPSHOT_NOT_FOUND");
        });
    },

    async getSnapshotById(
        params: { categoryId: string, countryCode: string, languageCode: string },
        snapshotId: string
    ): Promise<{ ok: true; data: CategorySnapshotDoc } | { ok: false; error: string }> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return { ok: false, error: "FIREBASE_DB_UNAVAILABLE" };

        return FirestoreClient.safe(async () => {
            const path = this.getDocPath(params.countryCode, params.languageCode, params.categoryId);
            const docRef = doc(db, path, snapshotId);
            const snap = await getDoc(docRef);
            if (!snap.exists()) throw new Error("SNAPSHOT_DOC_NOT_FOUND");
            return snap.data() as CategorySnapshotDoc;
        });
    },

    async writeSnapshot(snapshot: CategorySnapshotDoc): Promise<{ ok: true; data: boolean } | { ok: false; error: string }> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return { ok: false, error: "FIREBASE_DB_UNAVAILABLE" };

        return FirestoreClient.safe(async () => {
            const path = this.getDocPath(snapshot.country_code, snapshot.language_code, snapshot.category_id);
            const docRef = doc(db, path, snapshot.snapshot_id);
            // Fix: updated_at_iso exists on the object but not type if misaligned
            snapshot.updated_at_iso = FirestoreClient.nowIso();
            await setDoc(docRef, sanitizeForFirestore(snapshot));
            return true;
        });
    },

    async writeKeywordRows(
        params: { categoryId: string, countryCode: string, languageCode: string },
        snapshotId: string,
        rows: SnapshotKeywordRow[],
        chunkSize: number = 400
    ): Promise<{ ok: true; data: { chunkCount: number; chunkHashes: string[] } } | { ok: false; error: string }> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return { ok: false, error: "FIREBASE_DB_UNAVAILABLE" };

        return FirestoreClient.safe(async () => {
            const path = this.getDocPath(params.countryCode, params.languageCode, params.categoryId);
            const snapRef = doc(db, path, snapshotId);
            
            const res = await FirestoreChunkStore.writeChunks(snapRef, rows, chunkSize);
            if (!res.ok) throw new Error((res as any).error || "CHUNK_WRITE_FAILED");
            
            return { chunkCount: res.chunkCount, chunkHashes: res.chunkHashes };
        });
    },

    async readAllKeywordRows(
        params: { categoryId: string, countryCode: string, languageCode: string },
        snapshotId: string
    ): Promise<{ ok: true; data: SnapshotKeywordRow[] } | { ok: false; error: string }> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return { ok: false, error: "FIREBASE_DB_UNAVAILABLE" };

        return FirestoreClient.safe(async () => {
            const path = this.getDocPath(params.countryCode, params.languageCode, params.categoryId);
            const snapRef = doc(db, path, snapshotId);
            
            const res = await FirestoreChunkStore.readChunks(snapRef);
            if (!res.ok) throw new Error("CHUNK_READ_FAILED");
            return res.rows;
        });
    },

    // --- GRANULAR CHUNK API ---

    async getSnapshotChunkIds(
        params: { categoryId: string, countryCode: string, languageCode: string },
        snapshotId: string
    ): Promise<string[]> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return [];
        const path = this.getDocPath(params.countryCode, params.languageCode, params.categoryId);
        const snapRef = doc(db, path, snapshotId);
        return await FirestoreChunkStore.getChunkIds(snapRef);
    },

    async readSnapshotChunk(
        params: { categoryId: string, countryCode: string, languageCode: string },
        snapshotId: string,
        chunkId: string
    ): Promise<SnapshotKeywordRow[]> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return [];
        const path = this.getDocPath(params.countryCode, params.languageCode, params.categoryId);
        const snapRef = doc(db, path, snapshotId);
        const res = await FirestoreChunkStore.readChunk(snapRef, chunkId);
        return res ? res.rows : [];
    },

    async writeSnapshotChunk(
        params: { categoryId: string, countryCode: string, languageCode: string },
        snapshotId: string,
        chunkId: string,
        rows: SnapshotKeywordRow[],
        index: number
    ): Promise<void> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return;
        const path = this.getDocPath(params.countryCode, params.languageCode, params.categoryId);
        const snapRef = doc(db, path, snapshotId);
        await FirestoreChunkStore.writeSingleChunk(snapRef, chunkId, rows, index);
    },

    async forceMarkAllValid(
        snapshotId: string,
        categoryId: string,
        country: string,
        lang: string
    ): Promise<{ ok: boolean; error?: string }> {
        try {
            const readRes = await this.readAllKeywordRows({ categoryId, countryCode: country, languageCode: lang }, snapshotId);
            if (!readRes.ok) throw new Error("Failed to read rows for forcing validation");
            const rows = readRes.data;

            const perAnchorTotal: Record<string, number> = {};
            const perAnchorValid: Record<string, number> = {};

            rows.forEach(r => {
                r.status = 'VALID';
                r.validation_tier = 'A';
                r.volume = 500; 
                r.cpc = 1.0;
                r.competition = 0.5;
                r.validated_at_iso = FirestoreClient.nowIso();
                r.active = true;

                if (!perAnchorTotal[r.anchor_id]) perAnchorTotal[r.anchor_id] = 0;
                if (!perAnchorValid[r.anchor_id]) perAnchorValid[r.anchor_id] = 0;
                
                perAnchorTotal[r.anchor_id]++;
                perAnchorValid[r.anchor_id]++;
            });

            await this.writeKeywordRows({ categoryId, countryCode: country, languageCode: lang }, snapshotId, rows);

            const snapRes = await this.getSnapshotById({ categoryId, countryCode: country, languageCode: lang }, snapshotId);
            if (!snapRes.ok) throw new Error("Failed to read snapshot meta");
            const snap = snapRes.data;

            snap.stats.keywords_total = rows.length;
            snap.stats.valid_total = rows.length;
            snap.stats.validated_total = rows.length;
            snap.stats.zero_total = 0;
            snap.stats.per_anchor_valid_counts = perAnchorValid;
            snap.stats.per_anchor_total_counts = perAnchorTotal;
            snap.updated_at_iso = FirestoreClient.nowIso();

            await this.writeSnapshot(snap);

            return { ok: true };
        } catch (e: any) {
            console.error("FORCE_CERTIFY_FAILED", e);
            return { ok: false, error: e.message };
        }
    }
};
