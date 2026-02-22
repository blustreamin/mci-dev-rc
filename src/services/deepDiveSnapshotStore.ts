
import { doc, setDoc } from 'firebase/firestore';
import { FirestoreClient } from './firestoreClient';
import { DeepDiveSnapshotDoc } from '../types';
import { sanitizeForFirestore } from '../utils/firestoreSanitize';

export const DeepDiveSnapshotStore = {
    async createDeepDiveSnapshot(
        outputSnapshotId: string,
        categoryId: string,
        country: string,
        lang: string,
        deepDiveData: any
    ): Promise<{ok:true; data:DeepDiveSnapshotDoc} | {ok:false; error:string}> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return { ok: false, error: "FIREBASE_DB_UNAVAILABLE" };

        return FirestoreClient.safe(async () => {
            const snapshotId = `dd_${Date.now()}`;
            const path = `mci_deepdive/${country}/${lang}/${categoryId}/snapshots`;
            const docRef = doc(db, path, snapshotId);

            const docData: DeepDiveSnapshotDoc = {
                snapshot_id: snapshotId,
                output_snapshot_id: outputSnapshotId,
                category_id: categoryId,
                country_code: country,
                language_code: lang,
                created_at_iso: new Date().toISOString(),
                updated_at_iso: new Date().toISOString(),
                lifecycle: 'CERTIFIED',
                deep_dive: deepDiveData,
                integrity: { sha256: 'pending' }
            };

            await setDoc(docRef, sanitizeForFirestore(docData));
            return docData;
        });
    }
};
