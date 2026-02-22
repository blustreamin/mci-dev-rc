
/**
 * Recursively sanitizes an object for Firestore:
 * 1. Removes keys with `undefined` values.
 * 2. Preserves `null`.
 * 3. Preserves `Date` objects.
 * 4. Filters `undefined` from Arrays.
 */
export function sanitizeForFirestore<T>(obj: T): T {
    if (obj === undefined) return null as any;
    if (obj === null) return null as any;
    
    // Preserve Dates (typeof Date is 'object')
    if (obj instanceof Date) {
        return obj as any;
    }

    if (Array.isArray(obj)) {
        // Filter out undefined items from arrays
        return obj.map(v => sanitizeForFirestore(v)).filter(v => v !== undefined) as any;
    }

    if (typeof obj === 'object') {
        const res: any = {};
        for (const key in obj) {
            const val = (obj as any)[key];
            if (val !== undefined) {
                res[key] = sanitizeForFirestore(val);
            }
        }
        return res;
    }

    return obj;
}
