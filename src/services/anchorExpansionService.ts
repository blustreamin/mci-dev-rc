
import { GoogleGenAI } from "@google/genai";
import { CategorySnapshotStore } from './categorySnapshotStore';
import { BootstrapService } from './bootstrapService';
import { DataForSeoClient } from './demand_vNext/dataforseoClient';
import { CredsStore } from './demand_vNext/credsStore';
import { CategoryKeywordGrowthService } from './categoryKeywordGrowthService';
import { SnapshotKeywordRow } from '../types';
import { normalizeKeywordString } from '../driftHash';
import { CategoryKeywordGuard } from './categoryKeywordGuard';
import { CORE_CATEGORIES } from '../constants';

const safeProcess = (typeof process !== 'undefined' && process && process.env) 
    ? process 
    : { env: {} as Record<string, string | undefined> };

function getAI() {
  const apiKey = safeProcess.env.API_KEY;
  if (!apiKey) throw new Error("API Key missing");
  return new GoogleGenAI({ apiKey });
}

// Deterministic Fallback for Rebuild Mode
function generateHeuristicAnchors(categoryId: string, categoryName: string) {
    const modifiers = [
        "Price & Offers", "Best & Top Rated", "Reviews & Ratings", "How to Use", 
        "Benefits & Features", "Side Effects", "For Sensitive Skin", "For Men", 
        "Online Buy", "Kits & Combos", "Brands", "Alternatives"
    ];
    
    return modifiers.map(mod => {
        const seedBase = [
            `${categoryName} ${mod}`,
            `best ${categoryName} ${mod}`,
            `${categoryName} ${mod} india`,
            `${categoryName} ${mod} price`,
            `${categoryName} ${mod} review`
        ];
        // Pad to 10 seeds
        const seeds = [...seedBase, ...seedBase.map(s => s + " online")];
        
        return {
            anchorName: `${mod}`,
            intentType: "Discovery",
            seedKeywords: seeds
        };
    });
}

export const AnchorExpansionService = {
    
    async expandToMinPassingAnchors(
        categoryId: string, 
        snapshotId: string, 
        opts: { jobId?: string, rebuildMode?: boolean } = {}
    ): Promise<{ ok: boolean; anchorsModified: number; keywordsAdded: number; }> {
        
        console.log(`[ANCHOR_EXPAND_V2.1] Starting density-safe expansion for ${categoryId} ${snapshotId} (Rebuild: ${!!opts.rebuildMode})`);
        const MIN_ANCHORS_PASSING = 12; // V2.1 Target
        const MIN_VALID_PER_ANCHOR = 20; // Gate A requirement
        
        // 1. Get Creds
        const creds = await CredsStore.get();
        if (!creds || !creds.login || !creds.password) {
            console.error("[ANCHOR_EXPAND] Missing DataForSEO credentials");
            // Non-blocking in rebuild mode (heuristic fallback downstream)
            if (opts.rebuildMode) return { ok: true, anchorsModified: 0, keywordsAdded: 0 };
            return { ok: false, anchorsModified: 0, keywordsAdded: 0 };
        }

        // 2. Load State
        const snapRes = await CategorySnapshotStore.getSnapshotById({ categoryId, countryCode: 'IN', languageCode: 'en' }, snapshotId);
        if (!snapRes.ok) return { ok: false, anchorsModified: 0, keywordsAdded: 0 };
        const snapshot = snapRes.data;

        let rowsRes = await CategorySnapshotStore.readAllKeywordRows({ categoryId, countryCode: 'IN', languageCode: 'en' }, snapshotId);
        let rows = rowsRes.ok ? rowsRes.data : [];

        // 3. Analyze Current State
        const getStats = (currentRows: SnapshotKeywordRow[]) => {
            const counts: Record<string, number> = {};
            snapshot.anchors.forEach(a => counts[a.anchor_id] = 0);
            currentRows.forEach(r => {
                if (r.active && (r.volume || 0) > 0) {
                    counts[r.anchor_id] = (counts[r.anchor_id] || 0) + 1;
                }
            });
            return counts;
        };

        let anchorCounts = getStats(rows);
        let passingAnchors = Object.keys(anchorCounts).filter(k => anchorCounts[k] >= MIN_VALID_PER_ANCHOR);

        // 4. Expansion Strategy
        let totalAdded = 0;
        let totalModified = 0;
        const existingNorms = new Set(rows.map(r => normalizeKeywordString(r.keyword_text)));
        const targets: string[] = [];
        const seedMap: Record<string, string[]> = {};

        // In Rebuild Mode, we skip the check for *passing* anchors (since we have 0 valid initially).
        // We just check if we have enough anchors defined at all.
        const shouldExpand = opts.rebuildMode 
            ? snapshot.anchors.length < 10 
            : passingAnchors.length < MIN_ANCHORS_PASSING;

        if (shouldExpand) {
            console.log(`[ANCHOR_EXPAND] Engaging GenAI for Expansion (Mode: ${opts.rebuildMode ? 'HEURISTIC_SAFE' : 'STRICT'})...`);
            
            const categoryName = CORE_CATEGORIES.find(c => c.id === categoryId)?.category || categoryId;
            let generatedAnchors: any[] = [];
            
            try {
                const ai = getAI();
                const prompt = `ANCHOR EXPANSION V2.1 (DENSITY SAFE)
You are running Anchor Expansion V2.1 for ${categoryName}.
Output 12 high-density anchors that can support >30 keywords each.
Output JSON: { "anchors": [{ "anchorName": "...", "intentType": "...", "seedKeywords": ["...min 15"] }] }`;

                const resp = await ai.models.generateContent({
                    model: 'gemini-3-pro-preview',
                    contents: prompt,
                    config: { responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 1024 } }
                });
                
                const data = JSON.parse(resp.text || "{}");
                if (data.anchors && Array.isArray(data.anchors)) {
                    generatedAnchors = data.anchors;
                }
            } catch (e) {
                console.warn("[ANCHOR_EXPAND] GenAI Failed, checking fallback...", e);
            }

            // Fallback Logic (Rebuild Only)
            if (opts.rebuildMode && (generatedAnchors.length < 10 || generatedAnchors.some(a => !a.seedKeywords || a.seedKeywords.length < 8))) {
                console.log("[ANCHOR_EXPAND] Using Deterministic Fallback Anchors");
                generatedAnchors = generateHeuristicAnchors(categoryId, categoryName);
            }

            // Apply Anchors
            generatedAnchors.forEach((a: any) => {
                if (!a.seedKeywords || a.seedKeywords.length < 8) return; // Skip weak

                const exists = snapshot.anchors.some(sa => sa.anchor_id === a.anchorName);
                if (!exists && !targets.includes(a.anchorName)) {
                    targets.push(a.anchorName);
                    snapshot.anchors.push({ anchor_id: a.anchorName, order: snapshot.anchors.length, source: 'EXPANSION_V2.1' });
                    seedMap[a.anchorName] = a.seedKeywords;
                }
            });
        }

        // 5. Execution Loop (Seed Injection)
        for (const anchorId of targets) {
            let seeds = seedMap[anchorId] || [];
            if (seeds.length === 0) continue;

            const rawCandidates = BootstrapService.generateCandidates(categoryId, anchorId, seeds);
            
            // Filter & Cap
            const candidates = rawCandidates.filter(k => {
                const norm = normalizeKeywordString(k);
                if (existingNorms.has(norm)) return false;
                const check = CategoryKeywordGuard.isSpecific(k, categoryId);
                return check.ok;
            }).slice(0, 150); 

            if (candidates.length === 0) continue;

            // Prepare Rows
            const newRows: SnapshotKeywordRow[] = candidates.map(k => ({
                keyword_id: `exp_v21_${Date.now()}_${Math.random().toString(36).substr(2,5)}`,
                keyword_text: k,
                language_code: 'en', country_code: 'IN', category_id: categoryId, anchor_id: anchorId,
                intent_bucket: BootstrapService.inferIntent(k),
                status: 'UNVERIFIED', active: true, created_at_iso: new Date().toISOString(), volume: 0
            }));

            // Validate Immediately (Batch)
            try {
                // Batch size 80 is fine for standard volume fetch
                const res = await DataForSeoClient.fetchVolumeStandard(creds as any, newRows.map(r => r.keyword_text), 2356, 'en');
                
                if (res.ok && res.parsedRows) {
                    let validInBatch = 0;
                    res.parsedRows.forEach(pr => {
                        const row = newRows.find(r => normalizeKeywordString(r.keyword_text) === normalizeKeywordString(pr.keyword));
                        if (row) {
                            row.volume = pr.search_volume || 0;
                            row.cpc = pr.cpc;
                            row.competition = pr.competition_index;
                            row.validated_at_iso = new Date().toISOString();
                            
                            if ((row.volume || 0) > 0) {
                                row.status = 'VALID';
                                validInBatch++;
                            } else {
                                row.status = 'ZERO';
                                // V2 Logic: Aggressively prune zero volume if not rebuild mode?
                                // In rebuild mode, we keep them active until final prune to allow amazon boost to see them
                                row.active = !opts.rebuildMode; 
                            }
                        }
                    });
                    
                    // Add to main collection
                    rows = [...rows, ...newRows];
                    newRows.forEach(r => existingNorms.add(normalizeKeywordString(r.keyword_text)));
                    
                    totalAdded += validInBatch;
                    totalModified++;
                }
            } catch (e) {
                console.error(`[ANCHOR_EXPAND] Validation failed for ${anchorId}`, e);
            }
            
            // Throttle
            await new Promise(r => setTimeout(r, 200));
        }

        // PATCH 2: Consolidation of Failing Anchors (SKIP IN REBUILD MODE to verify structure first)
        if (!opts.rebuildMode) {
            anchorCounts = getStats(rows);
            const finalPassing = Object.entries(anchorCounts).filter(([_, c]) => c >= MIN_VALID_PER_ANCHOR).map(e => e[0]);
            const finalFailing = Object.entries(anchorCounts).filter(([_, c]) => c > 0 && c < MIN_VALID_PER_ANCHOR).map(e => e[0]);

            if (finalPassing.length > 0 && finalFailing.length > 0) {
                 // Identify Strongest by Volume
                 const strongestAnchor = finalPassing.sort((a,b) => anchorCounts[b] - anchorCounts[a])[0];
                 let reassignedCount = 0;
                 rows.forEach(r => {
                     if (r.active && (r.volume || 0) > 0 && finalFailing.includes(r.anchor_id)) {
                         r.anchor_id = strongestAnchor;
                         reassignedCount++;
                     }
                 });
                 const failingSet = new Set(finalFailing);
                 snapshot.anchors = snapshot.anchors.filter(a => !failingSet.has(a.anchor_id));
                 console.log(`[ANCHOR_EXPAND] Reassigned ${reassignedCount} keywords to '${strongestAnchor}'`);
            }
        }

        // 6. Save Updates
        if (totalModified > 0 || targets.length > 0) {
            await CategorySnapshotStore.writeSnapshot(snapshot); // Save new anchors
            await CategorySnapshotStore.writeKeywordRows({ categoryId, countryCode: 'IN', languageCode: 'en' }, snapshotId, rows);
            await CategoryKeywordGrowthService.finalizeSnapshotStats(snapshot, rows);
        }

        // PATCH 3: Anchor Coverage Gate (SKIP IN REBUILD MODE)
        if (!opts.rebuildMode) {
             anchorCounts = getStats(rows);
             const passingCount = Object.values(anchorCounts).filter(c => c >= MIN_VALID_PER_ANCHOR).length;
             if (passingCount === 0) {
                  throw new Error(`Anchor Expansion Failed: No anchors met the minimum threshold of ${MIN_VALID_PER_ANCHOR} valid keywords.`);
             }
        } else {
             console.log(`[ANCHOR_EXPAND] Rebuild Mode: Bypassing strict coverage gates. Added ${totalAdded} valid keywords.`);
        }

        return { ok: true, anchorsModified: totalModified, keywordsAdded: totalAdded };
    }
};
