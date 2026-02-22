
export interface StrategyPlan {
    version: "v1";
    category_id: string;
    frozen_at_iso: string;
    anchors: string[]; // DISPLAY NAMES ONLY
}

const STORAGE_KEY = 'mci_strategy_plan_v1';
const META_KEY = 'mci_strategy_plan_last_updated_iso';

export const StrategyPlanStore = {
    getPlan(categoryId: string): StrategyPlan | null {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            const data = JSON.parse(raw);
            return data[categoryId] || null;
        } catch (e) {
            return null;
        }
    },

    setPlan(categoryId: string, plan: StrategyPlan): void {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            const data = raw ? JSON.parse(raw) : {};
            data[categoryId] = plan;
            const now = new Date().toISOString();
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
            localStorage.setItem(META_KEY, now);
        } catch (e) {}
    },

    clearPlan(categoryId?: string): void {
        try {
            if (!categoryId) {
                localStorage.removeItem(STORAGE_KEY);
                localStorage.removeItem(META_KEY);
            } else {
                const raw = localStorage.getItem(STORAGE_KEY);
                if (raw) {
                    const data = JSON.parse(raw);
                    delete data[categoryId];
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
                }
            }
        } catch (e) {}
    },

    getPlanStats(): { categories: number; lastUpdatedIso: string | null } {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            const last = localStorage.getItem(META_KEY);
            if (!raw) return { categories: 0, lastUpdatedIso: last };
            const data = JSON.parse(raw);
            return { categories: Object.keys(data).length, lastUpdatedIso: last };
        } catch (e) {
            return { categories: 0, lastUpdatedIso: null };
        }
    }
};
