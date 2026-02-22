
import { DeepDiveResult, SignalsBundle } from '../types';

/**
 * Validates a single signal item against canonical schema and domain allowlist.
 */
function validateSignalItem(item: any, platform: string): { valid: boolean; reason?: string } {
    if (!item || typeof item !== 'object') return { valid: false, reason: "Item is null/undefined" };

    // 1. Core Fields Check
    if (!item.url || typeof item.url !== 'string') return { valid: false, reason: "Missing/Invalid URL" };
    // Allow item.quote or item.claim or item.title as valid descriptors
    if (!item.title && !item.quote && !item.claim) return { valid: false, reason: "Missing/Invalid Title/Quote" };

    // 2. Domain Allowlist Check
    const url = item.url.toLowerCase();
    const p = platform.toLowerCase();
    let domainValid = false;

    try {
        const hostname = new URL(url).hostname;

        if (p === 'youtube') domainValid = hostname.includes('youtube.com') || hostname.includes('youtu.be');
        else if (p === 'instagram') domainValid = hostname.includes('instagram.com');
        else if (p === 'reddit') domainValid = hostname.includes('reddit.com');
        else if (p === 'twitter') {
            // Strict X/Twitter check: Must be x.com ONLY. Reject twitter.com.
            const isX = hostname.endsWith('x.com'); 
            const hasStatus = url.includes('/status/');
            // We allow profile URLs too for creators, but for 'Twitter' signals usually status is preferred.
            // Validator allows profile if it's a "Creator" signal, but here we are validating generic platform bucket.
            domainValid = isX; 
        }
        else if (p === 'quora') domainValid = hostname.includes('quora.com');
        else if (p === 'amazon') {
            // Strict Amazon: Must be amazon.in and contain product path
            const isAmazonIn = hostname.includes('amazon.in');
            const hasProductPath = url.includes('/dp/') || url.includes('/gp/product/');
            domainValid = isAmazonIn && hasProductPath;
        }
        else if (p === 'flipkart') domainValid = hostname.includes('flipkart.com');
        else if (p === 'quickcommerce') domainValid = hostname.includes('blinkit') || hostname.includes('zepto') || hostname.includes('swiggy') || hostname.includes('bigbasket');
        else if (p === 'creators') domainValid = hostname.includes('youtube.com') || hostname.includes('instagram.com') || hostname.includes('linkedin');
        else domainValid = true; // Other platforms generic check

        if (!domainValid) return { valid: false, reason: `Domain Mismatch: ${hostname} not allowed for ${platform} (URL: ${url})` };

    } catch (e) {
        return { valid: false, reason: `Malformed URL: ${url}` };
    }

    return { valid: true };
}

export async function validateDeepDiveV1(result: any): Promise<{ ok: boolean; errors: string[]; patched: DeepDiveResult }> {
    // Clone to patch
    const patched = JSON.parse(JSON.stringify(result)) as DeepDiveResult;
    patched.warnings = patched.warnings || [];

    if (!result) return { ok: false, errors: ["Input result is null/undefined"], patched: {} as any };

    // Use signalsBundle if available (System of Record), else fallback to signals (UI Compat)
    // We map keys from bundle to legacy keys for iteration
    const signalsSource = patched.signalsBundle?.sources;
    
    // Mapping Bundle keys to Legacy UI keys
    // Fixed: Accessed correct properties on DeepDiveSignalsV1 interface
    const signalMap = {
        'youtubeSignals': signalsSource?.youtubeSignals || patched.signals?.youtubeSignals || [],
        'instagramSignals': signalsSource?.instagramSignals || patched.signals?.instagramSignals || [],
        'conversationSignals': signalsSource?.conversationSignals || patched.signals?.conversationSignals || [],
        'twitterSignals': signalsSource?.twitterSignals || patched.signals?.twitterSignals || [],
        'quoraSignals': signalsSource?.quoraSignals || patched.signals?.quoraSignals || [],
        'amazonSignals': signalsSource?.amazonSignals || patched.signals?.transactionProof || [], // Legacy mapped
        'flipkartSignals': signalsSource?.flipkartSignals || patched.signals?.flipkartSignals || [],
        'quickCommerceSignals': signalsSource?.quickCommerceSignals || patched.signals?.quickCommerceSignals || [],
        'contentCreators': signalsSource?.contentCreators || patched.signals?.contentCreators || []
    };

    const synthesis: any = patched.synthesis || {};

    // Definition of required buckets - UPDATED LIMITS (5 for display, but engine fetches 10)
    // We validate for at least 5 valid signals to ensure UI density.
    const requiredBuckets = [
        { key: 'youtubeSignals', label: 'YouTube', min: 5 },
        { key: 'instagramSignals', label: 'Instagram', min: 5 },
        { key: 'conversationSignals', label: 'Reddit', min: 5 },
        { key: 'twitterSignals', label: 'Twitter', min: 5 },
        { key: 'quoraSignals', label: 'Quora', min: 5 },
        { key: 'amazonSignals', label: 'Amazon', min: 5 },
        { key: 'flipkartSignals', label: 'Flipkart', min: 5 },
        { key: 'quickCommerceSignals', label: 'QuickCommerce', min: 5 },
        { key: 'contentCreators', label: 'Creators', min: 5 }
    ];

    let totalSignalCount = 0;
    let bucketsFailed = 0;

    for (const bucket of requiredBuckets) {
        const items = (signalMap as any)[bucket.key] || [];
        const validItems: any[] = [];
        
        // Detailed check per item
        items.forEach((item: any) => {
            const check = validateSignalItem(item, bucket.label);
            if (check.valid) {
                validItems.push(item);
            }
        });

        // Deduplicate by URL
        const unique = new Map();
        validItems.forEach((item: any) => { if (item.url) unique.set(item.url, item); });
        const finalItems = Array.from(unique.values());

        // Update patched object (legacy path) to match valid items
        // Note: We don't touch signalsBundle here as it is locked
        if (patched.signals) {
            (patched.signals as any)[bucket.key] = finalItems;
            // Amazon specific map
            if (bucket.key === 'amazonSignals') patched.signals.transactionProof = finalItems;
        }

        totalSignalCount += finalItems.length;
        
        if (finalItems.length < bucket.min) {
            const msg = `${bucket.label} signal count low: ${finalItems.length}/${bucket.min}`;
            if (!patched.warnings.includes(msg)) patched.warnings.push(msg);
            bucketsFailed++;
        }
    }

    // Consumer Truth Validation
    const truth = synthesis.consumerTruth;
    if (!truth || typeof truth !== 'string' || truth.length < 50) {
        const msg = "Synthesis validation warning: consumerTruth missing or too short";
        if (!patched.warnings.includes(msg)) patched.warnings.push(msg);
    }

    // CRITICAL: Only fail hard if we have ZERO signals across all platforms
    if (totalSignalCount === 0) {
        return {
            ok: false,
            errors: ["CRITICAL: No valid signals found across any platform."],
            patched
        };
    }

    // If we have warnings (buckets failed or synthesis missing), mark PARTIAL
    if (patched.warnings.length > 0) {
        patched.status = 'PARTIAL';
    } else {
        patched.status = 'OK';
    }

    return {
        ok: true, // Always return true if we have signals, even if PARTIAL
        errors: patched.warnings,
        patched
    };
}

export function createFallbackDeepDive(category: string, message: string): DeepDiveResult {
    return {
        categoryId: category,
        monthKey: 'UNKNOWN',
        generatedAt: new Date().toISOString(),
        // version property removed as it is not in DeepDiveResult type
        provenance: {
            demandSnapshotId: 'NONE',
            signalsSnapshotId: 'NONE',
            metricsVersion: 'NONE',
            signalMode: 'NONE',
            dataConfidence: 'BACKFILL'
        },
        executiveSummary: {
            title: 'Analysis Failed',
            opportunityLabel: 'N/A',
            bullets: [message],
            actions: []
        },
        marketStructure: {
            demandIndex: 0,
            readiness: 0,
            spread: 0,
            trend5y: null,
            structureLabel: 'Unknown',
            momentumLabel: 'Unknown'
        },
        consumerIntelligence: {
            problems: [],
            aspirations: [],
            routines: [],
            triggers: [],
            barriers: [],
            trends: [],
            needGaps: []
        },
        signalsSnapshot: {
            totalCount: 0,
            sources: [],
            topSignals: [],
            themes: []
        },
        diagnoses: [],
        competitiveLandscape: {
            brandProminence: 'Unknown',
            topBrands: [],
            brandQueries: []
        },
        opportunities: [],
        messaging: { pillars: [], doNotSay: [] },
        activation: { contentIdeas: [], channels: [] },
        methodology: { sourcesUsed: [], limitations: [message] },

        // Legacy props for back-compat safety
        status: 'FAILED',
        categoryName: category,
        warnings: [message],
        signals: {} as any,
        synthesis: {} as any,
        sources: {} as any,
        mode: 'backfill',
        category: category,
        consumer_intelligence: {},
        market_dynamics: {},
        content_intelligence: {}
    };
}
