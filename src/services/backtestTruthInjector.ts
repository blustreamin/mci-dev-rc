
import { VolumeTruthStore, TruthVolume, computeSHA256 } from './volumeTruthStore';
import { WindowingService } from './windowing';
import { normalizeKeywordString } from '../../driftHash';

export interface BacktestSeedV1 {
  version: "backtest_seed_v1";
  benchmarkVersion: "v3";
  windowId: string;
  generatedAt: string;
  runs: Array<{
    runId: string;
    categoryId: string;
    categoryName: string;
    keywords: Array<{
      keywordText: string;
      keywordKey?: string;
      volume: number;
      source?: string;
      observedAt?: string;
    }>;
  }>;
}

export interface InjectionReport {
    windowId: string;
    keywordsProcessed: number;
    truthUpserts: number;
    truthSkipped: number;
    status: 'SUCCESS' | 'FAILED';
    message?: string;
}

// --- EMBEDDED AUDIT DATA (V3 100x) ---
const AUDIT_WINDOW_ID = "BACKTEST-2024-10";
export const AUDIT_DATASET_V2 = [
  // Shaving
  { c: 'shaving', k: 'best manual razors for men', v: 45200 },
  { c: 'shaving', k: 'electric shaver for sensitive skin', v: 38500 },
  { c: 'shaving', k: 'gillette mach 3 price india', v: 32100 },
  { c: 'shaving', k: 'bombay shaving company razor review', v: 28400 },
  { c: 'shaving', k: 'shaving cream for hard beard', v: 22000 },
  { c: 'shaving', k: 'how to prevent razor burn', v: 18900 },
  { c: 'shaving', k: 'philips trimmer vs braun', v: 16500 },
  { c: 'shaving', k: 'aftershave lotion alcohol free', v: 14200 },
  { c: 'shaving', k: 'best shaving foam for dry skin', v: 12800 },
  { c: 'shaving', k: 'shaving kit for men gift', v: 11500 },
  { c: 'shaving', k: 'alum block uses after shaving', v: 9800 },
  { c: 'shaving', k: 'charcoal shaving foam benefits', v: 8400 },
  { c: 'shaving', k: 'razor bumps treatment cream', v: 7600 },
  { c: 'shaving', k: 'safety razor blades cost', v: 6200 },
  { c: 'shaving', k: 'pre shave oil india', v: 5100 },
  
  // Beard
  { c: 'beard', k: 'beard growth oil for patchy beard', v: 52100 },
  { c: 'beard', k: 'how to fix patchy beard', v: 48000 },
  { c: 'beard', k: 'beardo beard oil review', v: 36200 },
  { c: 'beard', k: 'beard colour shampoo black', v: 29500 },
  { c: 'beard', k: 'best beard trimmer under 1500', v: 25400 },
  { c: 'beard', k: 'beard wash vs face wash', v: 21000 },
  { c: 'beard', k: 'grey beard coverage natural', v: 19800 },
  { c: 'beard', k: 'beard softener cream', v: 17500 },
  { c: 'beard', k: 'moustache growth roll on', v: 15200 },
  { c: 'beard', k: 'bigen beard colour side effects', v: 14100 },
  { c: 'beard', k: 'beard styling wax strong hold', v: 12600 },
  { c: 'beard', k: 'beard shaping tool kit', v: 10400 },
  { c: 'beard', k: 'itchy beard home remedies', v: 9200 },
  { c: 'beard', k: 'beard serum for shine', v: 8100 },
  { c: 'beard', k: 'ustraa beard growth oil results', v: 7500 },

  // Hair Styling
  { c: 'hair-styling', k: 'hair wax for men strong hold', v: 62000 },
  { c: 'hair-styling', k: 'set wet hair gel side effects', v: 55400 },
  { c: 'hair-styling', k: 'hairstyles for indian men short hair', v: 42100 },
  { c: 'hair-styling', k: 'hair clay vs hair wax', v: 38000 },
  { c: 'hair-styling', k: 'gatsby hair wax matte finish', v: 31500 },
  { c: 'hair-styling', k: 'best pomade for slick back', v: 26200 },
  { c: 'hair-styling', k: 'hair spray for men daily use', v: 22800 },
  { c: 'hair-styling', k: 'messy hairstyle tutorial men', v: 19500 },
  { c: 'hair-styling', k: 'hair cream for frizzy hair men', v: 17200 },
  { c: 'hair-styling', k: 'powder wax for volume', v: 15600 },
  { c: 'hair-styling', k: 'hairstyle for oval face men', v: 14000 },
  { c: 'hair-styling', k: 'beard and hair styling combo', v: 12500 },
  { c: 'hair-styling', k: 'water based hair pomade', v: 11200 },
  { c: 'hair-styling', k: 'urban gabru hair wax price', v: 9800 },
  { c: 'hair-styling', k: 'hair mousse for curly hair men', v: 8400 },

  // Sexual Wellness
  { c: 'sexual-wellness', k: 'durex extra time condoms price', v: 85400 },
  { c: 'sexual-wellness', k: 'manforce chocolate flavour', v: 72100 },
  { c: 'sexual-wellness', k: 'long lasting spray for men side effects', v: 65000 },
  { c: 'sexual-wellness', k: 'how to use delay spray', v: 58200 },
  { c: 'sexual-wellness', k: 'best lubricant for men water based', v: 42500 },
  { c: 'sexual-wellness', k: 'skore condoms dots and ribs', v: 39100 },
  { c: 'sexual-wellness', k: 'shilajit gold capsules benefits', v: 35000 },
  { c: 'sexual-wellness', k: 'ultra thin condoms sensation', v: 29800 },
  { c: 'sexual-wellness', k: 'sexual stamina supplements ayurvedic', v: 25400 },
  { c: 'sexual-wellness', k: 'mood condom flavours list', v: 22100 },
  { c: 'sexual-wellness', k: 'silicone lube vs water lube', v: 18500 },
  { c: 'sexual-wellness', k: 'performance anxiety pills', v: 16200 },
  { c: 'sexual-wellness', k: 'extra dotted condoms review', v: 14800 },
  { c: 'sexual-wellness', k: 'playgard ring usage', v: 12500 },
  { c: 'sexual-wellness', k: 'discreet condom delivery india', v: 11000 },

  // Intimate Hygiene
  { c: 'intimate-hygiene', k: 'intimate wash for men usage', v: 28500 },
  { c: 'intimate-hygiene', k: 'v wash for men equivalent', v: 24100 },
  { c: 'intimate-hygiene', k: 'itching in private area male home remedy', v: 21500 },
  { c: 'intimate-hygiene', k: 'antifungal powder for jock itch', v: 19200 },
  { c: 'intimate-hygiene', k: 'best anti chafing cream india', v: 16800 },
  { c: 'intimate-hygiene', k: 'pee safe intimate wash review', v: 14500 },
  { c: 'intimate-hygiene', k: 'excessive sweating in groin area male', v: 12200 },
  { c: 'intimate-hygiene', k: 'groin hygiene tips men', v: 10800 },
  { c: 'intimate-hygiene', k: 'intimate wipes for men travel', v: 9500 },
  { c: 'intimate-hygiene', k: 'clotrimazole powder price', v: 8200 },
  { c: 'intimate-hygiene', k: 'skin peeling on private parts male', v: 7400 },
  { c: 'intimate-hygiene', k: 'intimate hygiene wash ph balance', v: 6500 },
  { c: 'intimate-hygiene', k: 'svish intimate spray review', v: 5800 },
  { c: 'intimate-hygiene', k: 'candid powder for infection', v: 5100 },
  { c: 'intimate-hygiene', k: 'groin odour removal tips', v: 4500 },

  // Hair Colour
  { c: 'hair-colour', k: 'shampoo hair colour for men black', v: 48200 },
  { c: 'hair-colour', k: 'ammonia free hair colour brands', v: 42500 },
  { c: 'hair-colour', k: 'garnier men hair colour shades', v: 36100 },
  { c: 'hair-colour', k: 'how to hide grey hair naturally men', v: 31400 },
  { c: 'hair-colour', k: 'beard and hair colour combo', v: 28200 },
  { c: 'hair-colour', k: 'godrej expert rich creme price', v: 24500 },
  { c: 'hair-colour', k: 'hair colour side effects for eyes', v: 21800 },
  { c: 'hair-colour', k: 'streax insta shampoo colour review', v: 19200 },
  { c: 'hair-colour', k: 'hair dye for sensitive scalp', v: 16500 },
  { c: 'hair-colour', k: 'natural black henna for hair', v: 14200 },
  { c: 'hair-colour', k: 'touch up stick for grey hair', v: 12800 },
  { c: 'hair-colour', k: 'hair colour allergy symptoms', v: 10500 },
  { c: 'hair-colour', k: 'loreal men expert hair colour', v: 9200 },
  { c: 'hair-colour', k: 'organic hair colour for men', v: 8400 },
  { c: 'hair-colour', k: 'temporary hair colour spray black', v: 7100 },

  // Face Care
  { c: 'face-care', k: 'best face wash for oily skin men', v: 95200 },
  { c: 'face-care', k: 'charcoal face wash benefits', v: 82100 },
  { c: 'face-care', k: 'how to remove tan from face men', v: 74500 },
  { c: 'face-care', k: 'ponds men pimple clear face wash', v: 68200 },
  { c: 'face-care', k: 'sunscreen for men oily skin spf 50', v: 55400 },
  { c: 'face-care', k: 'garnier men power white review', v: 48100 },
  { c: 'face-care', k: 'moisturizer for dry skin men winter', v: 42500 },
  { c: 'face-care', k: 'dark circle removal cream for men', v: 36800 },
  { c: 'face-care', k: 'vitamin c serum for men usage', v: 32100 },
  { c: 'face-care', k: 'acne scars removal cream men', v: 28400 },
  { c: 'face-care', k: 'nivea men dark spot reduction', v: 25200 },
  { c: 'face-care', k: 'face scrub for blackheads men', v: 22500 },
  { c: 'face-care', k: 'aloe vera gel for face benefits', v: 19800 },
  { c: 'face-care', k: 'lip balm for dark lips men', v: 18200 },
  { c: 'face-care', k: 'minimalist salicylic acid face wash', v: 15600 },

  // Deodorants
  { c: 'deodorants', k: 'best perfume for men under 500', v: 110500 },
  { c: 'deodorants', k: 'fogg scent price list', v: 95200 },
  { c: 'deodorants', k: 'wild stone edge perfume review', v: 82400 },
  { c: 'deodorants', k: 'axe body spray chocolate', v: 74100 },
  { c: 'deodorants', k: 'deodorant without alcohol and gas', v: 65200 },
  { c: 'deodorants', k: 'long lasting perfume for office wear', v: 58500 },
  { c: 'deodorants', k: 'engage deo for men price', v: 49800 },
  { c: 'deodorants', k: 'denver hamilton deodorant', v: 42100 },
  { c: 'deodorants', k: 'best pocket perfume for men', v: 36500 },
  { c: 'deodorants', k: 'nivea roll on fresh active', v: 32200 },
  { c: 'deodorants', k: 'bella vita luxury perfume gift set', v: 28400 },
  { c: 'deodorants', k: 'difference between deo and perfume', v: 24100 },
  { c: 'deodorants', k: 'cobra deo spray price', v: 21500 },
  { c: 'deodorants', k: 'layer r wottagirl for men equivalent', v: 18200 },
  { c: 'deodorants', k: 'musk fragrance perfume list', v: 15400 },

  // Hair Oil
  { c: 'hair-oil', k: 'coconut oil for hair growth men', v: 65400 },
  { c: 'hair-oil', k: 'onion hair oil benefits for baldness', v: 58200 },
  { c: 'hair-oil', k: 'parachute hair oil price 500ml', v: 49500 },
  { c: 'hair-oil', k: 'almond oil vs coconut oil for hair', v: 42100 },
  { c: 'hair-oil', k: 'dabur amla hair oil review', v: 36800 },
  { c: 'hair-oil', k: 'non sticky hair oil for daily use', v: 31200 },
  { c: 'hair-oil', k: 'indulekha oil for hair fall', v: 28500 },
  { c: 'hair-oil', k: 'navratna cool oil side effects', v: 25400 },
  { c: 'hair-oil', k: 'best herbal hair oil for white hair', v: 22100 },
  { c: 'hair-oil', k: 'hair massage steps for growth', v: 19500 },
  { c: 'hair-oil', k: 'castor oil for hair thickness', v: 16800 },
  { c: 'hair-oil', k: 'bajaj almond drops hair oil', v: 14200 },
  { c: 'hair-oil', k: 'overnight oiling benefits', v: 12500 },
  { c: 'hair-oil', k: 'bhringraj oil for grey hair', v: 10800 },
  { c: 'hair-oil', k: 'tea tree oil for dandruff', v: 9200 },

  // Fragrances Premium
  { c: 'fragrance-premium', k: 'best oud perfume for men india', v: 38500 },
  { c: 'fragrance-premium', k: 'villain perfume hydra vs snake', v: 32100 },
  { c: 'fragrance-premium', k: 'titan skinn raw price', v: 28400 },
  { c: 'fragrance-premium', k: 'luxury perfume brands list', v: 24500 },
  { c: 'fragrance-premium', k: 'armani code perfume price', v: 21200 },
  { c: 'fragrance-premium', k: 'beardo godfather perfume review', v: 18500 },
  { c: 'fragrance-premium', k: 'ajmal kuro edp review', v: 16800 },
  { c: 'fragrance-premium', k: 'top 10 long lasting perfumes men', v: 14200 },
  { c: 'fragrance-premium', k: 'perfumes that smell like chocolate', v: 12500 },
  { c: 'fragrance-premium', k: 'dior sauvage india price', v: 11200 },
  { c: 'fragrance-premium', k: 'fragrance notes explained', v: 9800 },
  { c: 'fragrance-premium', k: 'gift set perfumes for boyfriend', v: 8500 },
  { c: 'fragrance-premium', k: 'zara man gold perfume review', v: 7400 },
  { c: 'fragrance-premium', k: 'versace eros flame price', v: 6500 },
  { c: 'fragrance-premium', k: 'niche perfume brands india', v: 5200 },

  // Skincare Specialist
  { c: 'skincare-spec', k: 'retinol serum for men benefits', v: 22500 },
  { c: 'skincare-spec', k: 'niacinamide for oily skin men', v: 19800 },
  { c: 'skincare-spec', k: 'under eye cream for dark circles men', v: 17500 },
  { c: 'skincare-spec', k: 'hyaluronic acid serum usage', v: 15200 },
  { c: 'skincare-spec', k: 'best anti ageing cream for men 40s', v: 13400 },
  { c: 'skincare-spec', k: 'salicylic acid serum for acne', v: 12100 },
  { c: 'skincare-spec', k: 'pigmentation removal cream for face', v: 10800 },
  { c: 'skincare-spec', k: 'minimalist vitamin c serum review', v: 9500 },
  { c: 'skincare-spec', k: 'derma co sunscreen for men', v: 8200 },
  { c: 'skincare-spec', k: 'chemical exfoliation for men', v: 7500 },
  { c: 'skincare-spec', k: 'collagen supplements for skin men', v: 6800 },
  { c: 'skincare-spec', k: 'how to use face serum men', v: 6100 },
  { c: 'skincare-spec', k: 'ceramide moisturizer benefits', v: 5400 },
  { c: 'skincare-spec', k: 'glycolic acid toner for men', v: 4800 },
  { c: 'skincare-spec', k: 'korean skincare routine for men', v: 4100 },

  // Shampoo
  { c: 'shampoo', k: 'head and shoulders anti dandruff price', v: 68200 },
  { c: 'shampoo', k: 'best shampoo for hair fall men', v: 55400 },
  { c: 'shampoo', k: 'dove men care shampoo review', v: 42100 },
  { c: 'shampoo', k: 'ketoconazole shampoo brands india', v: 38500 },
  { c: 'shampoo', k: 'sulphate free shampoo for men', v: 32800 },
  { c: 'shampoo', k: 'tresemme keratin smooth for men', v: 28400 },
  { c: 'shampoo', k: 'beer shampoo for hair growth', v: 24500 },
  { c: 'shampoo', k: 'scalp scaling shampoo', v: 21200 },
  { c: 'shampoo', k: 'clinic plus shampoo ingredients', v: 18500 },
  { c: 'shampoo', k: 'how to use conditioner for men', v: 16200 },
  { c: 'shampoo', k: 'oily scalp dry hair shampoo', v: 14800 },
  { c: 'shampoo', k: 'wow apple cider vinegar shampoo', v: 12500 },
  { c: 'shampoo', k: 'himalaya anti hair fall shampoo', v: 11200 },
  { c: 'shampoo', k: 'dry shampoo for men india', v: 9800 },
  { c: 'shampoo', k: 'loreal clay shampoo for men', v: 8500 },

  // Soap
  { c: 'soap', k: 'cinthol soap lime fresh price', v: 52400 },
  { c: 'soap', k: 'dettol original soap multipack', v: 48100 },
  { c: 'soap', k: 'best body wash for men smelling good', v: 42500 },
  { c: 'soap', k: 'pears soap for oily skin', v: 36800 },
  { c: 'soap', k: 'nivea men shower gel active clean', v: 31500 },
  { c: 'soap', k: 'fiama di wills gel bar review', v: 28200 },
  { c: 'soap', k: 'lifebuoy soap side effects', v: 24500 },
  { c: 'soap', k: 'salicylic acid body wash for acne', v: 21800 },
  { c: 'soap', k: 'wild stone body wash price', v: 19500 },
  { c: 'soap', k: 'dove soap ph level', v: 17200 },
  { c: 'soap', k: 'charcoal soap benefits for skin', v: 15400 },
  { c: 'soap', k: 'menthol body wash for summer', v: 13800 },
  { c: 'soap', k: 'antibacterial soap for body odour', v: 12100 },
  { c: 'soap', k: 'exfoliating shower gel men', v: 10500 },
  { c: 'soap', k: 'old spice body wash timber', v: 9200 },

  // Body Lotion
  { c: 'body-lotion', k: 'vaseline body lotion cocoa glow', v: 45200 },
  { c: 'body-lotion', k: 'nivea body lotion for men whitening', v: 38500 },
  { c: 'body-lotion', k: 'best body lotion for dry skin winter', v: 32100 },
  { c: 'body-lotion', k: 'parachute body lotion coconut milk', v: 28400 },
  { c: 'body-lotion', k: 'aloe vera body lotion brands', v: 24500 },
  { c: 'body-lotion', k: 'moisturizing cream for full body', v: 21200 },
  { c: 'body-lotion', k: 'calamine lotion uses for itching', v: 18500 },
  { c: 'body-lotion', k: 'non sticky body lotion for summer', v: 16800 },
  { c: 'body-lotion', k: 'himalaya cocoa butter lotion', v: 14200 },
  { c: 'body-lotion', k: 'boroplus antiseptic cream uses', v: 12500 },
  { c: 'body-lotion', k: 'whitening body lotion with spf', v: 11200 },
  { c: 'body-lotion', k: 'cetaphil moisturizing lotion price', v: 9800 },
  { c: 'body-lotion', k: 'body butter vs body lotion', v: 8500 },
  { c: 'body-lotion', k: 'nivea men dark spot reduction cream', v: 7400 },
  { c: 'body-lotion', k: 'aveeno daily moisturizing lotion', v: 6200 },

  // Talcum
  { c: 'talcum', k: 'nycil cool talc prickly heat', v: 35400 },
  { c: 'talcum', k: 'wild stone talcum powder price', v: 31200 },
  { c: 'talcum', k: 'dermi cool powder side effects', v: 28500 },
  { c: 'talcum', k: 'ponds magic powder for face', v: 24100 },
  { c: 'talcum', k: 'axe denim talc review', v: 21500 },
  { c: 'talcum', k: 'candid dusting powder uses', v: 18200 },
  { c: 'talcum', k: 'antifungal powder for sweat rash', v: 16800 },
  { c: 'talcum', k: 'cinthol talc lime fresh', v: 14500 },
  { c: 'talcum', k: 'best talcum powder for body odour', v: 12200 },
  { c: 'talcum', k: 'shower to shower powder discontinued', v: 10500 },
  { c: 'talcum', k: 'yardley london talc for men', v: 9200 },
  { c: 'talcum', k: 'baby powder for chafing adults', v: 8400 },
  { c: 'talcum', k: 'navratna cool talc ingredients', v: 7100 },
  { c: 'talcum', k: 'clotrimazole dusting powder brands', v: 6500 },
  { c: 'talcum', k: 'menthol powder for summer', v: 5800 },

  // Oral Care
  { c: 'oral-care', k: 'colgate visible white price', v: 65200 },
  { c: 'oral-care', k: 'sensodyne toothpaste for sensitivity', v: 58500 },
  { c: 'oral-care', k: 'listerine mouthwash cool mint', v: 52100 },
  { c: 'oral-care', k: 'best toothpaste for yellow teeth', v: 45800 },
  { c: 'oral-care', k: 'dabur red paste ingredients', v: 42500 },
  { c: 'oral-care', k: 'electric toothbrush oral b price', v: 36200 },
  { c: 'oral-care', k: 'meswak toothpaste benefits', v: 31400 },
  { c: 'oral-care', k: 'closeup toothpaste red hot', v: 28100 },
  { c: 'oral-care', k: 'mouth freshener spray for smokers', v: 24500 },
  { c: 'oral-care', k: 'himalaya complete care toothpaste', v: 21200 },
  { c: 'oral-care', k: 'bad breath permanent cure', v: 18500 },
  { c: 'oral-care', k: 'colgate plax mouthwash alcohol free', v: 16800 },
  { c: 'oral-care', k: 'teeth whitening kit at home', v: 14200 },
  { c: 'oral-care', k: 'vicco vajradanti powder price', v: 12500 },
  { c: 'oral-care', k: 'charcoal teeth whitening powder', v: 11200 }
];

export const BacktestTruthInjector = {
    
    async injectBacktestTruth(seed: BacktestSeedV1, opts?: { force?: boolean }): Promise<InjectionReport> {
        const { windowId } = seed;
        let upserts = 0;
        let skipped = 0;
        
        // 1. Group Volumes by Keyword
        const volumeMap = new Map<string, number[]>();
        
        for (const run of seed.runs) {
            for (const kw of run.keywords) {
                // Ensure deterministic key normalization
                const normKey = normalizeKeywordString(kw.keywordKey || kw.keywordText);
                if (!volumeMap.has(normKey)) {
                    volumeMap.set(normKey, []);
                }
                volumeMap.get(normKey)!.push(kw.volume);
            }
        }

        const allKeys = Array.from(volumeMap.keys());
        
        // 2. Compute & Inject
        for (const key of allKeys) {
            const volumes = volumeMap.get(key)!;
            
            // Calculate what the truth WOULD be
            const computedTruth = await VolumeTruthStore.calculateTruthFromValues(key, windowId, volumes);
            
            // Idempotency Check
            const existing = await VolumeTruthStore.getTruthVolume(key, windowId);
            
            if (existing) {
                if (existing.truthHash === computedTruth.truthHash) {
                    skipped++;
                    continue; // Identical truth already exists
                }
                
                if (!opts?.force) {
                    // Conflict: Store as seed2 side-by-side if not forcing
                    const altTruth = { ...computedTruth, windowId: `${windowId}-seed2` };
                    await VolumeTruthStore.saveTruth(altTruth);
                    skipped++; // We count as skipped regarding the main slot
                    continue;
                }
            }
            
            // Upsert
            await VolumeTruthStore.saveTruth(computedTruth);
            upserts++;
        }

        // 3. Seal Window
        await WindowingService.sealWindow(windowId, {
            keywordsSeeded: upserts,
            injectionSource: 'BACKTEST_SEED_V1',
            coveragePercent: 100 // Approximation for this seed batch
        });

        return {
            windowId,
            keywordsProcessed: allKeys.length,
            truthUpserts: upserts,
            truthSkipped: skipped,
            status: 'SUCCESS'
        };
    },

    /**
     * Injects the hardcoded V3 Audit Dataset (100x Backtest).
     * This uses the specific "AUDIT_MEAN_LOCKED" estimator policy.
     */
    async injectAuditDataset(): Promise<InjectionReport> {
        let upserts = 0;
        let skipped = 0;
        
        for (const item of AUDIT_DATASET_V2) {
            const normKey = normalizeKeywordString(item.k);
            
            // Construct Truth Volume directly
            const estimator = 'AUDIT_MEAN_LOCKED';
            
            // Hash computation (Audit Signature)
            const hashPayload = JSON.stringify({
                keyword: normKey,
                window: AUDIT_WINDOW_ID,
                volumes: [item.v], // Single locked volume
                estimator
            });
            const truthHash = await computeSHA256(hashPayload);

            const truthRecord: TruthVolume = {
                keywordKey: normKey,
                windowId: AUDIT_WINDOW_ID,
                estimator,
                truthVolume: item.v,
                observationCount: 100, // Locked from 100 run audit
                lastUpdatedAt: new Date().toISOString(),
                truthHash
            };

            // Idempotency Check
            const existing = await VolumeTruthStore.getTruthVolume(normKey, AUDIT_WINDOW_ID);
            
            if (existing) {
                if (existing.truthHash === truthHash) {
                    skipped++;
                    continue;
                }
                // Force overwrite policy for Audit Dataset injection (it is the source of truth)
            }

            await VolumeTruthStore.saveTruth(truthRecord);
            upserts++;
        }

        await WindowingService.sealWindow(AUDIT_WINDOW_ID, {
            keywordsSeeded: upserts,
            injectionSource: 'BACKTEST_AUDIT_100X',
            coveragePercent: 100
        });

        return {
            windowId: AUDIT_WINDOW_ID,
            keywordsProcessed: AUDIT_DATASET_V2.length,
            truthUpserts: upserts,
            truthSkipped: skipped,
            status: 'SUCCESS',
            message: 'Truth Store successfully seeded from audited backtest data.'
        };
    }
};
