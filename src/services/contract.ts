import { SweepResult, SweepInputsMeta, SweepContract } from '../types';

/**
 * Stable Stringify
 * Recursively sorts keys to ensure deterministic JSON output.
 * Handles objects, arrays (sorted if needed but generally preserving order for content), and primitives.
 */
export function stableStringify(obj: any): string {
    if (obj === undefined) return "";
    if (obj === null) return "null";
    
    if (Array.isArray(obj)) {
        // We assume arrays in business logic are already sorted if order matters for the hash.
        // If strict sorting is needed for sets, it should be done before passing here.
        // For general usage, we just map stableStringify.
        return `[${obj.map(stableStringify).join(",")}]`;
    }
    
    if (typeof obj === "object") {
        const keys = Object.keys(obj).sort();
        const parts = keys.map(key => {
            const val = obj[key];
            if (val === undefined) return ""; // Skip undefined
            return `"${key}":${stableStringify(val)}`;
        }).filter(p => p !== "");
        return `{${parts.join(",")}}`;
    }
    
    // Primitives
    return JSON.stringify(obj);
}

/**
 * SHA-256 Hash Helper
 */
export async function hashContract(payloadString: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(payloadString);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Output Digest
 * Hashes the "Locked" narrative content of the sweep.
 * If these change, the contract is invalid.
 */
export async function computeOutputDigest(sweep: SweepResult): Promise<string> {
    // Extract only the stable narrative/metrics we want to lock
    const lockedContent = {
        demandIndex: sweep.demand_index_mn.toFixed(2), // Fix precision
        readiness: sweep.metric_scores.readiness.toFixed(2),
        spread: sweep.metric_scores.spread.toFixed(2),
        trendLabel: sweep.trend_5y.trend_label || "Unknown",
        synthesis: {
            key_takeaway: sweep.synthesis.key_takeaway || "",
            summary_statement: sweep.synthesis.summary_statement || "",
            early_outlook: sweep.synthesis.early_outlook || ""
        },
        analyst_insight: (sweep.analyst_insight || []).join("|")
    };
    
    return hashContract(stableStringify(lockedContent));
}

/**
 * Full Contract Computer
 */
export async function computeSweepContract(
    sweep: SweepResult, 
    inputsMeta: SweepInputsMeta
): Promise<{ payload: any; payloadString: string; hash: string; outputDigest: string }> {
    
    const outputDigest = await computeOutputDigest(sweep);
    
    // Construct the canonical payload
    // Order matters here implicitly if we stringify, but stableStringify handles key order.
    // We remove timestamp from inputsMeta for hashing
    const { timestamp, ...stableInputs } = inputsMeta;
    
    const payload = {
        inputs: stableInputs,
        outputDigest
    };
    
    const payloadString = stableStringify(payload);
    const hash = await hashContract(payloadString);
    
    return { payload, payloadString, hash, outputDigest };
}