
import { doc, setDoc } from 'firebase/firestore';
import { FirestoreClient } from './firestoreClient';
import { CategorySnapshotStore } from './categorySnapshotStore';
import { SnapshotResolver } from './snapshotResolver';
import { CORE_CATEGORIES } from '../constants';
import { CategorySnapshotDoc, SnapshotKeywordRow } from '../types';
import { CorpusValidity } from './corpusValidity';
import { computeCorpusCounts } from './corpusCounts';

export interface HealthReport {
    categoryId: string;
    snapshotId: string;
    lifecycle: string;
    computedAt: string;
    totals: {
        keywordsTotal: number;
        validTotal: number;
        zeroSvCount: number;
        zeroSvPct: number;
        totalSv: number;
        validSv: number;
        svWeightedValidPct: number;
    };
    distribution: {
        p50: number;
        p90: number;
    };
    concentration: {
        top10SvSharePct: number;
    };
    perAnchor: {
        anchorsWithZeroValid: number;
        perAnchorZeroSvPct: Record<string, number>;
    };
    healthScore: number;
    healthGrade: 'GREEN' | 'AMBER' | 'RED';
    recommendedAction: 'KEEP' | 'CLEANUP' | 'RECERTIFY' | 'INVESTIGATE';
    warnings: string[];
}

export const CorpusHealthService = {
    
    /**
     * Pure computation of health metrics from rows. 
     * Uses Canonical Corpus Counts.
     */
    computeSnapshotHealth(snapshot: CategorySnapshotDoc, rows: SnapshotKeywordRow[]): HealthReport {
        const categoryId = snapshot.category_id;
        const counts = computeCorpusCounts(rows);

        const keywordsTotal = counts.totalKeywords;
        const validTotal = counts.validKeywords;
        const zeroSvCount = counts.zeroVolumeKeywords;
        const zeroSvPct = keywordsTotal > 0 ? (zeroSvCount / keywordsTotal) * 100 : 0;
        const unverifiedCount = counts.unverifiedKeywords;

        // GUARD: Unverified Accumulation
        if (unverifiedCount > 0) {
            console.warn(`[CORPUS_WARN][UNVERIFIED_PRESENT] categoryId=${categoryId} snapshotId=${snapshot.snapshot_id} unverified=${unverifiedCount}`);
        }

        // Volume Stats (Still need raw iteration for sum)
        const totalSv = rows.reduce((sum, r) => sum + CorpusValidity.getGoogleVolume(r), 0);
        
        // Valid rows for distribution stats
        const validRows = rows.filter(r => CorpusValidity.isGoogleValidRow(r));
        const validSv = validRows.reduce((sum, r) => sum + CorpusValidity.getGoogleVolume(r), 0);
        const svWeightedValidPct = totalSv > 0 ? (validSv / totalSv) * 100 : 0;

        // Distribution (P50/P90)
        const validVolumes = validRows.map(r => CorpusValidity.getGoogleVolume(r)).sort((a, b) => a - b);
        const p50 = validVolumes.length > 0 ? validVolumes[Math.floor(validVolumes.length * 0.5)] : 0;
        const p90 = validVolumes.length > 0 ? validVolumes[Math.floor(validVolumes.length * 0.9)] : 0;

        // Concentration: top 10 keywords share
        const sortedRows = [...rows].sort((a, b) => CorpusValidity.getGoogleVolume(b) - CorpusValidity.getGoogleVolume(a));
        const top10Sv = sortedRows.slice(0, 10).reduce((sum, r) => sum + CorpusValidity.getGoogleVolume(r), 0);
        const top10SvSharePct = totalSv > 0 ? (top10Sv / totalSv) * 100 : 0;

        // Per Anchor Metrics
        const perAnchorZeroSvPct: Record<string, number> = {};
        let anchorsWithZeroValid = 0;
        
        const anchors = snapshot.anchors || [];
        anchors.forEach(anchor => {
            const anchorRows = rows.filter(r => r.anchor_id === anchor.anchor_id);
            const anchorValid = anchorRows.filter(r => CorpusValidity.isGoogleValidRow(r));
            const anchorZero = anchorRows.filter(r => CorpusValidity.isGoogleZeroRow(r));
            
            if (anchorValid.length === 0) anchorsWithZeroValid++;
            perAnchorZeroSvPct[anchor.anchor_id] = anchorRows.length > 0 ? (anchorZero.length / anchorRows.length) * 100 : 0;
        });

        // 4. Health Score Formula
        let score = 100;
        score -= Math.min(40, zeroSvPct * 0.6);
        score -= Math.min(25, anchorsWithZeroValid * 5);
        if (totalSv > 0) {
            score -= Math.min(25, (100 - svWeightedValidPct) * 0.25);
        }
        if (top10SvSharePct > 75) {
            score -= 10;
        }
        score = Math.max(0, Math.min(100, score));

        // 5. Grade & Action
        const healthGrade = score >= 80 ? 'GREEN' : score >= 60 ? 'AMBER' : 'RED';
        let recommendedAction: HealthReport['recommendedAction'] = 'KEEP';
        if (healthGrade === 'AMBER') recommendedAction = 'CLEANUP';
        if (healthGrade === 'RED') recommendedAction = 'CLEANUP + RECERTIFY' as any;

        const warnings: string[] = [];
        if (zeroSvPct > 20) warnings.push(`High zero-SV density: ${zeroSvPct.toFixed(1)}%`);
        if (anchorsWithZeroValid > 0) warnings.push(`${anchorsWithZeroValid} anchors have zero valid keywords`);
        if (top10SvSharePct > 75) warnings.push(`High volume concentration: Top 10 KW drive ${top10SvSharePct.toFixed(1)}% of volume`);
        if (unverifiedCount > 0) warnings.push(`Unverified Accumulation: ${unverifiedCount} pending rows.`);

        return {
            categoryId,
            snapshotId: snapshot.snapshot_id,
            lifecycle: snapshot.lifecycle,
            computedAt: new Date().toISOString(),
            totals: {
                keywordsTotal,
                validTotal,
                zeroSvCount,
                zeroSvPct: parseFloat(zeroSvPct.toFixed(2)),
                totalSv,
                validSv,
                svWeightedValidPct: parseFloat(svWeightedValidPct.toFixed(2))
            },
            distribution: { p50, p90 },
            concentration: { top10SvSharePct: parseFloat(top10SvSharePct.toFixed(2)) },
            perAnchor: { anchorsWithZeroValid, perAnchorZeroSvPct },
            healthScore: parseFloat(score.toFixed(1)),
            healthGrade,
            recommendedAction,
            warnings
        };
    },

    async evaluateCategoryHealth(categoryId: string, snapshotId?: string): Promise<HealthReport> {
        // 1. Resolve Snapshot
        const resolution = snapshotId 
            ? await CategorySnapshotStore.getSnapshotById({ categoryId, countryCode: 'IN', languageCode: 'en' }, snapshotId)
            : await SnapshotResolver.resolveActiveSnapshot(categoryId, 'IN', 'en');

        const snap: CategorySnapshotDoc | null = (resolution as any).snapshot || (resolution as any).data || null;
        
        if (!snap) {
            return this.createEmptyReport(categoryId, "NO_SNAPSHOT");
        }

        // 2. Load Rows
        const rowsRes = await CategorySnapshotStore.readAllKeywordRows({ categoryId, countryCode: 'IN', languageCode: 'en' }, snap.snapshot_id);
        const rows = rowsRes.ok ? rowsRes.data : [];

        // 3. Compute (Reusable)
        const report = this.computeSnapshotHealth(snap, rows);

        // 4. Persist Report
        const db = FirestoreClient.getDbSafe();
        if (db) {
            await setDoc(doc(db, 'corpus_health_reports', categoryId), FirestoreClient.sanitize(report));
        }

        return report;
    },

    async evaluateAllHealth(): Promise<Record<string, HealthReport>> {
        const results: Record<string, HealthReport> = {};
        for (const cat of CORE_CATEGORIES) {
            results[cat.id] = await this.evaluateCategoryHealth(cat.id);
        }
        return results;
    },

    createEmptyReport(categoryId: string, lifecycle: string): HealthReport {
        return {
            categoryId,
            snapshotId: "NONE",
            lifecycle,
            computedAt: new Date().toISOString(),
            totals: { keywordsTotal: 0, validTotal: 0, zeroSvCount: 0, zeroSvPct: 0, totalSv: 0, validSv: 0, svWeightedValidPct: 0 },
            distribution: { p50: 0, p90: 0 },
            concentration: { top10SvSharePct: 0 },
            perAnchor: { anchorsWithZeroValid: 0, perAnchorZeroSvPct: {} },
            healthScore: 0,
            healthGrade: 'RED',
            recommendedAction: 'INVESTIGATE',
            warnings: ["No snapshot available for evaluation"]
        };
    }
};
