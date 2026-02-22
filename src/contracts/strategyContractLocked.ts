import { PreSweepData, StrategyContractV1 } from '../types';

async function computeSHA256(str: string): Promise<string> {
    const textAsBuffer = new TextEncoder().encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', textAsBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function normalizeStrategyPayload(payload: any): any {
    if (payload === null || payload === undefined) return null;
    if (typeof payload !== 'object') return payload;
    
    if (Array.isArray(payload)) {
        // Sort arrays of primitives or objects to ensure stable ordering for hashing
        // Simple heuristic: if objects, sort by a common key like 'keyword' or 'name' if exists, else JSON string
        const copy = payload.map(normalizeStrategyPayload);
        
        // Custom Sort for specific arrays known in Strategy
        // Keywords list
        if (copy.length > 0 && copy[0]?.keyword) {
            return copy.sort((a, b) => a.keyword.localeCompare(b.keyword));
        }
        // Anchors list
        if (copy.length > 0 && copy[0]?.name) {
            return copy.sort((a, b) => a.name.localeCompare(b.name));
        }
        
        return copy.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    }

    const keys = Object.keys(payload).sort();
    const result: Record<string, any> = {};
    for (const key of keys) {
        if (payload[key] === undefined) continue;
        result[key] = normalizeStrategyPayload(payload[key]);
    }
    return result;
}

export const StrategyContractService = {
    
    async createContract(categoryId: string, payload: PreSweepData): Promise<StrategyContractV1> {
        // 1. Normalize
        const normalized = normalizeStrategyPayload(payload);
        
        // 2. Hash
        const hash = await computeSHA256(JSON.stringify(normalized));
        
        // 3. Construct Contract
        const contract: StrategyContractV1 = {
            contract_name: "strategy_contract",
            contract_version: "1.0.0",
            category_id: categoryId,
            generated_at: new Date().toISOString(),
            status: "PASS",
            contract_hash: hash,
            payload: payload
        };
        
        console.log(`[STRATEGY][CONTRACT] BUILD_OK hash=${hash.substring(0,8)}`);
        return contract;
    },

    async validateContract(contract: any): Promise<{ ok: boolean; reason?: string }> {
        if (!contract) return { ok: false, reason: "Missing contract" };
        
        // 1. Structure Check
        if (contract.contract_name !== "strategy_contract") return { ok: false, reason: "Invalid contract_name" };
        if (contract.contract_version !== "1.0.0") return { ok: false, reason: "Unsupported version" };
        if (!contract.payload) return { ok: false, reason: "Missing payload" };
        
        // 2. Hash Check
        const normalized = normalizeStrategyPayload(contract.payload);
        const reHash = await computeSHA256(JSON.stringify(normalized));
        
        if (reHash !== contract.contract_hash) {
            console.error(`[STRATEGY][CONTRACT] VALID_FAIL Expected=${contract.contract_hash} Actual=${reHash}`);
            return { ok: false, reason: "Hash mismatch (Integrity Violation)" };
        }

        console.log(`[STRATEGY][CONTRACT] VALID_OK hash=${reHash.substring(0,8)}`);
        return { ok: true };
    }
};