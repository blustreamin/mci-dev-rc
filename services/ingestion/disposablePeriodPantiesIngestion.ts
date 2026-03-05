
import { IngestRequestV1, EvidenceGraph, EvidenceEventV1 } from '../../types';

// Stable hash for dedup
const cyrb53 = (str: string, seed = 0) => {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
};

// INDIA FEMCARE BRAND LIST
const FEMCARE_BRANDS = [
    "Carmesi", "Sirona", "Nua", "Azah", "Plush", "Pee Safe", "PeeSafe",
    "Whisper", "Always", "Kotex", "Sofy", "Stayfree", "Carefree", "Niine",
    "Thinx", "Modibodi", "Saathi", "Heyday", "Pinq", "Rael", "Aayna",
    "Clovia", "Adira", "SuperBottoms", "Stonesoup", "Repad", "Soch",
    "Avni", "Aisle", "Knix", "Ruby Love", "Proof", "Dear Kate", "Neione"
];

const extractBrandFromText = (text: string): string => {
    const lower = text.toLowerCase();
    for (const b of FEMCARE_BRANDS) {
        if (lower.includes(b.toLowerCase())) return b;
    }
    return "Generic/Other";
};

const getField = (raw: any, fieldName: string | undefined): string => {
    if (!fieldName) return '';
    if (Array.isArray(raw)) return '';
    const val = raw[fieldName];
    if (val === null || val === undefined) return '';
    return String(val).trim();
};

// Deterministic Ingestion for Disposable Period Panties
export const disposablePeriodPantiesIngestion = (request: IngestRequestV1): EvidenceGraph => {
    const events: EvidenceEventV1[] = [];
    const brandCounts: Record<string, number> = {};
    const ratings: number[] = [];
    const seenTextHashes = new Set<number>();

    request.inputs.forEach(input => {
        const sourceTag = input.sourceTag.toLowerCase();
        const fieldMap = input.mapping.canonicalFieldMap;
        
        input.rows.forEach(row => {
            const raw = row.raw;
            
            // ── TEXT ─────────────────────────────────────────────────────────
            let text = getField(raw, fieldMap.text);
            if (!text || text.length < 5) {
                for (const fallback of ['Post Snippet', 'reviewDescription', 'review_text', 'text', 'caption', 'content']) {
                    const val = raw[fallback];
                    if (val && String(val).trim().length >= 5) {
                        text = String(val).trim();
                        break;
                    }
                }
            }
            if (!text || text.length < 5) return;
            
            const cleanText = text.trim().toLowerCase();

            // ── DEDUP ────────────────────────────────────────────────────────
            const textHash = cyrb53(cleanText);
            if (seenTextHashes.has(textHash)) return;
            seenTextHashes.add(textHash);

            // ── BRAND ────────────────────────────────────────────────────────
            let brand = getField(raw, fieldMap.brand) || "Generic/Other";
            if (brand === "Generic/Other") {
                const product = getField(raw, fieldMap.product);
                if (product) {
                    const extracted = extractBrandFromText(product);
                    if (extracted !== "Generic/Other") brand = extracted;
                }
            }
            if (brand === "Generic/Other") {
                brand = extractBrandFromText(cleanText);
            }
            
            // Normalize
            const txtLower = (cleanText + " " + brand).toLowerCase();
            if (txtLower.includes("carmesi")) brand = "Carmesi";
            else if (txtLower.includes("sirona")) brand = "Sirona";
            else if (txtLower.includes("nua")) brand = "Nua";
            else if (txtLower.includes("azah")) brand = "Azah";
            else if (txtLower.includes("plush")) brand = "Plush";
            else if (txtLower.includes("pee safe") || txtLower.includes("peesafe")) brand = "Pee Safe";
            else if (txtLower.includes("whisper")) brand = "Whisper";
            else if (txtLower.includes("always")) brand = "Always";
            else if (txtLower.includes("kotex")) brand = "Kotex";
            else if (txtLower.includes("sofy")) brand = "Sofy";
            else if (txtLower.includes("stayfree")) brand = "Stayfree";
            else if (txtLower.includes("thinx")) brand = "Thinx";
            else if (txtLower.includes("modibodi")) brand = "Modibodi";
            else if (txtLower.includes("saathi")) brand = "Saathi";
            else if (txtLower.includes("heyday")) brand = "Heyday";
            else if (txtLower.includes("rael")) brand = "Rael";
            else if (txtLower.includes("niine")) brand = "Niine";
            else if (txtLower.includes("clovia")) brand = "Clovia";
            else if (txtLower.includes("superbottoms")) brand = "SuperBottoms";

            brandCounts[brand] = (brandCounts[brand] || 0) + 1;

            // ── RATING ───────────────────────────────────────────────────────
            let rating = 0;
            const ratingVal = getField(raw, fieldMap.rating);
            if (ratingVal) {
                const parsed = parseFloat(ratingVal);
                if (!isNaN(parsed) && parsed >= 1 && parsed <= 5) {
                    rating = parsed;
                    ratings.push(rating);
                }
            }

            // ── GEOGRAPHY ────────────────────────────────────────────────────
            let country = getField(raw, fieldMap.location) || 'IN';
            let city = getField(raw, fieldMap.city) || '';
            let state = getField(raw, fieldMap.state) || '';
            if (country === 'India' || country === 'IN' || country === 'in') country = 'IN';
            if (city && city.length < 2) city = '';
            if (state && state.length < 2) state = '';

            // ── PLATFORM ─────────────────────────────────────────────────────
            const isCommerce = sourceTag.includes('amazon') || sourceTag.includes('flipkart');
            let platformName = '';
            if (isCommerce) {
                platformName = sourceTag.includes('amazon') ? 'Amazon' : 'Flipkart';
            } else if (sourceTag.includes('instagram')) {
                platformName = 'Instagram';
            } else if (sourceTag.includes('facebook')) {
                platformName = 'Facebook';
            } else {
                const awarioSource = getField(raw, fieldMap.platform) || '';
                const srcLower = awarioSource.toLowerCase();
                if (srcLower.includes('youtube')) platformName = 'YouTube';
                else if (srcLower.includes('reddit')) platformName = 'Reddit';
                else if (srcLower.includes('twitter') || srcLower === 'x') platformName = 'Twitter/X';
                else if (srcLower.includes('instagram')) platformName = 'Instagram';
                else if (srcLower.includes('facebook')) platformName = 'Facebook';
                else if (srcLower.includes('quora')) platformName = 'Quora';
                else if (srcLower.includes('news') || srcLower.includes('blog')) platformName = 'News & Blogs';
                else if (srcLower.includes('web')) platformName = 'Web';
                else if (srcLower.includes('vimeo')) platformName = 'Vimeo';
                else platformName = awarioSource || 'Social Listening';
            }

            // ── DATE ─────────────────────────────────────────────────────────
            const dateStr = getField(raw, fieldMap.createdAtISO);
            let createdAt = new Date().toISOString();
            if (dateStr) {
                try {
                    const d = new Date(dateStr);
                    if (!isNaN(d.getTime())) createdAt = d.toISOString();
                } catch { /* keep default */ }
            }

            // ── EVENT ────────────────────────────────────────────────────────
            const event: EvidenceEventV1 = {
                evidenceId: `ev_${events.length}_${Date.now().toString(36)}`,
                eventType: isCommerce ? 'COMMERCE_REVIEW' : 'SOCIAL_MENTION',
                sourceTag: sourceTag.includes('amazon') ? 'amazon' 
                         : sourceTag.includes('flipkart') ? 'flipkart' 
                         : sourceTag.includes('instagram') ? 'instagram'
                         : sourceTag.includes('facebook') ? 'facebook'
                         : 'social',
                content: { 
                    text: text.trim(),
                    platform: platformName
                },
                commerce: {
                    brand,
                    platform: platformName,
                    rating,
                    currency: 'INR'
                },
                geo: { 
                    country: country || 'IN',
                    city: city || undefined,
                    state: state || undefined
                },
                time: { createdAtISO: createdAt }
            };
            events.push(event);
        });
    });

    const avgRating = ratings.length ? ratings.reduce((a,b)=>a+b,0)/ratings.length : 0;
    
    console.log(`[disposablePeriodPantiesIngestion] ${events.length} events, ${Object.keys(brandCounts).length} brands, ${ratings.length} ratings`);

    return {
        schemaVersion: "evidence_graph_v1",
        projectId: request.projectId,
        generatedAtISO: new Date().toISOString(),
        events,
        aggregations: {
            brandCounts: Object.entries(brandCounts).map(([k,v]) => ({ brand: k, count: v })),
            ratingSummary: { count: ratings.length, avg: avgRating, p50: 0, p90: 0 },
            languageCounts: [{ lang: 'en', count: events.length }]
        }
    };
};
