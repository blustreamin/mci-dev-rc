import { StorageAdapter } from './storageAdapter';

// Environment variables must be set in build
// Safe fallback for browser environment where process is undefined or null
const safeProcess = (typeof process !== 'undefined' && process && process.env) 
    ? process 
    : { env: {} as Record<string, string | undefined> };

const API_URL = safeProcess.env.REACT_APP_SNAPSHOT_API_URL || 'http://localhost:8080';
const API_KEY = safeProcess.env.REACT_APP_SNAPSHOT_API_KEY || 'dev-key';

export interface SnapshotMeta {
  id: string;
  name: string;
  createdTime: string;
  size: string;
}

export const SnapshotService = {
  /**
   * Dumps IDB, Compresses (GZIP), and Streams to Cloud Run
   */
  async exportSnapshot(): Promise<string> {
    if (typeof CompressionStream === 'undefined') {
        throw new Error("Your browser does not support snapshot compression. Please use Chrome/Edge/Firefox.");
    }

    // 1. Get Data
    const data = await StorageAdapter.dumpAll();
    const jsonString = JSON.stringify(data);
    
    // 2. Compress
    const stream = new Blob([jsonString]).stream();
    const compressedStream = stream.pipeThrough(new CompressionStream('gzip'));
    const compressedResponse = new Response(compressedStream);
    const blob = await compressedResponse.blob();

    // 3. Name it
    const date = new Date().toISOString().replace(/[:.]/g, '-');
    const randomSuffix = Math.random().toString(36).substring(2, 6);
    const filename = `MCI_Snapshot_${date}_${randomSuffix}.json.gz`;

    // 4. Upload
    const res = await fetch(`${API_URL}/snapshots`, {
      method: 'POST',
      headers: {
        'X-API-Key': API_KEY,
        'X-Filename': filename,
        'Content-Type': 'application/gzip'
      },
      body: blob
    });

    if (!res.ok) {
        let errDetails = res.statusText;
        try {
            const err = await res.json();
            errDetails = err.error || res.statusText;
        } catch (e) {}
        throw new Error(`Upload Failed: ${errDetails}`);
    }

    const result = await res.json();
    return result.fileId;
  },

  /**
   * Lists available snapshots from Shared Drive
   */
  async listSnapshots(): Promise<SnapshotMeta[]> {
    const res = await fetch(`${API_URL}/snapshots`, {
        headers: { 'X-API-Key': API_KEY }
    });
    if (!res.ok) throw new Error("Failed to list snapshots");
    return await res.json();
  },

  /**
   * Downloads, Decompresses, and Restores to IDB
   */
  async restoreSnapshot(fileId: string): Promise<void> {
     if (typeof DecompressionStream === 'undefined') {
        throw new Error("Your browser does not support snapshot decompression.");
    }

    // 1. Download
    const res = await fetch(`${API_URL}/snapshots/${fileId}`, {
        headers: { 'X-API-Key': API_KEY }
    });
    if (!res.ok) throw new Error("Download failed");

    // 2. Decompress
    const blob = await res.blob();
    const ds = new DecompressionStream('gzip');
    const decompressedStream = blob.stream().pipeThrough(ds);
    const decompressedRes = new Response(decompressedStream);
    const json = await decompressedRes.json();

    // 3. Restore Transactionally
    await StorageAdapter.importJson(json);
    
    // 4. Reload to pick up new state
    window.location.reload();
  }
};