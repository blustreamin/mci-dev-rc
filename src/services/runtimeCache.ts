
/**
 * RuntimeCache Service
 * Provides a deterministic mechanism to invalidate in-memory caches and force re-fetches
 * across the application without reloading the page.
 */
export const RuntimeCache = {
    _epoch: Date.now(),
    _listeners: new Set<() => void>(),

    /**
     * Returns the current cache epoch timestamp.
     */
    get epoch() {
        return this._epoch;
    },

    /**
     * Bumps the epoch and notifies all listeners to refresh.
     */
    bump(reason: string) {
        this._epoch = Date.now();
        console.log(`[CACHE] BUMP reason=${reason} epoch=${this._epoch}`);
        this.notifyListeners();
    },

    /**
     * Appends the current epoch to a URL to bust browser/network caches.
     * Useful for GET requests.
     */
    attachEpoch(url: string) {
        const separator = url.includes('?') ? '&' : '?';
        return `${url}${separator}cacheEpoch=${this._epoch}`;
    },

    /**
     * Subscribe to cache reset events.
     * Returns a cleanup function.
     */
    subscribe(callback: () => void) {
        this._listeners.add(callback);
        return () => {
            this._listeners.delete(callback);
        };
    },

    notifyListeners() {
        this._listeners.forEach(cb => {
            try { cb(); } catch (e) { console.error("Cache listener error", e); }
        });
    },

    /**
     * Triggers a full application-wide reset of cached data.
     */
    resetAll(reason: string) {
        console.group(`[CACHE] RESET_ALL reason=${reason}`);
        this.bump(reason);
        console.groupEnd();
    }
};
