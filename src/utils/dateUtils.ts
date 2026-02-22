
export const DateUtils = {
    /**
     * Returns current Month Window ID (YYYY-MM) in UTC.
     */
    getCurrentMonthKey(): string {
        const now = new Date();
        const y = now.getUTCFullYear();
        const m = String(now.getUTCMonth() + 1).padStart(2, '0');
        return `${y}-${m}`;
    },

    /**
     * Resolves the target month key based on priority.
     * 1. targetMonth (UI Selection)
     * 2. snapshotMonth (Context)
     * 3. Current Month (Fallback)
     */
    resolveMonthKey(input?: { targetMonth?: string; snapshotMonth?: string }): string {
        if (input?.targetMonth) return input.targetMonth;
        // Validate snapshotMonth format if present
        if (input?.snapshotMonth && /^\d{4}-\d{2}$/.test(input.snapshotMonth)) {
            return input.snapshotMonth;
        }
        return this.getCurrentMonthKey();
    },

    /**
     * Returns the previous month key (YYYY-MM).
     */
    getPreviousMonthKey(monthKey: string): string {
        try {
            const [y, m] = monthKey.split('-').map(Number);
            const date = new Date(Date.UTC(y, m - 1 - 1, 1)); // Month is 0-indexed in Date constructor
            const ny = date.getUTCFullYear();
            const nm = String(date.getUTCMonth() + 1).padStart(2, '0');
            return `${ny}-${nm}`;
        } catch (e) {
            return this.getCurrentMonthKey(); // Fail safe
        }
    }
};
