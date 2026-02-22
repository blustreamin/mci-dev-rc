
import { StorageAdapter } from './storageAdapter';
import { CategoryHydrationStats, CorpusLifecycleState } from '../../types';

const STORE_KEY = 'mci_corpus_hydration_state_v1';

export interface AnchorHydrationStatus {
    anchorName: string;
    demandClass: 'HEAD' | 'MID' | 'LONG';
    target: number;
    generated: number;
    valid: number; // Volume > threshold
    minVolume: number;
    status: 'PENDING' | 'PARTIAL' | 'COMPLETE' | 'FAILED' | 'SKIPPED';
    lastError?: string;
}

// Extend existing types safely
export interface ExtendedCategoryStats extends CategoryHydrationStats {
    categoryId: string; // Explicitly ensure it's here
    anchorsDetail?: Record<string, AnchorHydrationStatus>;
}

const DEFAULT_STATE: CorpusLifecycleState = {
    globalStatus: 'IDLE',
    categories: {},
    lifecycleState: 'SEED'
};

export const CorpusHydrationStore = {
    async getState(): Promise<CorpusLifecycleState> {
        try {
            const raw = localStorage.getItem(STORE_KEY);
            return raw ? JSON.parse(raw) : DEFAULT_STATE;
        } catch (e) {
            return DEFAULT_STATE;
        }
    },

    async setState(patch: Partial<CorpusLifecycleState>): Promise<void> {
        const current = await this.getState();
        const next = { ...current, ...patch };
        try {
            localStorage.setItem(STORE_KEY, JSON.stringify(next));
        } catch (e) {
            console.error("Failed to save hydration state", e);
        }
    },

    async startRun(categoryId: string, anchorsPlanned: number, targetPerAnchor: number): Promise<void> {
        const state = await this.getState();
        const catStats: ExtendedCategoryStats = {
            categoryId, 
            status: 'RUNNING',
            anchorsPlanned,
            anchorsHydrated: 0,
            keywordsGenerated: 0,
            keywordsValidated: 0,
            zeroVolumeCount: 0,
            lastRunAtIso: new Date().toISOString(),
            durationMs: 0,
            targetPerAnchor,
            anchorsDetail: {}
        };
        state.categories[categoryId] = catStats;
        state.globalStatus = 'BUSY';
        await this.setState(state);
    },

    async updateAnchorStatus(categoryId: string, anchorName: string, status: AnchorHydrationStatus): Promise<void> {
        const state = await this.getState();
        const cat = state.categories[categoryId] as ExtendedCategoryStats;
        if (!cat) return;

        if (!cat.anchorsDetail) cat.anchorsDetail = {};
        cat.anchorsDetail[anchorName] = status;

        // Rollup counts
        let totalGen = 0;
        let totalValid = 0;
        let hydratedAnchors = 0;

        Object.values(cat.anchorsDetail).forEach(a => {
            totalGen += a.generated;
            totalValid += a.valid;
            if (a.status === 'COMPLETE' || a.status === 'PARTIAL') hydratedAnchors++;
        });

        cat.keywordsGenerated = totalGen;
        cat.keywordsValidated = totalValid;
        cat.anchorsHydrated = hydratedAnchors;

        await this.setState(state);
    },

    async updateProgress(categoryId: string, progress: Partial<CategoryHydrationStats>): Promise<void> {
        const state = await this.getState();
        if (!state.categories[categoryId]) return;
        
        state.categories[categoryId] = {
            ...state.categories[categoryId],
            ...progress
        };
        await this.setState(state);
    },

    async finishRun(categoryId: string, status: 'COMPLETE' | 'FAILED' | 'PARTIAL', error?: string): Promise<void> {
        const state = await this.getState();
        if (!state.categories[categoryId]) return;

        const cat = state.categories[categoryId];
        cat.status = status;
        if (error) cat.lastError = error;
        cat.durationMs = Date.now() - new Date(cat.lastRunAtIso!).getTime();
        
        state.globalStatus = 'IDLE';
        await this.setState(state);
    },

    async getCategoryStats(categoryId: string): Promise<ExtendedCategoryStats | null> {
        const state = await this.getState();
        return (state.categories[categoryId] as ExtendedCategoryStats) || null;
    },

    async setLifecycleState(lifecycle: CorpusLifecycleState['lifecycleState']): Promise<void> {
        await this.setState({ lifecycleState: lifecycle });
    },

    async setPublished(iso: string, by: string): Promise<void> {
        await this.setState({ publishedAtIso: iso, publishedBy: by });
    }
};
