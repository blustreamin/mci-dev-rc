
import { doc, setDoc, getDoc, updateDoc, collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { FirestoreClient } from './firestoreClient';
import { BatchCertificationJob, BatchVerificationJob } from '../types';
import { sanitizeForFirestore } from '../utils/firestoreSanitize';

const CERT_COLLECTION = 'batch_certification_jobs';
const VERIFY_COLLECTION = 'batch_verification_jobs';

export const BatchJobStore = {
    
    // --- CERTIFICATION ---
    async createJob(job: BatchCertificationJob): Promise<void> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return;
        await setDoc(doc(db, CERT_COLLECTION, job.jobId), sanitizeForFirestore(job));
    },

    async updateJob(jobId: string, patch: Partial<BatchCertificationJob>): Promise<void> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return;
        
        const updates = {
            ...patch,
            updatedAtIso: new Date().toISOString()
        };
        await updateDoc(doc(db, CERT_COLLECTION, jobId), sanitizeForFirestore(updates));
    },

    async getJob(jobId: string): Promise<BatchCertificationJob | null> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return null;
        try {
            const snap = await getDoc(doc(db, CERT_COLLECTION, jobId));
            return snap.exists() ? (snap.data() as BatchCertificationJob) : null;
        } catch (e) {
            console.error("BatchJobStore getJob failed", e);
            return null;
        }
    },

    async getLatestJob(): Promise<BatchCertificationJob | null> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return null;
        try {
            const q = query(collection(db, CERT_COLLECTION), orderBy('startedAtIso', 'desc'), limit(1));
            const snap = await getDocs(q);
            if (snap.empty) return null;
            return snap.docs[0].data() as BatchCertificationJob;
        } catch (e) {
            console.error("BatchJobStore getLatestJob failed", e);
            return null;
        }
    },

    // --- VERIFICATION (LITE) ---
    async createVerificationJob(job: BatchVerificationJob): Promise<void> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return;
        await setDoc(doc(db, VERIFY_COLLECTION, job.jobId), sanitizeForFirestore(job));
    },

    async updateVerificationJob(jobId: string, patch: Partial<BatchVerificationJob>): Promise<void> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return;
        
        const updates = {
            ...patch,
            updatedAtIso: new Date().toISOString()
        };
        await updateDoc(doc(db, VERIFY_COLLECTION, jobId), sanitizeForFirestore(updates));
    },

    async getVerificationJob(jobId: string): Promise<BatchVerificationJob | null> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return null;
        try {
            const snap = await getDoc(doc(db, VERIFY_COLLECTION, jobId));
            return snap.exists() ? (snap.data() as BatchVerificationJob) : null;
        } catch (e) {
            console.error("BatchJobStore getVerificationJob failed", e);
            return null;
        }
    },

    async getLatestVerificationJob(): Promise<BatchVerificationJob | null> {
        const db = FirestoreClient.getDbSafe();
        if (!db) return null;
        try {
            const q = query(collection(db, VERIFY_COLLECTION), orderBy('startedAtIso', 'desc'), limit(1));
            const snap = await getDocs(q);
            if (snap.empty) return null;
            return snap.docs[0].data() as BatchVerificationJob;
        } catch (e) {
            console.error("BatchJobStore getLatestVerificationJob failed", e);
            return null;
        }
    }
};
