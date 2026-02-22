
import { CategoryBaseline } from '../../../types';
import { CORE_CATEGORIES } from '../../../constants';

export interface ValidationResult {
    isValid: boolean;
    rejectionReason?: string;
    normalizedText: string;
}

// Explicit export artifacts to block.
const EXPORT_ARTIFACTS = new Set([
    "keyword", "search volume", "avg. monthly searches", "competition", "cpc", 
    "level", "results", "cpc (usd)", "phrase", "avg. searches", "vol", 
    "trend", "last month", "year over year", "opportunity score"
]);

export const KeywordValidator = {
    
    createValidator(categoryId: string): (text: string) => ValidationResult {
        return (text: string): ValidationResult => {
            if (!text) return { isValid: false, rejectionReason: "Empty", normalizedText: "" };

            // 1. Normalization
            // Strip leading "=" if present (Excel artifact)
            let raw = text;
            if (raw.startsWith('=') && raw.length > 1) {
                raw = raw.substring(1); 
            }

            const normalized = raw.toLowerCase()
                .trim()
                .replace(/\s+/g, ' '); // Collapse spaces

            // 2. Empty after trim
            if (normalized.length === 0) {
                return { isValid: false, rejectionReason: "Empty", normalizedText: "" };
            }

            // 3. Header / Artifact Check
            if (EXPORT_ARTIFACTS.has(normalized)) {
                return { isValid: false, rejectionReason: "Export Header", normalizedText: normalized };
            }
            if (normalized.includes("avg. search volume") || normalized.startsWith("search volume")) {
                return { isValid: false, rejectionReason: "Export Header", normalizedText: normalized };
            }

            // 4. Pure Symbol/Punctuation Check (No letters or numbers)
            // If it doesn't contain at least one alphanumeric char
            if (!/[a-z0-9]/i.test(normalized)) {
                return { isValid: false, rejectionReason: "Pure Symbol/Punct", normalizedText: normalized };
            }

            // 5. Pure Numeric Artifact Check (Strict)
            // Reject "123", "123.45". Accept "mach 3", "7 o'clock"
            if (/^\d+(\.\d+)?$/.test(normalized)) {
                return { isValid: false, rejectionReason: "Pure Numeric", normalizedText: normalized };
            }

            // 6. Length Check (Smart)
            // Reject single chars unless specific allowlist (none for now, usually noise)
            // "a", "1" -> Reject. "v8" -> Accept. "hp" -> Accept.
            if (normalized.length < 2) {
                 return { isValid: false, rejectionReason: "Too Short (<2)", normalizedText: normalized };
            }
            // If length is 2, ensure at least one letter? Or strictly allow?
            // "12" -> numeric check caught it. "a1" -> allowed. "..", "!!" -> symbol check caught it.
            // So if it survived above checks and length >= 2, it's likely valid.

            // 7. Valid
            return { isValid: true, normalizedText: normalized };
        };
    }
};
