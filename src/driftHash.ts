import { CORE_CATEGORIES } from './constants';
import { LockedKeyword } from './types';

// --- Shared Normalization Logic ---

/**
 * STRICT NORMALIZATION V1
 * Rules:
 * 1. Lowercase
 * 2. Trim
 * 3. Remove diacritics (NFKD)
 * 4. Remove all non-alphanumeric chars (except space)
 * 5. Collapse multiple spaces to single space
 */
export function normalizeKeywordString(raw: string): string {
    if (!raw) return "";
    return raw
        .toLowerCase()
        .trim()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "") // Remove diacritics
        .replace(/[^a-z0-9\s]/g, "") // Remove punctuation/symbols
        .replace(/\s+/g, " "); // Collapse spaces
}

// --- v1 Registry Hash (Simple) ---

function simpleHashString(str: string): string {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) + hash) + char; /* hash * 33 + c */
    }
    return hash.toString(16);
}

// Computes a SHA-256 hash of the Canonical Registry to detect structural drift.
// Canonical Registry = Sorted Categories -> Sorted SubCategories -> Sorted Anchors
export async function computeRegistryHash(): Promise<string> {
    const structuralRegistry = CORE_CATEGORIES.map(cat => ({
        id: cat.id,
        category: cat.category,
        subCategories: cat.subCategories.map(sc => ({
            name: sc.name,
            anchors: [...sc.anchors].sort()
        })).sort((a, b) => a.name.localeCompare(b.name)),
        anchors: [...cat.anchors].sort()
    })).sort((a, b) => a.id.localeCompare(b.id));

    const stableString = JSON.stringify(structuralRegistry);
    return await computeSHA256(stableString);
}

// --- v2 Keyword Base Hash (SHA-256) ---

interface HashableKeyword {
  keywordCanonical: string;
  anchor: string;
  cluster: string | null;
  intent: string;
  language: string;
  canonicalFamilyId: string;
}

export async function computeSHA256(str: string): Promise<string> {
  const textAsBuffer = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', textAsBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function computeKeywordBaseHash(keywords: LockedKeyword[] | undefined): Promise<string> {
    if (!keywords || keywords.length === 0) {
        return "0".repeat(64); // Return a default hash for empty input
    }
    
    // 1. Canonicalize and prepare for hashing
    const preparedKeywords: HashableKeyword[] = keywords.map(kw => ({
        // Apply shared normalization
        keywordCanonical: normalizeKeywordString(kw.keywordCanonical),
        anchor: kw.anchor,
        cluster: kw.cluster || null,
        intent: kw.intent,
        language: kw.language || 'English',
        canonicalFamilyId: kw.canonicalFamilyId,
    }));
    
    // 2. Stable Ordering
    preparedKeywords.sort((a, b) => {
        if (a.anchor !== b.anchor) return a.anchor.localeCompare(b.anchor);
        // Sort by Normalized Canonical Keyword for determinism
        if (a.keywordCanonical !== b.keywordCanonical) return a.keywordCanonical.localeCompare(b.keywordCanonical);
        return a.intent.localeCompare(b.intent);
    });

    // 3. Stringify and Hash
    const stableString = JSON.stringify(preparedKeywords);
    return computeSHA256(stableString);
}