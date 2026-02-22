
/**
 * Safety utilities to prevent React #31 errors (object as child) 
 * and numeric parsing failures in the Demand Sweep pipeline.
 */

/**
 * Returns a valid finite number from a variety of potential inputs.
 * Specifically handles cases where a metric might be returned as an object.
 */
export function safeNum(val: any, fallback: number = 0): number {
    if (typeof val === 'number' && Number.isFinite(val)) return val;
    
    if (typeof val === 'string') {
        const parsed = parseFloat(val.replace(/[^0-9.-]/g, ''));
        return Number.isFinite(parsed) ? parsed : fallback;
    }
    
    if (typeof val === 'object' && val !== null) {
        // Check common property names for metric objects
        const candidate = val.value ?? val.index ?? val.amount ?? val.median ?? val.mean;
        if (typeof candidate === 'number') return candidate;
        if (typeof candidate === 'string') return safeNum(candidate, fallback);
    }
    
    return fallback;
}

/**
 * STRICT RENDER GUARD (P0 Requirement)
 * Ensures absolutely no objects are passed to React children.
 * Handles arrays, nulls, and complex objects by projecting them to string representations.
 */
export function safeText(input: unknown, fallback = ""): string {
  if (input == null) return fallback;
  if (typeof input === "string") return input;
  if (typeof input === "number" || typeof input === "boolean") return String(input);

  // Arrays -> join safely
  if (Array.isArray(input)) {
    return input.map((x) => safeText(x, "")).filter(Boolean).join(", ") || fallback;
  }

  // Objects -> deterministic, readable rendering (no crashes)
  if (typeof input === "object") {
    const obj = input as Record<string, unknown>;

    try {
        // Common LLM shapes seen in audits:
        // { region, insight }  -> "Region: Insight"
        if ("region" in obj && "insight" in obj) {
        return `${safeText(obj.region, "Unknown")}: ${safeText(obj.insight, "")}`.trim() || fallback;
        }
        // { topic, format } -> "Topic (Format)"
        if ("topic" in obj && "format" in obj) {
        const t = safeText(obj.topic, "");
        const f = safeText(obj.format, "");
        return f ? `${t} (${f})`.trim() : t || fallback;
        }
        // { angle, reason } -> "Angle — Reason"
        if ("angle" in obj && "reason" in obj) {
        const a = safeText(obj.angle, "");
        const r = safeText(obj.reason, "");
        return r ? `${a} — ${r}`.trim() : a || fallback;
        }
        // { label, value } -> "Label: Value"
        if ("label" in obj && "value" in obj) {
            return `${safeText(obj.label)}: ${safeText(obj.value)}`;
        }

        // Fallback: stable key-value projection, limited length
        const keys = Object.keys(obj).sort().slice(0, 6);
        const kv = keys
        .map((k) => `${k}: ${safeText(obj[k], "")}`)
        .filter((s) => s !== `${keys}: `);

        const out = kv.join(" | ");
        return out ? out.slice(0, 220) : fallback;
    } catch (e) {
        return fallback;
    }
  }

  return fallback;
}

/**
 * Returns a string suitable for React rendering (Alias for safeText).
 */
export function safeStr(val: any, fallback: string = '—'): string {
    return safeText(val, fallback);
}

/**
 * Safely lowercase a string, handling nulls/undefined/non-strings.
 */
export function safeLower(val: any): string {
    if (typeof val === 'string') return val.toLowerCase();
    return '';
}

/**
 * Safely trim a string, handling nulls/undefined/non-strings.
 */
export function safeTrim(val: any): string {
    if (typeof val === 'string') return val.trim();
    return '';
}

/**
 * React-safe render helper that can be used directly in JSX.
 * <>{safeRender(complexObject)}</>
 */
export function safeRender(value: any, fallback: string = ''): string {
    return safeText(value, fallback);
}

/**
 * Dev-only assertion to log potential data shape mismatches without crashing.
 */
export function assertMetricShape(label: string, value: any) {
    if (process.env.NODE_ENV === 'development') {
        if (value !== null && value !== undefined && typeof value === 'object') {
            console.warn(`[DEMAND_UI_MISMATCH] Field "${label}" contains an object instead of a scalar:`, value);
        }
    }
}
