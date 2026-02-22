import { StorageAdapter } from './storageAdapter';

const MIGRATION_FLAG = 'mci_v1_migrated_idb';

export async function migrateLocalStorageToIDB() {
    // 1. Check if already migrated
    const isMigrated = await StorageAdapter.get(MIGRATION_FLAG);
    if (isMigrated) return;

    // 2. Check if there is data to migrate
    if (localStorage.length === 0) {
        await StorageAdapter.set(MIGRATION_FLAG, true);
        return;
    }

    console.log("Starting migration from LocalStorage to IndexedDB...");

    try {
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k) keys.push(k);
        }

        for (const key of keys) {
            const rawVal = localStorage.getItem(key);
            if (rawVal) {
                try {
                    // Try parsing JSON, otherwise store as string
                    const parsed = JSON.parse(rawVal);
                    await StorageAdapter.set(key, parsed);
                } catch (e) {
                    await StorageAdapter.set(key, rawVal);
                }
            }
        }

        // 4. Verification & Cleanup
        await StorageAdapter.set(MIGRATION_FLAG, true);
        localStorage.clear();
        console.log(`Migration complete. Moved ${keys.length} items.`);

    } catch (e) {
        console.error("Migration failed. Data remains in localStorage.", e);
        // Do not set migration flag so we try again next time
    }
}