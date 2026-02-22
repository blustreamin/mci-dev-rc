
export type FsQueryError =
  | { kind: "INDEX_ERROR"; url: string; originalMessage: string }
  | { kind: "PERMISSION_DENIED"; originalMessage: string }
  | { kind: "UNKNOWN"; message: string };

export function classifyFirestoreError(e: any): FsQueryError {
    const msg = e.message || String(e);
    if (msg.includes("requires an index")) {
        const match = msg.match(/https:\/\/console\.firebase\.google\.com[^\s]*/);
        return { 
            kind: "INDEX_ERROR", 
            url: match ? match[0] : "", 
            originalMessage: msg 
        };
    }
    if (msg.includes("permission-denied") || msg.includes("Missing or insufficient permissions")) {
        return { 
            kind: "PERMISSION_DENIED", 
            originalMessage: msg 
        };
    }
    return { kind: "UNKNOWN", message: msg };
}
