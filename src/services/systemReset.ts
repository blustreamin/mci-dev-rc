
export const SystemReset = {
    async performHardReset(): Promise<string[]> {
        const logs: string[] = [];
        logs.push(`[${new Date().toISOString()}] Starting Hard Reset (V2.5 Restore)...`);

        // 1. Clear LocalStorage
        try {
            const count = localStorage.length;
            localStorage.clear();
            logs.push(`✅ LocalStorage cleared (${count} items).`);
        } catch (e: any) {
            logs.push(`❌ LocalStorage error: ${e.message}`);
        }

        // 2. Clear IndexedDB
        try {
            if (window.indexedDB && window.indexedDB.databases) {
                const dbs = await window.indexedDB.databases();
                for (const db of dbs) {
                    if (db.name) {
                        await new Promise((resolve, reject) => {
                            const req = window.indexedDB.deleteDatabase(db.name!);
                            req.onsuccess = resolve;
                            req.onerror = resolve; // Proceed even if error
                            req.onblocked = resolve; 
                        });
                        logs.push(`✅ IndexedDB '${db.name}' deleted.`);
                    }
                }
            } else {
                logs.push("⚠️ IndexedDB enumeration not supported in this browser.");
            }
        } catch (e: any) {
             logs.push(`❌ IDB clear error: ${e.message}`);
        }

        // 3. Clear CacheStorage
        try {
            if ('caches' in window) {
                const keys = await caches.keys();
                for (const key of keys) {
                    await caches.delete(key);
                    logs.push(`✅ Cache '${key}' deleted.`);
                }
            }
        } catch (e: any) {
            logs.push(`❌ CacheStorage error: ${e.message}`);
        }

        // 4. Unregister Service Workers
        try {
            if ('serviceWorker' in navigator) {
                const registrations = await navigator.serviceWorker.getRegistrations();
                for (const registration of registrations) {
                    await registration.unregister();
                    logs.push("✅ Service Worker unregistered.");
                }
            }
        } catch (e: any) {
             logs.push(`❌ SW unregister error: ${e.message}`);
        }

        logs.push("✅ System Reset Complete. Reloading...");
        return logs;
    }
};
