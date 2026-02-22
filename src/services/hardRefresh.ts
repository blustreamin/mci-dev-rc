
export async function hardRefreshApp() {
    console.log("[HARD_REFRESH] Starting...");
    
    // 1. Unregister Service Workers
    if ('serviceWorker' in navigator) {
        try {
            const registrations = await navigator.serviceWorker.getRegistrations();
            for (const registration of registrations) {
                await registration.unregister();
                console.log("[HARD_REFRESH] SW Unregistered");
            }
        } catch (e) {
            console.warn("[HARD_REFRESH] SW cleanup failed", e);
        }
    }

    // 2. Clear Caches
    if ('caches' in window) {
        try {
            const keys = await caches.keys();
            for (const key of keys) {
                await caches.delete(key);
                console.log(`[HARD_REFRESH] Cache deleted: ${key}`);
            }
        } catch (e) {
            console.warn("[HARD_REFRESH] Cache clear failed", e);
        }
    }

    // 3. Clear Storage
    localStorage.clear();
    sessionStorage.clear();
    console.log("[HARD_REFRESH] Storage cleared");

    // 4. Reload (Force Get)
    console.log("[HARD_REFRESH] Reloading...");
    window.location.reload();
}
