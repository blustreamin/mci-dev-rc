
import { CorpusStore } from './corpusStore';
import { CORE_CATEGORIES } from '../constants';
import { CATEGORY_ANCHORS_V1 } from '../contracts/categoryAnchorsV1';

export interface CertificationReport {
    timestamp: string;
    total_rows: number;
    semantic_hash: string;
    categories: Record<string, {
        total: number;
        anchors: Record<string, {
            count: number;
            status: 'PASS' | 'FAIL';
            missing: number;
            languages: Record<string, number>;
        }>
    }>;
    status: 'PASS' | 'FAIL';
}

export const CorpusCertifier = {
    
    async runCertification(): Promise<CertificationReport> {
        const { rows } = await CorpusStore.loadSemantic();
        
        const report: CertificationReport = {
            timestamp: new Date().toISOString(),
            total_rows: rows.length,
            semantic_hash: await CorpusStore.computeSemanticHash(rows),
            categories: {},
            status: 'PASS'
        };

        const TARGET_PER_ANCHOR = 300;

        for (const cat of CORE_CATEGORIES) {
            report.categories[cat.id] = { total: 0, anchors: {} };
            const v1Def = CATEGORY_ANCHORS_V1[cat.id];
            const anchorNames = v1Def ? v1Def.anchors.map(a => a.name) : cat.anchors;

            for (const anchorName of anchorNames) {
                const anchorId = anchorName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                
                const anchorRows = rows.filter(r => r.category_id === cat.id && r.anchor_id === anchorId);
                const count = anchorRows.length;
                
                // Lang breakdown
                const langs: Record<string, number> = { en: 0, hi: 0, ta: 0, te: 0 };
                anchorRows.forEach(r => {
                    langs[r.language_code] = (langs[r.language_code] || 0) + 1;
                });

                const status = count >= TARGET_PER_ANCHOR ? 'PASS' : 'FAIL';
                if (status === 'FAIL') report.status = 'FAIL';

                report.categories[cat.id].anchors[anchorId] = {
                    count,
                    status,
                    missing: Math.max(0, TARGET_PER_ANCHOR - count),
                    languages: langs
                };
                
                report.categories[cat.id].total += count;
            }
        }

        return report;
    }
};
