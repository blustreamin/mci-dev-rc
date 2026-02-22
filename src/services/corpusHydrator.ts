
import { CorpusStore, CorpusRow } from './corpusStore';
import { StrategyPlanStore } from './strategyPlanStore';
import { AnchorScanner } from './anchorScanner';
import { BootstrapService, DemandClass } from './bootstrapService';
import { CorpusHydrationStore, AnchorHydrationStatus } from './corpusHydrationStore';
import { DataForSeoClient } from './demand_vNext/dataforseoClient';
import { CredsStore } from './demand_vNext/credsStore';

export const CorpusHydrator = {
    
    abortController: null as AbortController | null,

    async hydrateCategory(
        categoryId: string, 
        opts: { targetPerAnchor: number; validateWithDataForSeo?: boolean; }
    ): Promise<void> {
        
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        try {
            // 1. Setup
            let plan = StrategyPlanStore.getPlan(categoryId);
            let anchors = plan ? plan.anchors : [];
            
            if (!plan || anchors.length === 0) {
                anchors = AnchorScanner.scanAnchors(categoryId);
                StrategyPlanStore.setPlan(categoryId, {
                    version: "v1",
                    category_id: categoryId,
                    frozen_at_iso: new Date().toISOString(),
                    anchors
                });
            }

            await CorpusHydrationStore.startRun(categoryId, anchors.length, opts.targetPerAnchor);
            
            // Creds check
            const creds = await CredsStore.get();
            // Validate ONLY if requested AND creds exist
            const canValidate = opts.validateWithDataForSeo && creds && creds.login && creds.password;

            // 2. Iterate Anchors
            for (const anchorName of anchors) {
                if (signal.aborted) break;

                // A. Classification & Targets
                const seeds = BootstrapService.getSeedsForAnchor(categoryId, anchorName);
                if (seeds.length === 0) {
                    await CorpusHydrationStore.updateAnchorStatus(categoryId, anchorName, {
                        anchorName, demandClass: 'LONG', target: 0, generated: 0, valid: 0, minVolume: 0, status: 'SKIPPED', lastError: 'Abstract Anchor'
                    });
                    continue;
                }

                const dClass = BootstrapService.classifyAnchor(categoryId, anchorName, seeds);
                const { target, minVol } = BootstrapService.getTargets(dClass);

                // Initialize Anchor Status
                const anchorStatus: AnchorHydrationStatus = {
                    anchorName,
                    demandClass: dClass,
                    target: target,
                    generated: 0,
                    valid: 0,
                    minVolume: minVol,
                    status: 'PENDING'
                };
                await CorpusHydrationStore.updateAnchorStatus(categoryId, anchorName, anchorStatus);

                // B. Generation (Candidates)
                // Generate a large pool to filter down from
                const candidates = BootstrapService.generateCandidates(categoryId, anchorName);
                anchorStatus.generated = candidates.length;

                const finalRows: Omit<CorpusRow, 'keyword_id' | 'created_at_iso'>[] = [];

                if (canValidate && candidates.length > 0) {
                    const BATCH_SIZE = 50; 
                    const queue = [...candidates];
                    let validCount = 0;

                    // Process in batches until target reached or queue empty
                    while (validCount < target && queue.length > 0) {
                        if (signal.aborted) break;

                        const batch = queue.splice(0, BATCH_SIZE);
                        try {
                            const res = await DataForSeoClient.fetchLiveVolume(
                                creds as any, 
                                batch, 
                                2356, // India
                                signal
                            );

                            if (res.ok && res.parsedRows) {
                                for (const r of res.parsedRows) {
                                    const vol = r.search_volume || 0;
                                    const isGood = vol >= minVol;
                                    
                                    // STRICT MODE: Only accept if vol >= minVol
                                    if (isGood) {
                                        finalRows.push({
                                            keyword_text: r.keyword,
                                            language_code: 'en',
                                            category_id: categoryId,
                                            anchor_id: anchorName,
                                            intent_bucket: BootstrapService.inferIntent(r.keyword),
                                            source: 'HYDRATE',
                                            validation: {
                                                status: 'VALID',
                                                volume: vol,
                                                cpc: r.cpc,
                                                competition: r.competition,
                                                checked_at_iso: new Date().toISOString(),
                                                source: 'DATAFORSEO'
                                            }
                                        });
                                        validCount++;
                                    }
                                }
                            }
                        } catch (e) {
                            console.warn(`Validation batch failed for ${anchorName}`, e);
                        }
                        
                        // Update Progress Live
                        anchorStatus.valid = validCount;
                        await CorpusHydrationStore.updateAnchorStatus(categoryId, anchorName, anchorStatus);
                        await new Promise(r => setTimeout(r, 200)); // Rate limit
                    }
                } else {
                    // No Validation Mode: Heuristic Fill
                    // Just take the top N candidates
                    const heuristicRows = candidates.slice(0, target).map(k => ({
                        keyword_text: k,
                        language_code: 'en',
                        category_id: categoryId,
                        anchor_id: anchorName,
                        intent_bucket: BootstrapService.inferIntent(k),
                        source: 'HYDRATE' as const,
                        validation: { status: 'UNVERIFIED' as const }
                    }));
                    finalRows.push(...heuristicRows);
                    anchorStatus.valid = heuristicRows.length; // Count as valid for progress logic in offline mode
                }

                // C. Persist & Finalize Status
                if (finalRows.length > 0) {
                    await CorpusStore.appendCorpusRows(finalRows);
                }

                // Partial if validCount < target, but that's honest reporting.
                anchorStatus.status = anchorStatus.valid >= (target * 0.8) ? 'COMPLETE' : 'PARTIAL';
                await CorpusHydrationStore.updateAnchorStatus(categoryId, anchorName, anchorStatus);
            }

            if (signal.aborted) {
                await CorpusHydrationStore.finishRun(categoryId, 'PARTIAL', 'User Aborted');
            } else {
                await CorpusHydrationStore.finishRun(categoryId, 'COMPLETE');
            }

        } catch (e: any) {
            console.error("Hydration Failed", e);
            await CorpusHydrationStore.finishRun(categoryId, 'FAILED', e.message);
        } finally {
            this.abortController = null;
        }
    },

    stop() {
        if (this.abortController) {
            this.abortController.abort();
        }
    }
};
