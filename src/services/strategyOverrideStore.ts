
import { StorageAdapter } from './storageAdapter';
import { StrategyOverride } from '../../types';

export const StrategyOverrideStore = {
    async getOverride(categoryId: string): Promise<StrategyOverride | null> {
        return await StorageAdapter.get<StrategyOverride>(categoryId, StorageAdapter.STORES.OVERRIDE);
    },

    async setOverride(override: StrategyOverride): Promise<void> {
        await StorageAdapter.set(override.categoryId, override, StorageAdapter.STORES.OVERRIDE);
    },

    async clearOverride(categoryId: string): Promise<void> {
        await StorageAdapter.remove(categoryId, StorageAdapter.STORES.OVERRIDE);
    }
};
