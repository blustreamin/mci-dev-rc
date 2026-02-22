
import { LOCKED_SWEEP_V1_SAMPLE, LOCKED_CONTRACT_VERSION } from '../contracts/sweepOutputLocked';

async function computeStructureHash(obj: any): Promise<string> {
    const structure = extractStructure(obj);
    const text = JSON.stringify(structure);
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 8);
}

function extractStructure(obj: any): any {
    if (obj === null) return 'null';
    if (typeof obj !== 'object') return typeof obj;
    if (Array.isArray(obj)) {
        // Assume homogeneous arrays for contract checks
        if (obj.length === 0) return ['empty'];
        return [extractStructure(obj[0])]; 
    }
    
    const keys = Object.keys(obj).sort();
    const result: Record<string, any> = {};
    for (const key of keys) {
        result[key] = extractStructure(obj[key]);
    }
    return result;
}

let CACHED_EXPECTED_HASH: string | null = null;

export const ContractValidator = {
    async getExpectedHash(): Promise<string> {
        if (!CACHED_EXPECTED_HASH) {
            CACHED_EXPECTED_HASH = await computeStructureHash(LOCKED_SWEEP_V1_SAMPLE);
        }
        return CACHED_EXPECTED_HASH;
    },

    async validate(actual: any): Promise<{ valid: boolean; expected: string; actual: string; version: string }> {
        const expected = await this.getExpectedHash();
        const actualHash = await computeStructureHash(actual);
        
        return {
            valid: expected === actualHash,
            expected,
            actual: actualHash,
            version: LOCKED_CONTRACT_VERSION
        };
    }
};
