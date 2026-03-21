/**
 * PlatformDB — IndexedDB Storage Layer for Urchin Platform
 * 
 * Replaces Firestore and localStorage for all platform-v1 data.
 * Each project's data is scoped by projectId/categoryId.
 * 
 * Object Stores:
 * - projects: ProjectDefinition objects
 * - categories: AI-generated CategoryBaseline configs
 * - corpus: Keyword corpora (synthetic rows from category generation)
 * - strategy_outputs: Consumer Need Analysis results
 * - demand_outputs: Demand sweep results
 * - deep_dive_outputs: Deep dive reports
 * - app_state: General app state (active gear, selections, etc.)
 */

const DB_NAME = 'urchin_platform';
const DB_VERSION = 1;

const STORES = {
    PROJECTS: 'projects',
    CATEGORIES: 'categories',
    CORPUS: 'corpus',
    STRATEGY: 'strategy_outputs',
    DEMAND: 'demand_outputs',
    DEEP_DIVE: 'deep_dive_outputs',
    APP_STATE: 'app_state',
    CACHE: 'cache',
} as const;

type StoreName = typeof STORES[keyof typeof STORES];

// --- DB INITIALIZATION ---

let dbInstance: IDBDatabase | null = null;
let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
    if (dbInstance) return Promise.resolve(dbInstance);
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            
            // Create all stores if they don't exist
            Object.values(STORES).forEach(storeName => {
                if (!db.objectStoreNames.contains(storeName)) {
                    db.createObjectStore(storeName);
                }
            });

            console.log(`[PlatformDB] Database upgraded to v${DB_VERSION}`);
        };

        request.onsuccess = (event) => {
            dbInstance = (event.target as IDBOpenDBRequest).result;
            
            // Handle unexpected close
            dbInstance.onclose = () => {
                dbInstance = null;
                dbPromise = null;
            };

            console.log(`[PlatformDB] Database opened: ${DB_NAME} v${DB_VERSION}`);
            resolve(dbInstance);
        };

        request.onerror = (event) => {
            console.error('[PlatformDB] Failed to open database', (event.target as IDBOpenDBRequest).error);
            dbPromise = null;
            reject((event.target as IDBOpenDBRequest).error);
        };
    });

    return dbPromise;
}

// --- CORE OPERATIONS ---

async function getFromStore<T>(storeName: StoreName, key: string): Promise<T | null> {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result ?? null);
            request.onerror = () => {
                console.warn(`[PlatformDB] get failed: ${storeName}/${key}`, request.error);
                resolve(null);
            };
        });
    } catch (e) {
        console.warn(`[PlatformDB] get error: ${storeName}/${key}`, e);
        return null;
    }
}

async function putToStore<T>(storeName: StoreName, key: string, value: T): Promise<boolean> {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.put(value, key);
            request.onsuccess = () => resolve(true);
            request.onerror = () => {
                console.warn(`[PlatformDB] put failed: ${storeName}/${key}`, request.error);
                resolve(false);
            };
        });
    } catch (e) {
        console.warn(`[PlatformDB] put error: ${storeName}/${key}`, e);
        return false;
    }
}

async function deleteFromStore(storeName: StoreName, key: string): Promise<boolean> {
    try {
        const db = await openDB();
        return new Promise((resolve) => {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.delete(key);
            request.onsuccess = () => resolve(true);
            request.onerror = () => resolve(false);
        });
    } catch (e) {
        return false;
    }
}

async function getAllFromStore<T>(storeName: StoreName): Promise<{ key: string; value: T }[]> {
    try {
        const db = await openDB();
        return new Promise((resolve) => {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const results: { key: string; value: T }[] = [];
            
            const request = store.openCursor();
            request.onsuccess = (event) => {
                const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
                if (cursor) {
                    results.push({ key: cursor.key as string, value: cursor.value });
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
            request.onerror = () => resolve([]);
        });
    } catch (e) {
        return [];
    }
}

async function clearStore(storeName: StoreName): Promise<boolean> {
    try {
        const db = await openDB();
        return new Promise((resolve) => {
            const tx = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.clear();
            request.onsuccess = () => resolve(true);
            request.onerror = () => resolve(false);
        });
    } catch (e) {
        return false;
    }
}

// --- PUBLIC API ---

export const PlatformDB = {

    STORES,

    // --- PROJECTS ---
    
    async saveProject(project: any): Promise<boolean> {
        return putToStore(STORES.PROJECTS, project.projectId, project);
    },

    async getProject(projectId: string): Promise<any | null> {
        return getFromStore(STORES.PROJECTS, projectId);
    },

    async getAllProjects(): Promise<any[]> {
        const all = await getAllFromStore(STORES.PROJECTS);
        return all.map(r => r.value);
    },

    async deleteProject(projectId: string): Promise<boolean> {
        return deleteFromStore(STORES.PROJECTS, projectId);
    },

    // --- CATEGORIES ---

    async saveCategory(categoryId: string, category: any): Promise<boolean> {
        return putToStore(STORES.CATEGORIES, categoryId, {
            ...category,
            savedAt: new Date().toISOString()
        });
    },

    async getCategory(categoryId: string): Promise<any | null> {
        return getFromStore(STORES.CATEGORIES, categoryId);
    },

    // --- CORPUS (Keyword rows for a category) ---

    async saveCorpus(categoryId: string, rows: any[]): Promise<boolean> {
        return putToStore(STORES.CORPUS, categoryId, {
            categoryId,
            rows,
            rowCount: rows.length,
            savedAt: new Date().toISOString()
        });
    },

    async getCorpus(categoryId: string): Promise<{ rows: any[]; rowCount: number } | null> {
        return getFromStore(STORES.CORPUS, categoryId);
    },

    async clearCorpus(categoryId: string): Promise<boolean> {
        return deleteFromStore(STORES.CORPUS, categoryId);
    },

    // --- STRATEGY OUTPUTS ---

    async saveStrategyOutput(categoryId: string, output: any): Promise<boolean> {
        return putToStore(STORES.STRATEGY, categoryId, {
            categoryId,
            output,
            savedAt: new Date().toISOString()
        });
    },

    async getStrategyOutput(categoryId: string): Promise<any | null> {
        const doc = await getFromStore<any>(STORES.STRATEGY, categoryId);
        return doc?.output ?? null;
    },

    // --- DEMAND OUTPUTS ---

    async saveDemandOutput(categoryId: string, month: string, output: any): Promise<boolean> {
        const key = `${categoryId}__${month}`;
        return putToStore(STORES.DEMAND, key, {
            categoryId,
            month,
            output,
            savedAt: new Date().toISOString()
        });
    },

    async getDemandOutput(categoryId: string, month: string): Promise<any | null> {
        const key = `${categoryId}__${month}`;
        const doc = await getFromStore<any>(STORES.DEMAND, key);
        return doc?.output ?? null;
    },

    // --- DEEP DIVE OUTPUTS ---

    async saveDeepDiveOutput(categoryId: string, month: string, output: any): Promise<boolean> {
        const key = `${categoryId}__${month}`;
        return putToStore(STORES.DEEP_DIVE, key, {
            categoryId,
            month,
            output,
            savedAt: new Date().toISOString()
        });
    },

    async getDeepDiveOutput(categoryId: string, month: string): Promise<any | null> {
        const key = `${categoryId}__${month}`;
        const doc = await getFromStore<any>(STORES.DEEP_DIVE, key);
        return doc?.output ?? null;
    },

    // --- APP STATE (replaces localStorage for app-level state) ---

    async saveAppState(state: any): Promise<boolean> {
        return putToStore(STORES.APP_STATE, 'current', {
            state,
            savedAt: new Date().toISOString()
        });
    },

    async getAppState(): Promise<any | null> {
        const doc = await getFromStore<any>(STORES.APP_STATE, 'current');
        return doc?.state ?? null;
    },

    // --- CACHE (generic key-value with TTL) ---

    async setCache(key: string, data: any, ttlMs: number = 7 * 24 * 60 * 60 * 1000): Promise<boolean> {
        return putToStore(STORES.CACHE, key, {
            data,
            timestamp: Date.now(),
            ttl: ttlMs
        });
    },

    async getCache<T>(key: string): Promise<T | null> {
        const entry = await getFromStore<any>(STORES.CACHE, key);
        if (!entry) return null;
        if (Date.now() - entry.timestamp > entry.ttl) {
            await deleteFromStore(STORES.CACHE, key);
            return null;
        }
        return entry.data as T;
    },

    // --- BULK OPERATIONS ---

    async clearAll(): Promise<void> {
        await Promise.all(Object.values(STORES).map(s => clearStore(s)));
        console.log('[PlatformDB] All stores cleared');
    },

    async clearProjectData(projectId: string): Promise<void> {
        // Clear category, corpus, and outputs for a specific project
        // This requires knowing the categoryId — get it from the project first
        const project = await getFromStore<any>(STORES.PROJECTS, projectId);
        if (project?.generatedCategory?.id) {
            const catId = project.generatedCategory.id;
            await deleteFromStore(STORES.CATEGORIES, catId);
            await deleteFromStore(STORES.CORPUS, catId);
            await deleteFromStore(STORES.STRATEGY, catId);
            // Demand and deep dive have month-keyed entries — we'd need to iterate
            // For now, just clear the project record
        }
        await deleteFromStore(STORES.PROJECTS, projectId);
        console.log(`[PlatformDB] Cleared data for project: ${projectId}`);
    },

    // --- DIAGNOSTICS ---

    async getDiagnostics(): Promise<Record<string, number>> {
        const counts: Record<string, number> = {};
        for (const [name, storeName] of Object.entries(STORES)) {
            const all = await getAllFromStore(storeName);
            counts[name] = all.length;
        }
        return counts;
    }
};
