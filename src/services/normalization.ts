
// Canonical Normalization V1
// Used by Ingestion, Strategy, and Demand lookups.

export const Normalization = {
    normalize(raw: string): string {
        if (!raw) return "";
        return raw
            .toLowerCase()
            .trim()
            .normalize("NFKD") // Normalize unicode (separate diacritics)
            .replace(/[\u0300-\u036f]/g, "") // Remove diacritics
            .replace(/['"’‘“”]/g, "") // Remove quotes/apostrophes
            .replace(/[^a-z0-9\s]/g, "") // Remove punctuation/symbols (keep letters/numbers/spaces)
            .replace(/\s+/g, " "); // Collapse multiple spaces
    }
};
