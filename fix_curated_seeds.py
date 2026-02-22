#!/usr/bin/env python3
"""
DEFINITIVE FIX: Use curated keywords + search_volume endpoint

The keywords_for_keywords endpoint DOES NOT WORK through the proxy.
The search_volume endpoint DOES WORK (that's how validation succeeds).

New strategy:
1. Use curated high-volume keywords as the PRIMARY source
2. Send them to search_volume endpoint for validation
3. Mark VALID/ZERO immediately
4. Skip the broken keywords_for_keywords entirely
"""
import os

# ============================================================
# STEP 1: Copy curated seeds into the project
# ============================================================
print("=== STEP 1: Creating curatedKeywordSeeds.ts ===")

curated = '''
export const CURATED_SEEDS: Record<string, string[]> = {

    'shaving': [
        "razor", "trimmer", "shaving cream", "shaving foam", "aftershave",
        "electric shaver", "safety razor", "razor blades",
        "gillette razor", "gillette mach3", "gillette fusion", "gillette guard",
        "gillette shaving cream", "philips trimmer", "philips shaver",
        "braun shaver", "panasonic trimmer", "bombay shaving company",
        "ustraa trimmer", "havells trimmer",
        "best razor for men", "best trimmer under 1000", "best trimmer under 2000",
        "best trimmer under 500", "best electric shaver india",
        "trimmer price", "razor price", "gillette razor price",
        "trimmer for men", "trimmer for beard",
        "trimmer vs razor", "manual razor vs electric",
        "how to shave", "razor burn treatment", "ingrown hair after shaving",
        "shaving for sensitive skin", "razor bumps on neck",
        "shaving kit for men", "double edge razor",
        "electric trimmer for men", "body trimmer for men",
        "nose trimmer", "manscaping trimmer", "pre shave oil",
        "shaving brush", "one blade philips"
    ],

    'beard': [
        "beard oil", "beard growth oil", "beard trimmer", "beard balm",
        "beard wash", "beard comb", "beard straightener", "beard wax",
        "beard color", "beard dye", "beard softener", "mustache wax",
        "beardo beard oil", "ustraa beard oil", "the man company beard oil",
        "bombay shaving company beard oil", "philips beard trimmer",
        "best beard oil", "best beard oil for growth", "best beard trimmer",
        "best beard trimmer under 1000", "beard oil price",
        "beard growth kit", "beard grooming kit",
        "how to grow beard faster", "how to grow beard naturally",
        "patchy beard solution", "beard growth tips",
        "beard dandruff treatment", "minoxidil for beard",
        "derma roller for beard", "beard growth serum",
        "beard styles for men", "short beard styles",
        "beard trimming tips", "beard oil benefits"
    ],

    'hair-styling': [
        "hair wax", "hair gel", "pomade", "hair cream for men", "hair spray for men",
        "hair clay", "hair mousse for men", "hair serum for men",
        "set wet hair gel", "set wet hair wax", "gatsby hair wax",
        "beardo hair wax", "ustraa hair wax", "park avenue hair gel",
        "schwarzkopf hair wax", "loreal hair gel",
        "best hair wax for men", "best hair gel for men",
        "hair wax price", "hair gel price", "best pomade india",
        "hair wax vs gel", "matte finish hair wax",
        "strong hold hair gel", "hair wax for short hair",
        "hairstyle for men", "hairstyle for round face men",
        "hairstyle for thin hair men", "how to style hair men",
        "hair gel side effects", "natural hair wax",
        "gatsby wax", "set wet wax", "hair styling products men",
        "hair paste for men", "texturizing spray men",
        "slick back hairstyle products", "volumizing hair powder men",
        "sea salt spray for men", "dry shampoo for men",
        "hair styling cream", "matte clay for men"
    ],

    'sexual-wellness': [
        "condom", "condoms", "durex condom", "manforce condom",
        "skore condom", "kamasutra condom", "dotted condom",
        "extra thin condom", "flavoured condom", "condom price",
        "lubricant", "lube", "water based lubricant", "durex lube",
        "delay spray", "stamina tablets", "shilajit",
        "ashwagandha for men", "testosterone booster",
        "bold care", "man matters",
        "best condom brand in india", "condom pack",
        "condom online", "condom size chart",
        "best delay spray", "condom types",
        "how to use condom", "condom effectiveness",
        "moods condom", "playgard condom",
        "intimate gel", "performance enhancer men",
        "sexual health supplements", "stamina booster",
        "long lasting spray", "climax delay"
    ],

    'intimate-hygiene': [
        "intimate wash for men", "intimate wash", "ball powder",
        "anti chafing cream", "intimate hygiene wash",
        "pee safe intimate wash", "man matters intimate wash",
        "the man company intimate wash", "svish intimate wash",
        "ustraa intimate wash",
        "jock itch treatment", "jock itch cream",
        "groin sweat solution", "anti fungal cream",
        "dark inner thighs", "intimate area whitening",
        "anti chafing powder", "prickly heat groin",
        "fungal infection treatment", "itching in private area male",
        "best intimate wash for men", "intimate wash price",
        "body powder for men", "sweat absorbing powder",
        "manscaping products", "below the belt grooming",
        "groin powder", "crotch care men", "mens hygiene products",
        "ball deodorant", "intimate area cream men",
        "anti bacterial wash men", "groin rash treatment"
    ],

    'hair-colour': [
        "hair colour for men", "hair color for men", "hair dye for men",
        "grey hair colour", "black hair dye", "brown hair colour men",
        "beard colour for men", "hair colour shampoo",
        "garnier hair colour men", "loreal hair colour men",
        "godrej expert hair colour", "indica hair colour",
        "just for men hair colour", "streax hair colour",
        "bigen hair colour", "schwarzkopf hair colour",
        "best hair colour for men", "hair colour price",
        "ammonia free hair colour", "natural hair dye",
        "semi permanent hair colour", "temporary hair colour",
        "how to colour hair at home men", "how to cover grey hair",
        "grey hair solution", "premature grey hair treatment",
        "white hair to black permanently", "henna for men hair"
    ],

    'face-care': [
        "face wash for men", "moisturizer for men", "sunscreen for men",
        "face cream for men", "face scrub for men", "face serum for men",
        "face mask for men", "anti acne cream",
        "nivea men face wash", "garnier men face wash",
        "ponds men face wash", "loreal men face wash",
        "cetaphil face wash", "minimalist sunscreen",
        "mamaearth face wash men", "beardo face wash",
        "best face wash for men", "best moisturizer for men",
        "best sunscreen for men", "best face cream for men",
        "face wash for oily skin men", "face wash for pimples men",
        "how to remove pimples", "how to remove dark spots",
        "oily skin care routine men", "dark circle cream for men",
        "tan removal for men", "acne treatment for men",
        "vitamin c serum for men", "niacinamide for men",
        "charcoal face wash men", "salicylic acid face wash men"
    ],

    'deodorants': [
        "deodorant", "body spray", "perfume for men", "deo for men",
        "roll on deodorant", "antiperspirant", "cologne",
        "axe deodorant", "fogg deodorant", "park avenue deodorant",
        "wild stone deodorant", "denver deodorant", "nivea deo men",
        "old spice deodorant", "engage deodorant", "set wet deo",
        "best deodorant for men", "long lasting deodorant for men",
        "best body spray for men", "deodorant price",
        "body odour solution", "excessive sweating remedy",
        "deodorant for gym", "natural deodorant men",
        "deodorant vs perfume difference",
        "pocket perfume for men", "no gas deodorant",
        "travel size deodorant", "deodorant gift set men",
        "brut deodorant", "yardley deodorant"
    ],

    'hair-oil': [
        "hair oil", "hair oil for men", "hair growth oil",
        "anti hair fall oil", "onion hair oil", "coconut hair oil",
        "almond hair oil", "castor oil for hair",
        "indulekha hair oil", "parachute hair oil", "kesh king oil",
        "bajaj almond drops", "navratna hair oil", "dabur amla hair oil",
        "wow hair oil", "biotique hair oil", "mamaearth onion hair oil",
        "best hair oil for men", "best oil for hair growth",
        "best hair oil for hair fall", "hair oil price",
        "non sticky hair oil", "lightweight hair oil men",
        "hair fall solution", "hair fall control",
        "dandruff treatment oil", "dry scalp treatment",
        "rosemary oil for hair growth", "bhringraj oil benefits",
        "minoxidil vs hair oil", "derma roller for hair"
    ],

    'fragrance-premium': [
        "perfume for men", "eau de parfum men", "eau de toilette men",
        "cologne for men", "luxury perfume men", "attar",
        "titan skinn perfume", "bellavita perfume", "villain perfume",
        "beardo perfume", "ustraa cologne", "wild stone edge",
        "davidoff perfume", "calvin klein perfume", "versace perfume men",
        "armaf perfume", "rasasi perfume", "ajmal perfume",
        "best perfume for men", "best perfume for men india",
        "best perfume under 500", "best perfume under 1000",
        "long lasting perfume men", "perfume gift set men",
        "office wear perfume men", "oud perfume men",
        "musk perfume men", "perfume vs deodorant",
        "edp vs edt", "lattafa perfume", "embark perfume"
    ],

    'skincare-spec': [
        "face serum", "vitamin c serum", "niacinamide serum",
        "retinol serum", "hyaluronic acid serum", "salicylic acid serum",
        "eye cream", "under eye cream", "anti aging cream",
        "minimalist serum", "derma co serum", "plum vitamin c serum",
        "wow serum", "mcaffeine face serum", "dot and key serum",
        "best serum for men", "best vitamin c serum india",
        "best niacinamide serum", "best retinol serum india",
        "best dark circle cream men",
        "skincare routine for men", "anti aging routine men",
        "dark spots treatment", "pigmentation treatment face",
        "how to use vitamin c serum", "how to use retinol",
        "serum for oily skin", "serum for acne",
        "korean skincare men", "glass skin routine men"
    ],

    'shampoo': [
        "shampoo", "shampoo for men", "anti dandruff shampoo",
        "hair fall shampoo", "conditioner for men",
        "head and shoulders shampoo", "dove shampoo men",
        "tresemme shampoo", "pantene shampoo", "wow shampoo",
        "mamaearth shampoo", "biotique shampoo", "nivea men shampoo",
        "loreal shampoo men", "clear shampoo men",
        "park avenue beer shampoo", "khadi shampoo",
        "best shampoo for men", "best shampoo for hair fall",
        "best anti dandruff shampoo", "shampoo price",
        "sulphate free shampoo", "paraben free shampoo",
        "dandruff treatment shampoo", "dry scalp shampoo",
        "ketoconazole shampoo", "onion shampoo for hair fall",
        "shampoo for colored hair", "charcoal shampoo men"
    ],

    'soap': [
        "soap", "body wash", "shower gel", "bathing soap",
        "body wash for men", "soap for men",
        "dove soap men", "nivea body wash men", "pears soap",
        "dettol soap", "lifebuoy soap", "fiama shower gel",
        "park avenue soap", "cinthol soap", "medimix soap",
        "wild stone soap", "old spice body wash",
        "best body wash for men", "best soap for men",
        "best shower gel for men", "body wash price",
        "soap for dry skin men", "moisturizing soap",
        "antibacterial soap", "body wash vs soap",
        "charcoal soap for men", "neem soap",
        "exfoliating body wash men", "glycerin soap"
    ],

    'body-lotion': [
        "body lotion", "body lotion for men", "body cream",
        "moisturizer for body", "body butter",
        "nivea body lotion men", "vaseline body lotion",
        "dove body lotion", "ponds body lotion",
        "wow body lotion", "biotique body lotion",
        "himalaya body lotion", "cocoa butter lotion",
        "boroplus cream", "parachute body lotion",
        "best body lotion for men", "best body lotion for dry skin",
        "best body lotion for winter", "body lotion price",
        "non greasy body lotion men", "dry skin treatment men",
        "winter skin care men", "body lotion for summer",
        "body lotion vs body cream", "spf body lotion",
        "aloe vera body lotion", "vitamin e body lotion"
    ],

    'talcum': [
        "talcum powder", "body powder", "prickly heat powder",
        "cooling powder", "dusting powder",
        "ponds powder", "yardley powder", "navratna powder",
        "dermicool powder", "nycil powder", "wild stone talc",
        "denver talc", "park avenue talc", "engage talc",
        "best talcum powder for men", "best prickly heat powder",
        "best cooling powder", "talc free body powder",
        "prickly heat treatment", "body odour powder",
        "sweat absorbing powder", "anti fungal powder",
        "chafing powder", "summer powder for men",
        "cooling powder for summer", "after shower powder",
        "medicated powder for men", "cinthol talc"
    ],

    'oral-care': [
        "toothpaste", "toothbrush", "mouthwash", "electric toothbrush",
        "teeth whitening", "tongue cleaner", "dental floss",
        "colgate toothpaste", "sensodyne toothpaste", "pepsodent toothpaste",
        "closeup toothpaste", "oral b toothbrush",
        "oral b electric toothbrush", "dabur red toothpaste",
        "patanjali toothpaste", "himalaya toothpaste",
        "listerine mouthwash", "colgate mouthwash",
        "best toothpaste", "best toothpaste for sensitive teeth",
        "best electric toothbrush india", "best mouthwash india",
        "toothpaste price", "charcoal toothpaste",
        "teeth whitening at home", "yellow teeth treatment",
        "bad breath solution", "sensitive teeth remedy",
        "fluoride toothpaste", "herbal toothpaste",
        "activated charcoal toothpaste", "gum disease treatment"
    ]
};

export function getCuratedSeeds(categoryId: string): string[] {
    return CURATED_SEEDS[categoryId] || [];
}
'''

with open('src/services/curatedKeywordSeeds.ts', 'w') as f:
    f.write(curated)
print("  OK: Created curatedKeywordSeeds.ts")

# ============================================================
# STEP 2: Rewrite growth service to use curated seeds + search_volume
# ============================================================
print("\n=== STEP 2: Rewrite growth discovery to use curated seeds ===")

with open('src/services/categoryKeywordGrowthService.ts', 'r') as f:
    content = f.read()

# Add import for curated seeds
if "curatedKeywordSeeds" not in content:
    content = content.replace(
        "import { BootstrapServiceV3 } from './bootstrapServiceV3';",
        "import { BootstrapServiceV3 } from './bootstrapServiceV3';\nimport { getCuratedSeeds } from './curatedKeywordSeeds';"
    )
    print("  OK: Added curatedKeywordSeeds import")

# Replace the entire DFS discovery section with curated seeds approach
# Find the discovery block and replace
old_block = """                // A1. PRIMARY: DFS Keywords-for-Keywords Discovery WITH VOLUMES
                // DFS returns keywords with real volumes - use them directly
                let dfsDiscoveredRows: any[] = [];
                try {
                    const discoverySeeds = BootstrapServiceV3.generateDiscoverySeeds(categoryId);
                    const seedsPerBatch = 15;
                    const offset = ((attempt - 1) * seedsPerBatch) % discoverySeeds.length;
                    const seedBatch = discoverySeeds.slice(offset, offset + seedsPerBatch);
                    
                    if (seedBatch.length > 0) {
                        console.log(`[GROW_UNIVERSAL][DFS_DISCOVER] Pass ${attempt}: ${seedBatch.length} seeds -> DFS`);
                        const discoveredWithVol = await DataForSeoClient.discoverKeywordsWithVolume({
                            keywords: seedBatch,
                            location: 2356,
                            language: 'en',
                            creds,
                            jobId
                        });
                        
                        // Filter through guard and dedupe - these already have volume > 0
                        for (const dfsRow of discoveredWithVol) {
                            const kw = dfsRow.keyword;
                            const norm = kw.toLowerCase().trim();
                            // Relaxed guard for DFS-discovered keywords:
                            // DFS already returned these as related to our seeds, so skip head-term check
                            // Only block: female terms, too short, year tokens
                            const tokens = norm.split(/\\s+/);
                            const FEMALE = new Set(["women","womens","woman","female","ladies","girl","girls","she","her","bridal","bride","maternity","pregnancy","lipstick","mascara","foundation","eyeliner","bra","panty","lingerie","sanitary","period","menstrual","vagina","vaginal"]);
                            const hasFemale = tokens.some(t => FEMALE.has(t));
                            const tooShort = norm.length < 3;
                            const hasYear = /\\b(2023|2024|2025|2026)\\b/.test(norm);
                            
                            if (!hasFemale && !tooShort && !hasYear && !existingSet.has(normalizeKeywordString(kw))) {
                                candidates.push(kw);
                                dfsDiscoveredRows.push(dfsRow);
                            }
                        }
                        console.log(`[GROW_UNIVERSAL][DFS_DISCOVER] total=${discoveredWithVol.length} passedGuard=${dfsDiscoveredRows.length}`);
                    }
                } catch (e: any) {
                    console.warn(`[GROW_UNIVERSAL][DFS_DISCOVER] Failed: ${e.message}`);
                }
                await sleep(300);"""

new_block = """                // A1. PRIMARY: Curated high-volume keywords
                // Send curated keywords directly to search_volume endpoint (WORKS through proxy)
                let dfsDiscoveredRows: any[] = [];
                const curatedKws = getCuratedSeeds(categoryId);
                const CURATED_BATCH = 40;
                const curatedOffset = ((attempt - 1) * CURATED_BATCH) % Math.max(curatedKws.length, 1);
                const curatedBatch = curatedKws.slice(curatedOffset, curatedOffset + CURATED_BATCH)
                    .filter(k => !existingSet.has(normalizeKeywordString(k)));
                
                if (curatedBatch.length > 0) {
                    console.log(`[GROW_UNIVERSAL][CURATED] Pass ${attempt}: ${curatedBatch.length} curated keywords`);
                    try {
                        const volRes = await DataForSeoClient.fetchGoogleVolumes_DFS({
                            keywords: curatedBatch,
                            location: 2356,
                            language: 'en',
                            creds,
                            useProxy: true,
                            jobId,
                            categoryId
                        });
                        
                        if (volRes.ok && volRes.parsedRows) {
                            for (const row of volRes.parsedRows) {
                                if ((row.search_volume || 0) > 0) {
                                    candidates.push(row.keyword);
                                    dfsDiscoveredRows.push(row);
                                }
                            }
                            console.log(`[GROW_UNIVERSAL][CURATED] returned=${volRes.parsedRows.length} valid=${dfsDiscoveredRows.length}`);
                        }
                    } catch (e: any) {
                        console.warn(`[GROW_UNIVERSAL][CURATED] Volume check failed: ${e.message}`);
                    }
                    await sleep(300);
                }"""

if old_block in content:
    content = content.replace(old_block, new_block)
    print("  OK: Replaced DFS discovery with curated seeds + search_volume")
else:
    print("  WARN: DFS discovery block not found exactly, trying alternate...")
    # Try without the relaxed guard version
    if "DFS Keywords-for-Keywords Discovery WITH VOLUMES" in content:
        # Find start and end markers
        start = content.index("// A1. PRIMARY: DFS Keywords-for-Keywords Discovery WITH VOLUMES")
        end = content.index("await sleep(300);", start) + len("await sleep(300);")
        old_section = content[start:end]
        new_section = """// A1. PRIMARY: Curated high-volume keywords
                // Send curated keywords directly to search_volume endpoint (WORKS through proxy)
                let dfsDiscoveredRows: any[] = [];
                const curatedKws = getCuratedSeeds(categoryId);
                const CURATED_BATCH = 40;
                const curatedOffset = ((attempt - 1) * CURATED_BATCH) % Math.max(curatedKws.length, 1);
                const curatedBatch = curatedKws.slice(curatedOffset, curatedOffset + CURATED_BATCH)
                    .filter(k => !existingSet.has(normalizeKeywordString(k)));
                
                if (curatedBatch.length > 0) {
                    console.log(`[GROW_UNIVERSAL][CURATED] Pass ${attempt}: ${curatedBatch.length} curated keywords`);
                    try {
                        const volRes = await DataForSeoClient.fetchGoogleVolumes_DFS({
                            keywords: curatedBatch,
                            location: 2356,
                            language: 'en',
                            creds,
                            useProxy: true,
                            jobId,
                            categoryId
                        });
                        
                        if (volRes.ok && volRes.parsedRows) {
                            for (const row of volRes.parsedRows) {
                                if ((row.search_volume || 0) > 0) {
                                    candidates.push(row.keyword);
                                    dfsDiscoveredRows.push(row);
                                }
                            }
                            console.log(`[GROW_UNIVERSAL][CURATED] returned=${volRes.parsedRows.length} valid=${dfsDiscoveredRows.length}`);
                        }
                    } catch (e: any) {
                        console.warn(`[GROW_UNIVERSAL][CURATED] Volume check failed: ${e.message}`);
                    }
                    await sleep(300);
                }"""
        content = content[:start] + new_section + content[end:]
        print("  OK: Replaced via index-based approach")
    else:
        print("  ERROR: Could not find discovery block")

with open('src/services/categoryKeywordGrowthService.ts', 'w') as f:
    f.write(content)

# ============================================================
# STEP 3: Also update diagnostics to use search_volume
# ============================================================
print("\n=== STEP 3: Update diagnostics to use search_volume ===")

diag_fix = '''
import { DataForSeoClient } from './demand_vNext/dataforseoClient';
import { CredsStore } from './demand_vNext/credsStore';
import { getCuratedSeeds } from './curatedKeywordSeeds';
import { CategoryKeywordGuard, HEAD_TERMS, BRAND_PACKS } from './categoryKeywordGuard';

export interface DiagRow {
    keyword: string;
    volume: number;
    cpc: number;
    competition: number;
    guardPass: boolean;
    guardReason: string;
}

export const KeywordDiagnosticsService = {

    async runDiagnostics(
        categoryId: string, 
        onLog: (msg: string) => void
    ): Promise<DiagRow[]> {
        const results: DiagRow[] = [];
        
        onLog(`[DIAG] Starting keyword diagnostics for: ${categoryId}`);
        
        const creds = await CredsStore.get();
        if (!creds || !creds.login) {
            onLog(`[DIAG][ERROR] No DFS credentials found`);
            return [];
        }
        onLog(`[DIAG] DFS credentials loaded`);

        // Use curated seeds — send directly to search_volume endpoint
        const seeds = getCuratedSeeds(categoryId);
        onLog(`[DIAG] Curated seeds for ${categoryId}: ${seeds.length} keywords`);
        
        if (seeds.length === 0) {
            onLog(`[DIAG][ERROR] No curated seeds for category ${categoryId}`);
            return [];
        }

        // Send in batches of 50 to search_volume (WORKS through proxy)
        const BATCH_SIZE = 50;
        let totalSent = 0;
        let totalWithVolume = 0;

        for (let i = 0; i < seeds.length; i += BATCH_SIZE) {
            const batch = seeds.slice(i, i + BATCH_SIZE);
            totalSent += batch.length;
            onLog(`[DIAG][BATCH ${Math.floor(i/BATCH_SIZE)+1}] Validating ${batch.length} keywords via search_volume...`);
            
            try {
                const res = await DataForSeoClient.fetchGoogleVolumes_DFS({
                    keywords: batch,
                    location: 2356,
                    language: 'en',
                    creds,
                    useProxy: true
                });
                
                if (res.ok && res.parsedRows) {
                    const withVol = res.parsedRows.filter(r => (r.search_volume || 0) > 0);
                    totalWithVolume += withVol.length;
                    onLog(`[DIAG][BATCH] Returned ${res.parsedRows.length} rows, ${withVol.length} with volume > 0`);
                    
                    for (const row of res.parsedRows) {
                        const guard = CategoryKeywordGuard.isSpecific(row.keyword, categoryId);
                        const vol = row.search_volume || 0;
                        results.push({
                            keyword: row.keyword,
                            volume: vol,
                            cpc: row.cpc || 0,
                            competition: row.competition_index || 0,
                            guardPass: guard.ok,
                            guardReason: guard.reason
                        });
                        
                        if (vol > 0) {
                            const icon = guard.ok ? '\\u2705' : '\\u274C';
                            onLog(`  ${icon} "${row.keyword}" vol=${vol} cpc=${row.cpc || 0} ${!guard.ok ? '[BLOCKED: ' + guard.reason + ']' : ''}`);
                        }
                    }
                } else {
                    onLog(`[DIAG][BATCH][ERROR] ${res.error}`);
                }
            } catch (e: any) {
                onLog(`[DIAG][BATCH][ERROR] ${e.message}`);
            }
            
            await new Promise(r => setTimeout(r, 1000));
        }

        onLog(`[DIAG] ====== SUMMARY ======`);
        onLog(`[DIAG] Total sent: ${totalSent}`);
        onLog(`[DIAG] With volume > 0: ${totalWithVolume}`);
        onLog(`[DIAG] Hit rate: ${totalSent > 0 ? Math.round(totalWithVolume/totalSent*100) : 0}%`);
        onLog(`[DIAG] HEAD_TERMS: ${(HEAD_TERMS[categoryId] || []).join(', ')}`);
        
        const blockedHighVol = results.filter(r => !r.guardPass && r.volume > 0).sort((a, b) => b.volume - a.volume);
        if (blockedHighVol.length > 0) {
            onLog(`[DIAG] ====== BLOCKED BY GUARD (have volume!) ======`);
            for (const r of blockedHighVol.slice(0, 20)) {
                onLog(`  \\u274C "${r.keyword}" vol=${r.volume} BLOCKED: ${r.guardReason}`);
            }
        }
        
        return results;
    }
};
'''

with open('src/services/keywordDiagnosticsService.ts', 'w') as f:
    f.write(diag_fix)
print("  OK: Updated diagnostics to use search_volume endpoint")

print("\\n=== ALL DONE ===")
print("Run: git add -A && git commit -m 'Curated seeds + search_volume endpoint (skip broken keywords_for_keywords)' && git push")
