
import { 
    collection, 
    query, 
    where, 
    orderBy, 
    limit, 
    startAfter, 
    getDocs, 
    Timestamp, 
    QueryDocumentSnapshot,
    QueryConstraint
} from 'firebase/firestore';
import { FirestoreClient } from './firestoreClient';
import { getSignalHarvesterCollection } from '../config/signalHarvesterConfig';
import { classifyFirestoreError, FsQueryError } from '../utils/firestoreErrorUtils';

export type Mcisignal = {
  id: string;
  title: string;
  snippet: string;
  url: string;
  // Canonical fields
  categoryId: string; 
  platform: string;
  source: string;
  signalType: string;
  trustScore: number;
  confidence: number;
  // Timestamps
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  // Legacy compat
  category?: string;
  collectedAt?: string;
  // Meta
  enrichmentStatus?: string;
};

export type SignalDTO = Mcisignal;

export type SignalFetchParams = {
  categoryId: string;
  monthKey?: string;        // YYYY-MM
  limit?: number;           // default 90
  minTrustScore?: number;   // default 70
  platform?: string;        // optional
  maxPool?: number;         // default 600
};

/**
 * CANONICAL QUERY HELPER
 * Enforces the Single Source of Truth for Signal reading.
 * 
 * REQUIRED COMPOSITE INDEX (signal_harvester_v2):
 * Fields:
 *  - categoryId (ASC)
 *  - trusted (ASC)
 *  - lastSeenAt (DESC)
 *  - __name__ (DESC)
 */
function createCanonicalQuery(db: any, collectionName: string, categoryId: string, limitVal: number) {
    console.debug(`[SignalHarvester] Constructing CANONICAL Query: col=${collectionName} cat=${categoryId} trusted=true sort=lastSeenAt limit=${limitVal}`);
    
    return query(
        collection(db, collectionName),
        where('categoryId', '==', categoryId),
        where('trusted', '==', true), // STRICT CONSTRAINT
        orderBy('lastSeenAt', 'desc'),
        limit(limitVal)
    );
}

export const SignalHarvesterClient = {
  getCollectionName(): string {
    return getSignalHarvesterCollection();
  },

  resolveSignalCollection(): string {
    return getSignalHarvesterCollection();
  },

  /**
   * Robust fetcher for Signal Harvester v2.
   * Performs broad query then strict in-memory filtering.
   */
  async fetchHarvesterSignalsBounded(params: SignalFetchParams): Promise<{
    signals: SignalDTO[];
    metadata: {
      fetched: number;
      enrichedOk: number;
      trustedOk: number;
      windowOk: number;
      mode: 'EXACT_MONTH' | 'GLOBAL_BACKFILL' | 'EMPTY' | 'INDEX_FAIL' | 'DB_FAIL';
      error?: string;
      errorDetails?: FsQueryError;
    };
  }> {
    const db = FirestoreClient.getDbSafe();
    if (!db) throw new Error("DB_INIT_FAIL");

    const colName = getSignalHarvesterCollection();
    const maxPool = params.maxPool || 600;
    const minTrust = params.minTrustScore ?? 70;
    const targetLimit = params.limit || 90;

    // 1. Firestore Query (Canonical Only)
    // We do NOT filter by platform here to avoid index explosion. Platform filtering is done in-memory.
    const q = createCanonicalQuery(db, colName, params.categoryId, maxPool);

    let rawDocs: Mcisignal[] = [];
    try {
        const snapshot = await getDocs(q);
        rawDocs = snapshot.docs.map(mapToDTO);
    } catch (e: any) {
        const classified = classifyFirestoreError(e);
        console.error("[SignalHarvester] Canonical Query Failed", classified);
        
        return {
            signals: [],
            metadata: {
                fetched: 0, enrichedOk: 0, trustedOk: 0, windowOk: 0,
                mode: classified.kind === 'INDEX_ERROR' ? 'INDEX_FAIL' : 'DB_FAIL',
                error: classified.kind === 'INDEX_ERROR' ? 'Missing Index' : e.message,
                errorDetails: classified
            }
        };
    }
    
    // 2. In-Memory Pipeline
    let pool = rawDocs;
    const counts = {
        fetched: pool.length,
        enrichedOk: 0,
        trustedOk: 0,
        windowOk: 0,
        mode: 'EMPTY' as 'EXACT_MONTH' | 'GLOBAL_BACKFILL' | 'EMPTY' | 'INDEX_FAIL' | 'DB_FAIL'
    };

    // Filter A: Platform (if requested)
    // Moved from DB query to here
    if (params.platform) {
        const pTarget = params.platform.toLowerCase();
        pool = pool.filter(d => d.platform === pTarget);
    }

    // Filter B: Enrichment Status
    pool = pool.filter(d => {
        // Allow if status is OK. If field missing, assume not OK unless trusted override exists?
        // Canonical schema says: enrichment may be missing unless _meta.enrichmentStatus === 'OK'.
        // We will be strict: must contain meaningful text.
        return d.enrichmentStatus === 'OK' || (d.title && d.snippet && d.title.length > 5);
    });
    counts.enrichedOk = pool.length;

    // Filter C: Trust & Quality
    pool = pool.filter(d => d.trustScore >= minTrust);
    counts.trustedOk = pool.length;

    // Filter D: Month Window (if requested)
    let windowed = pool;
    if (params.monthKey) {
        const [y, m] = params.monthKey.split('-').map(Number);
        const start = new Date(Date.UTC(y, m - 1, 1)).toISOString();
        const end = new Date(Date.UTC(y, m, 1)).toISOString(); // Start of next month

        windowed = pool.filter(d => {
            // Use lastSeenAt (canonical) or fallback to firstSeenAt
            const ts = d.lastSeenAt || d.firstSeenAt;
            return ts && ts >= start && ts < end;
        });
        counts.windowOk = windowed.length;
    } else {
        counts.windowOk = pool.length; // No window applied
    }

    // 3. Selection Strategy
    let finalSelection: SignalDTO[] = [];
    if (windowed.length >= 5) { // Threshold for "enough data"
        counts.mode = 'EXACT_MONTH';
        finalSelection = windowed;
    } else if (pool.length > 0) {
        // Fallback to global pool (recency sorted)
        counts.mode = 'GLOBAL_BACKFILL';
        finalSelection = pool;
    } else {
        counts.mode = 'EMPTY';
    }

    // 4. Stable Sort & Limit
    finalSelection.sort((a, b) => {
        // Primary: Last Seen DESC
        const dateA = a.lastSeenAt || "";
        const dateB = b.lastSeenAt || "";
        const dateCmp = dateB.localeCompare(dateA);
        if (dateCmp !== 0) return dateCmp;
        // Tie-breaker: ID ASC
        return a.id.localeCompare(b.id);
    });

    return {
        signals: finalSelection.slice(0, targetLimit),
        metadata: counts
    };
  },

  /**
   * Dedicated fetcher for Signals Stream UI.
   * Directs query to canonical schema without strict deep-dive windowing constraints.
   */
  async fetchSignalsPage(params: {
      categoryId?: string;
      minTrustScore?: number;
      limit?: number;
      lastDoc?: QueryDocumentSnapshot;
  }): Promise<{ signals: Mcisignal[], lastDoc: QueryDocumentSnapshot | null, empty: boolean, error?: FsQueryError }> {
      const db = FirestoreClient.getDbSafe();
      if (!db) return { signals: [], lastDoc: null, empty: true };

      const colName = getSignalHarvesterCollection();
      const targetCat = params.categoryId;
      const limitVal = params.limit || 50;

      // Diagnostics Log
      console.log(`[SIGNALS_STREAM] query { categoryId: ${targetCat}, minTrust: ${params.minTrustScore}, limit: ${limitVal} }`);

      try {
          const constraints: QueryConstraint[] = [];
          const colRef = collection(db, colName);

          if (targetCat) {
              constraints.push(where('categoryId', '==', targetCat));
          }
          
          // Canonical filter: trusted=true
          // Enforce this to ensure we use the healthy index (categoryId, trusted, lastSeenAt)
          constraints.push(where('trusted', '==', true));

          constraints.push(orderBy('lastSeenAt', 'desc'));
          constraints.push(limit(limitVal));

          if (params.lastDoc) {
              constraints.push(startAfter(params.lastDoc));
          }

          const q = query(colRef, ...constraints);
          const snapshot = await getDocs(q);

          console.log(`[SIGNALS_STREAM] returned=${snapshot.size}`);

          if (snapshot.empty && !params.lastDoc) {
               console.warn(`[SIGNALS_STREAM] Zero results. Checklist:
               - categoryId: ${targetCat} matches?
               - trusted: true exists?
               - Indexes built for (categoryId, trusted, lastSeenAt)?`);
          }

          const signals: Mcisignal[] = snapshot.docs.map(doc => {
              const d = doc.data();
              // Null-safe DTO Mapping
              return {
                  id: doc.id,
                  title: d.title || "",
                  snippet: d.snippet || "",
                  url: d.url || "",
                  platform: (d.platform || "").toLowerCase(),
                  categoryId: d.categoryId || "",
                  source: d.source || "unknown",
                  signalType: d.signalType || "generic",
                  trustScore: typeof d.trustScore === 'number' ? d.trustScore : 0,
                  confidence: typeof d.confidence === 'number' ? d.confidence : 0,
                  firstSeenAt: d.firstSeenAt || null,
                  lastSeenAt: d.lastSeenAt || null,
                  // Legacy/UI helpers
                  category: d.categoryId || "", 
                  collectedAt: d.lastSeenAt || "",
                  enrichmentStatus: d.enrichmentStatus || 'UNKNOWN'
              };
          });

          return {
              signals,
              lastDoc: snapshot.docs[snapshot.docs.length - 1] || null,
              empty: snapshot.empty
          };

      } catch (e: any) {
          const error = classifyFirestoreError(e);
          console.error("[SIGNALS_STREAM] Query Error", error);
          return { signals: [], lastDoc: null, empty: true, error };
      }
  }
};

function mapToDTO(doc: QueryDocumentSnapshot): Mcisignal {
  const d = doc.data();
  const meta = d._meta || {};
  
  const toISO = (ts: any) => {
    if (ts instanceof Timestamp) return ts.toDate().toISOString();
    if (typeof ts === 'string') return ts;
    return null;
  };

  return {
    id: doc.id,
    title: d.title || "",
    snippet: d.snippet || "",
    url: d.url || "",
    categoryId: d.categoryId || d.category || "unknown", // Canonical fallback
    platform: (d.platform || "web").toLowerCase(),
    source: d.source || "unknown",
    signalType: d.signalType || "generic",
    trustScore: typeof d.trustScore === 'number' ? d.trustScore : 0,
    confidence: typeof d.confidence === 'number' ? d.confidence : 0,
    firstSeenAt: toISO(d.firstSeenAt || d.collectedAt),
    lastSeenAt: toISO(d.lastSeenAt || d.collectedAt),
    // Legacy fields for UI compat
    category: d.categoryId || d.category,
    collectedAt: toISO(d.lastSeenAt || d.collectedAt),
    enrichmentStatus: meta.enrichmentStatus || (d.enrichment ? 'OK' : 'PENDING')
  };
}
