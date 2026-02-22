
import { normalizeKeywordString } from '../driftHash';

/**
 * KeywordCanonicalizer implements the identity rules for ABS_V3 metrics.
 */
export const KeywordCanonicalizer = {
    /**
     * Generates a canonical key for a keyword row.
     * Rules:
     * 1. Lowercase, trim, collapse whitespace.
     * 2. Strip punctuation except spaces and hyphens.
     */
    canonicalKey(text: string): string {
        if (!text) return "";
        return text
            .toLowerCase()
            .trim()
            .replace(/[^\w\s-]/g, '') // Strip punctuation except word chars (includes _), spaces, and hyphens
            .replace(/\s+/g, ' ')     // Collapse whitespace
            .trim();
    }
};
