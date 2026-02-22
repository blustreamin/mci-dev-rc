
import { DeepDiveV1, PlaybookInputV1, DeepDiveSectionsV1, DeepDiveSignalsV1 } from '../types';

export function buildPlaybookInputFromDeepDive(deepDive: DeepDiveV1): PlaybookInputV1 {
    const s = (deepDive.synthesis || {}) as DeepDiveSectionsV1;
    const sigs = (deepDive.signals || {}) as DeepDiveSignalsV1;

    // Helper to truncate long text
    const clean = (text: string | undefined, limit = 500) => 
        (text || "Information not available in this run").slice(0, limit);

    // Map Signals
    const mapSignals = (list: any[] = []) => list.slice(0, 5).map(item => ({
        title: item.title || item.quote || item.claim || "Signal",
        url: item.url || "#",
        whyRelevant: item.snippet || item.rationale || "Category-relevant signal",
        source: item.source || "web"
    }));

    return {
        categoryId: deepDive.categoryId,
        categoryName: deepDive.categoryName,
        consumerTruth: clean(s.consumerTruth),
        contentSummary: clean(s.contentSignalSummary),
        conversationSummary: clean(s.conversationSignalSummary),
        transactionSummary: clean(s.transactionSignalSummary),
        topSignals: {
            content: mapSignals(sigs.instagramSignals || sigs.youtubeSignals),
            conversation: mapSignals(sigs.conversationSignals || sigs.twitterSignals),
            transaction: mapSignals(sigs.transactionProof || sigs.flipkartSignals)
        },
        marketContext: {
            primaryTension: clean(s.primaryTension?.narrative || s.primaryTension?.detail),
            drivingDemandBullets: s.whatsDrivingDemand?.bullets || [],
            segments: s.marketShape?.segments?.map(seg => seg.name) || [],
            momentumLabel: s.momentum?.label || "Stable",
            opportunitySpaces: s.opportunityMap?.topDemandSpaces || [],
            personas: s.consumerSegmentation?.personas?.map(p => `${p.name} (${p.ageGroup})`) || []
        }
    };
}