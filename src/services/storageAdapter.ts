
const PREFIX = 'mci_v1_';

// In-memory fallback in case localStorage is blocked or full
const memoryStore = new Map<string, string>();

export const StorageAdapter = {
  async get<T>(key: string, storeName?: string): Promise<T | null> {
    const finalKey = storeName ? `${PREFIX}${storeName}_${key}` : `${PREFIX}${key}`;
    try {
      const val = localStorage.getItem(finalKey);
      if (!val) return null;
      return JSON.parse(val) as T;
    } catch (e: any) {
      console.warn(`[STORAGE_ADAPTER][FALLBACK_MEMORY] op=get key=${finalKey} reason=${String(e?.message || e)}`);
      try {
        const val = memoryStore.get(finalKey);
        if (!val) return null;
        return JSON.parse(val) as T;
      } catch (e2) { return null; }
    }
  },

  /**
   * Retrieves item by full key (including prefix). 
   * Essential for iterating keys returned by getAllKeys().
   */
  async getRaw<T>(fullKey: string): Promise<T | null> {
    try {
      const val = localStorage.getItem(fullKey);
      if (!val) return null;
      return JSON.parse(val) as T;
    } catch (e) {
       // Try memory
       const val = memoryStore.get(fullKey);
       if (!val) return null;
       try { return JSON.parse(val) as T; } catch { return null; }
    }
  },

  async set(key: string, value: any, storeName?: string): Promise<void> {
    const finalKey = storeName ? `${PREFIX}${storeName}_${key}` : `${PREFIX}${key}`;
    const strVal = JSON.stringify(value);
    try {
      localStorage.setItem(finalKey, strVal);
    } catch (e: any) {
      console.warn(`[STORAGE_ADAPTER][FALLBACK_MEMORY] op=set key=${finalKey} reason=${String(e?.message || e)}`);
      memoryStore.set(finalKey, strVal);
    }
  },

  async remove(key: string, storeName?: string): Promise<void> {
    const finalKey = storeName ? `${PREFIX}${storeName}_${key}` : `${PREFIX}${key}`;
    try {
      localStorage.removeItem(finalKey);
    } catch (e: any) {
       console.warn(`[STORAGE_ADAPTER][FALLBACK_MEMORY] op=remove key=${finalKey} reason=${String(e?.message || e)}`);
    }
    memoryStore.delete(finalKey);
  },

  async clear(storeName?: string): Promise<void> {
    try {
        if (!storeName) {
            // Clear all MCI keys
            Object.keys(localStorage).forEach(k => {
                if (k.startsWith(PREFIX)) localStorage.removeItem(k);
            });
            memoryStore.clear();
            return;
        }
        const prefix = `${PREFIX}${storeName}_`;
        Object.keys(localStorage).forEach(k => {
            if (k.startsWith(prefix)) localStorage.removeItem(k);
        });
        
        // Clear memory keys for store
        for (const k of memoryStore.keys()) {
            if (k.startsWith(prefix)) memoryStore.delete(k);
        }
    } catch (e) {
        console.warn("Storage clear failed", e);
    }
  },

  async getAllKeys(storeName?: string): Promise<string[]> {
    const keys: string[] = [];
    const prefix = storeName ? `${PREFIX}${storeName}_` : PREFIX;
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith(prefix)) keys.push(k);
        }
    } catch (e) {}

    // Merge memory keys
    for (const k of memoryStore.keys()) {
        if (k.startsWith(prefix) && !keys.includes(k)) keys.push(k);
    }
    return keys;
  },
  
  // Stubs for compatibility if needed
  STORES: {
      DEFAULT: 'default',
      VALIDITY: 'validity',
      REPORT: 'report',
      OVERRIDE: 'override',
      MAPPING: 'mapping',
      SEED_META: 'seed_meta',
      SEED_KEYWORDS: 'seed_keywords',
      CSV_LOG: 'csv_log',
      STRATEGY_ARTIFACT: 'strategy_artifact',
      DEMAND_ARTIFACT: 'demand_artifact',
      JOB: 'job',
      BACKTEST: 'backtest',
      MASTER_CSV: 'master_csv',
      VOLUME_CACHE: 'volume_cache' // Added
  },
  
  // Stub unused methods
  async dumpAll(): Promise<Record<string, any>> { return {}; },
  async importJson(data: any): Promise<void> { }
};
