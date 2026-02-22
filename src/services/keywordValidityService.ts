
import { StorageAdapter } from './storageAdapter';
import { normalizeKeywordString } from '../../driftHash';
import { GoogleGenAI } from '@google/genai';
import { ValidityResult, ValidityReport } from '../../types';

// Safe env access
const safeProcess = (typeof process !== 'undefined' && process && process.env) 
    ? process 
    : { env: {} as Record<string, string | undefined> };

function getAI() {
  const apiKey = safeProcess.env.API_KEY;
  if (!apiKey) throw new Error("API Key missing");
  return new GoogleGenAI({ apiKey });
}

export const KeywordValidityService = {
    
    getValidityKey(windowId: string, categoryId: string, keywordKey: string): string {
        return `${windowId}|${categoryId}|${keywordKey}`;
    },

    async checkKeywordValidity(
        windowId: string, 
        categoryId: string, 
        keywordText: string,
        forceRefresh: boolean = false
    ): Promise<ValidityResult> {
        const keywordKey = normalizeKeywordString(keywordText);
        const storeKey = this.getValidityKey(windowId, categoryId, keywordKey);

        if (!forceRefresh) {
            const cached = await StorageAdapter.get<ValidityResult>(storeKey, StorageAdapter.STORES.VALIDITY);
            if (cached) return cached;
        }

        const result: ValidityResult = {
            isValid: false,
            validitySource: 'UNKNOWN',
            evidence: {},
            checkedAt: new Date().toISOString()
        };

        // Fallback: Lexical check only (Strict v3 mode)
        if (this.performLexicalCheck(keywordText)) {
            result.isValid = true;
            result.validitySource = 'LEXICAL';
            result.evidence.lexicalPass = true;
        } else {
            result.isValid = false;
            result.evidence.reason = 'Failed Lexical Check';
        }

        await this.saveResult(storeKey, result);
        return result;
    },

    async batchCheckKeywordValidity(
        windowId: string,
        categoryId: string,
        keywords: string[]
    ): Promise<Map<string, ValidityResult>> {
        const results = new Map<string, ValidityResult>();
        
        for (const kw of keywords) {
            const key = normalizeKeywordString(kw);
            const singleRes = await this.checkKeywordValidity(windowId, categoryId, kw);
            results.set(key, singleRes);
        }

        return results;
    },

    async runGroundingBatch(keywords: string[]): Promise<Record<string, boolean>> {
        return {};
    },

    performLexicalCheck(text: string): boolean {
        if (!text) return false;
        if (text.length < 3 || text.length > 80) return false;
        if (!/[a-zA-Z]/.test(text)) return false; 
        if (/(\S)\1{4,}/.test(text)) return false; 
        if (/[\u{1F600}-\u{1F64F}]/u.test(text)) return false;
        
        const stops = new Set(['the', 'a', 'in', 'for', 'of', 'and', 'to', 'is', 'it']);
        const parts = text.toLowerCase().split(/\s+/).filter(p => !stops.has(p));
        if (parts.length === 0) return false;

        return true;
    },

    async saveResult(key: string, res: ValidityResult) {
        await StorageAdapter.set(key, res, StorageAdapter.STORES.VALIDITY);
    },

    async saveReport(report: ValidityReport) {
        const key = `${report.windowId}|${report.categoryId}`;
        await StorageAdapter.set(key, report, StorageAdapter.STORES.REPORT);
    },

    async getReport(windowId: string, categoryId: string): Promise<ValidityReport | null> {
        const key = `${windowId}|${categoryId}`;
        return await StorageAdapter.get<ValidityReport>(key, StorageAdapter.STORES.REPORT);
    }
};
