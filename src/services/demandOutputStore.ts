
import { doc, getDoc, setDoc, getFirestore } from 'firebase/firestore';
import { FirestoreClient } from './firestoreClient';
import { OutputSnapshotDoc, SweepResult } from '../types';

export const DEMAND_OUTPUT_VERSION = "ABS_V3_ELIG_V1";

export interface DemandDoc {
    docId: string;
    categoryId: string;
    month: string;
    country: string;
    language: string;
    corpusSnapshotId: string;
    corpusFingerprint?: string;
    computedAt: string;
    metricsVersion: string;
    version: string;
    demand_index_mn: number;
    metric_scores: { readiness: number; spread: number };
    trend_5y: any;
    totalKeywordsInput: number;
    totalKeywordsUsedInMetrics: number;
    eligibleCount: number;
    result?: any;
    [key: string]: any;
}

export const DemandOutputStore = {
    buildDocId(categoryId: string, month: string): string {
        return `out_${categoryId}_${month}`;
    },

    validateDemandDoc(data: any, runtimeTargetVersion: string): boolean {
        if (!data) return false;
        
        // Version Check
        if ((data.metricsVersion !== runtimeTargetVersion) && (data.version !== runtimeTargetVersion)) {
            return false;
        }

        // Root Keys Check
        const required = [
            'demand_index_mn', 
            'metric_scores', 
            'trend_5y', 
            'totalKeywordsInput', 
            'totalKeywordsUsedInMetrics', 
            'computedAt'
        ];

        for (const key of required) {
            if (data[key] === undefined) return false;
        }

        return true;
    },

    async readDemandDoc(params: {
        country: string; 
        language: string; 
        categoryId: string; 
        month: string; 
        runtimeTargetVersion: string;
    }): Promise<{ ok: boolean; data?: DemandDoc; reason?: string }> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return { ok: false, reason: "DB_INIT_FAIL" };

        const docId = this.buildDocId(params.categoryId, params.month);
        const path = `mci_outputs/${params.country}/${params.language}/${docId}`;
        
        console.log(`[DEMAND_OUTPUT][READ_START] doc=${docId}`);

        try {
            const snap = await getDoc(doc(db, path));
            
            if (!snap.exists()) {
                console.log(`[DEMAND_OUTPUT][READ_MISS] doc=${docId} reason=NOT_FOUND`);
                return { ok: false, reason: "NOT_FOUND" };
            }

            const data = snap.data();
            
            // Version Check
            const foundVersion = data.metricsVersion || data.version;
            if (!this.validateDemandDoc(data, params.runtimeTargetVersion)) {
                console.log(`[DEMAND_OUTPUT][READ_MISS] doc=${docId} reason=VERSION_MISMATCH found=${foundVersion} expected=${params.runtimeTargetVersion}`);
                return { ok: false, reason: "VERSION_MISMATCH" };
            }

            console.log(`[DEMAND_OUTPUT][READ_OK] doc=${docId} version=${foundVersion} demand_index_mn=${data.demand_index_mn}`);
            return { ok: true, data: data as DemandDoc };

        } catch (e: any) {
            console.error(`[DEMAND_OUTPUT] Read Error: ${e.message}`);
            return { ok: false, reason: e.message };
        }
    },

    async writeDemandDoc(params: {
        country: string;
        language: string;
        categoryId: string;
        month: string;
        payload: DemandDoc;
        runtimeTargetVersion: string;
    }): Promise<DemandDoc> {
        const db = FirestoreClient.getDbSafe();
        if (!db) throw new Error("DB_INIT_FAIL");

        const docId = this.buildDocId(params.categoryId, params.month);
        const path = `mci_outputs/${params.country}/${params.language}/${docId}`;
        
        console.log(`[DEMAND_OUTPUT][WRITE_START] doc=${docId}`);

        // 1. Write
        await setDoc(doc(db, path), params.payload);

        // 2. Read-Back Verification (Fail Fast)
        const snap = await getDoc(doc(db, path));
        if (!snap.exists()) {
             throw new Error("POST_WRITE_READ_FAILED: Document not found after write.");
        }
        
        const savedData = snap.data();
        if (!this.validateDemandDoc(savedData, params.runtimeTargetVersion)) {
             throw new Error("POST_WRITE_READ_FAILED: Validation failed on read-back.");
        }

        console.log(`[DEMAND_OUTPUT][WRITE_OK] doc=${docId} version=${savedData.metricsVersion} demand_index_mn=${savedData.demand_index_mn}`);
        
        return savedData as DemandDoc;
    },

    async createOutputSnapshot(
        categorySnapshotId: string,
        categoryId: string,
        countryCode: string,
        languageCode: string,
        month: string,
        strategy?: any,
        demand?: SweepResult | null,
        metricsVersion?: string,
        corpusFingerprint?: string
    ) {
        // Fallback target month if not provided
        const targetMonth = month || (demand as any)?.trend_5y?.windowId || new Date().toISOString().substring(0, 7);
        const docId = this.buildDocId(categoryId, targetMonth);
        const now = new Date().toISOString();

        // ROOT FIELDS PROMOTION (Single Source of Truth)
        const rootMetrics = {
            demand_index_mn: demand?.demand_index_mn ?? 0,
            metric_scores: demand?.metric_scores ?? { readiness: 0, spread: 0 },
            trend_5y: demand?.trend_5y ?? null,
            totalKeywordsInput: demand?.totalKeywordsInput ?? 0,
            totalKeywordsUsedInMetrics: demand?.totalKeywordsUsedInMetrics ?? 0,
            
            // Versioning
            metricsVersion: metricsVersion || (demand?.metricsVersion) || "UNKNOWN",
            version: metricsVersion || (demand?.metricsVersion) || "UNKNOWN", // Alias
            
            computedAt: now,
            category_id: categoryId,
            month: targetMonth,
            country_code: countryCode,
            language_code: languageCode,
            corpusSnapshotId: categorySnapshotId,
            corpusFingerprint: corpusFingerprint || null,
            
            snapshot_id: docId,
            created_at_iso: now,
            updated_at_iso: now,
            lifecycle: 'CERTIFIED', 
        };

        const payload: any = {
            ...rootMetrics,
            strategy: strategy || {},
            demand: demand || null, // Keep full nested payload
            integrity: { sha256: 'derived_v1' }
        };

        const res = await this.writeDeterministic({
            country: countryCode,
            language: languageCode,
            docId,
            payload
        });

        return { ...res, data: payload };
    },

    async writeDeterministic(params: {
        country: string;
        language: string;
        docId: string;
        payload: any;
    }): Promise<{ ok: boolean; error?: string }> {
        try {
            const db = getFirestore();
            const ref = doc(db, "mci_outputs", params.country, params.language, params.docId);
            await setDoc(ref, params.payload, { merge: true });
            return { ok: true };
        } catch (e: any) {
            console.error("[OUTPUT_STORE][WRITE_FAIL]", e);
            return { ok: false, error: e.message };
        }
    },

    async debugDumpDemandDoc(categoryId: string, month: string, country = "IN", language = "en") {
        const res = await this.readDemandDoc({ categoryId, month, country, language, runtimeTargetVersion: DEMAND_OUTPUT_VERSION });
        console.log(`[DUMP] ${categoryId}/${month}`, res);
        return res;
    }
};
