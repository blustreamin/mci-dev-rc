
import { StorageAdapter } from './storageAdapter';

const WINDOW_META_PREFIX = 'window_meta::';
const POINTER_LATEST_STABLE = 'pointer::latest_stable_snapshot';
const POINTER_MANGOOLS_LATEST = 'pointer::mangools_latest';

export interface WindowMeta {
    id: string;
    sealed: boolean;
    sealedAt: string;
    stats?: {
        keywordsSeeded: number;
        coveragePercent?: number;
        injectionSource?: string;
        injectionSourceSnapshot?: string;
    };
}

export interface TruthResolution {
    windowId: string;
    source: 'MANGOOLS' | 'MANUAL_STABLE' | 'WEEKLY_FALLBACK' | 'CSV_SEED';
    isSealed: boolean;
    dataAgeDays: number;
}

export const WindowingService = {
    /**
     * Returns current Month Window ID (YYYY-MM).
     * Used for Monthly Master Seed operations.
     */
    getCurrentMonthWindowId(): string {
        const date = new Date();
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        return `${year}-${month}`;
    },

    /**
     * Returns the current ISO Week ID (e.g., "2024-W22").
     */
    getActiveWindowId(): string {
        const date = new Date();
        const year = date.getFullYear();
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const dayNum = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
        const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1)/7);
        return `${year}-W${weekNo.toString().padStart(2, '0')}`;
    },

    async isWindowSealed(windowId: string): Promise<boolean> {
        const meta = await StorageAdapter.get<WindowMeta>(WINDOW_META_PREFIX + windowId);
        return !!meta?.sealed;
    },

    async getWindowMeta(windowId: string): Promise<WindowMeta | null> {
        return await StorageAdapter.get<WindowMeta>(WINDOW_META_PREFIX + windowId);
    },

    async sealWindow(windowId: string, stats?: WindowMeta['stats']): Promise<void> {
        await StorageAdapter.set(WINDOW_META_PREFIX + windowId, {
            id: windowId,
            sealed: true,
            sealedAt: new Date().toISOString(),
            stats
        });
    },

    async setLatestStableWindowId(windowId: string): Promise<void> {
        await StorageAdapter.set(POINTER_LATEST_STABLE, windowId);
    },

    async getLatestStableWindowId(): Promise<string | null> {
        return await StorageAdapter.get<string>(POINTER_LATEST_STABLE);
    },

    async setMangoolsPointer(windowId: string): Promise<void> {
        await StorageAdapter.set(POINTER_MANGOOLS_LATEST, windowId);
        await this.setLatestStableWindowId(windowId);
    },

    async resolveTruth(): Promise<TruthResolution> {
        // Priority logic handles in callers typically, but for global resolution:
        const mangoolsId = await StorageAdapter.get<string>(POINTER_MANGOOLS_LATEST);
        if (mangoolsId) {
            const meta = await this.getWindowMeta(mangoolsId);
            if (meta) {
                const age = (Date.now() - new Date(meta.sealedAt).getTime()) / (1000 * 60 * 60 * 24);
                return {
                    windowId: mangoolsId,
                    source: 'MANGOOLS',
                    isSealed: true,
                    dataAgeDays: Math.floor(age)
                };
            }
        }

        const stableId = await StorageAdapter.get<string>(POINTER_LATEST_STABLE);
        if (stableId) {
            const meta = await this.getWindowMeta(stableId);
            if (meta) {
                const age = (Date.now() - new Date(meta.sealedAt).getTime()) / (1000 * 60 * 60 * 24);
                return {
                    windowId: stableId,
                    source: 'MANUAL_STABLE',
                    isSealed: true,
                    dataAgeDays: Math.floor(age)
                };
            }
        }

        return {
            windowId: this.getActiveWindowId(),
            source: 'WEEKLY_FALLBACK',
            isSealed: false,
            dataAgeDays: 0
        };
    },

    async getEffectiveWindowId(): Promise<string> {
        const resolution = await this.resolveTruth();
        return resolution.windowId;
    }
};
