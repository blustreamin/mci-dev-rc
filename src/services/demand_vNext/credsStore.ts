
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { FirestoreClient } from '../firestoreClient';

const FLAGS_KEY = 'mci_runtime_flags_v1';
const SETTINGS_DOC_PATH = 'project_settings/dfs';

// Safe env access helper
const getEnv = (key: string) => {
    if (typeof process !== 'undefined' && process.env && process.env[key]) return process.env[key];
    if ((import.meta as any).env && (import.meta as any).env[key]) return (import.meta as any).env[key];
    return undefined;
};

export interface DfsRuntimeConfig {
    mode: 'PROXY' | 'DIRECT';
    proxyUrl: string | null;
    login: string | null;
    password: string | null;
    googlePath: string;
    amazonPath: string;
    source: {
        proxyUrl: string;
        creds: string;
    };
}

export const CredsStore = {
    /**
     * Get raw runtime flags from storage.
     */
    getRuntimeFlags(): Record<string, string> {
        try {
            return JSON.parse(localStorage.getItem(FLAGS_KEY) || '{}');
        } catch { 
            return {}; 
        }
    },

    /**
     * Merge updates into runtime flags storage.
     */
    setRuntimeFlags(updates: Record<string, string | null>) {
        const current = this.getRuntimeFlags();
        Object.keys(updates).forEach(k => {
            if (updates[k] === null) delete current[k];
            else current[k] = updates[k]!;
        });
        localStorage.setItem(FLAGS_KEY, JSON.stringify(current));
    },

    /**
     * Persists DFS settings to Firestore for background job accessibility.
     */
    async persistToFirestore(data: { login?: string; password?: string; proxyUrl?: string }): Promise<void> {
        const db = FirestoreClient.getDbSafe();
        if (!db) throw new Error("DB_UNAVAILABLE");
        
        const docRef = doc(db, SETTINGS_DOC_PATH);
        await setDoc(docRef, {
            ...data,
            updatedAt: new Date().toISOString(),
            updatedBy: 'UI_CREDENTIALS_MODAL'
        }, { merge: true });
    },

    /**
     * RESOLVE DFS CONFIG (The Source of Truth)
     * Priorities: 
     * 1. runtimeFlags (localStorage)
     * 2. Firestore (project_settings/dfs)
     * 3. Environment Fallbacks
     */
    async resolveDfsConfig(): Promise<DfsRuntimeConfig> {
        const flags = this.getRuntimeFlags();
        const db = FirestoreClient.getDbSafe();
        
        let remoteSettings: any = null;
        if (db) {
            try {
                const snap = await getDoc(doc(db, SETTINGS_DOC_PATH));
                if (snap.exists()) remoteSettings = snap.data();
            } catch (e) {
                console.warn("[CREDS_STORE] Firestore settings unreachable", e);
            }
        }

        // 1. Proxy URL Resolution
        let proxyUrl = flags.dfsProxyUrl || remoteSettings?.proxyUrl || null;
        let proxySource = flags.dfsProxyUrl ? 'runtimeFlags' : (remoteSettings?.proxyUrl ? 'firestore' : 'none');

        if (!proxyUrl) {
            const envUrl = getEnv('VITE_PROXY_URL') || getEnv('PROXY_URL');
            if (envUrl) {
                proxyUrl = envUrl;
                proxySource = 'env';
            }
        }

        // 2. Credentials Resolution
        let login = flags.dfsLogin || remoteSettings?.login || null;
        let password = flags.dfsPassword || remoteSettings?.password || null;
        let credsSource = (flags.dfsLogin && flags.dfsPassword) ? 'runtimeFlags' : (remoteSettings?.login ? 'firestore' : 'none');

        if (!login || !password) {
            const envLogin = getEnv('VITE_DATAFORSEO_LOGIN') || getEnv('DATAFORSEO_LOGIN');
            const envPass = getEnv('VITE_DATAFORSEO_PASSWORD') || getEnv('DATAFORSEO_PASSWORD');
            if (envLogin && envPass) {
                login = envLogin;
                password = envPass;
                credsSource = 'env';
            }
        }

        const mode = (proxyUrl && proxyUrl.trim().length > 0) ? 'PROXY' : 'DIRECT';

        return {
            mode,
            proxyUrl,
            login,
            password,
            googlePath: 'keywords_data/google_ads/search_volume/live',
            amazonPath: 'dataforseo_labs/amazon/bulk_search_volume/live',
            source: {
                proxyUrl: proxySource,
                creds: credsSource
            }
        };
    },

    // --- COMPATIBILITY LAYER ---
    async get(): Promise<{ login: string; password: string; source: string } | null> {
        const config = await this.resolveDfsConfig();
        if (config.login && config.password) {
            return { login: config.login, password: config.password, source: config.source.creds };
        }
        return null;
    },

    async getProxyConfig(): Promise<{ url: string; source: string } | null> {
        const config = await this.resolveDfsConfig();
        if (config.proxyUrl) {
            return { url: config.proxyUrl, source: config.source.proxyUrl };
        }
        return null;
    }
};
