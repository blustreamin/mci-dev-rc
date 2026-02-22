
import { CategorySnapshotStore } from './categorySnapshotStore';
import { yieldToUI } from '../utils/yield';

export type SnapshotRowLite = {
  keyword_id?: string; // Added for identification stability
  keyword: string;
  volume: number;
  amazonVolume?: number;
  anchor_id?: string;
  intent_bucket?: string;
  status?: string;
  active?: boolean;
};

export type ChunkSpec = {
  chunkSize: number;
  maxChunks: number;
  seed: string; // Used for deterministic sort tie-breaking if needed (currently vol desc)
};

export async function loadSnapshotRowsLiteChunked(
  categoryId: string,
  snapshotId: string,
  spec: ChunkSpec,
  opts?: { onlyActive?: boolean; onlyValid?: boolean }
): Promise<{ chunks: SnapshotRowLite[][]; totalRows: number }> {
  // 1. Get Chunk IDs (Lightweight metadata fetch)
  // Assuming IN/en as standard for this pipeline
  const chunkIds = await CategorySnapshotStore.getSnapshotChunkIds(
    { categoryId, countryCode: 'IN', languageCode: 'en' }, 
    snapshotId
  );

  let accumulated: SnapshotRowLite[] = [];
  const limit = spec.chunkSize * spec.maxChunks;

  // 2. Iterate and Load Chunks
  for (const chunkId of chunkIds) {
    if (accumulated.length >= limit) break;

    const rows = await CategorySnapshotStore.readSnapshotChunk(
      { categoryId, countryCode: 'IN', languageCode: 'en' }, 
      snapshotId, 
      chunkId
    );

    // Filter & Map to Lite DTO
    for (const r of rows) {
      if (opts?.onlyActive && !r.active) continue;
      if (opts?.onlyValid && (r.volume || 0) === 0) continue;

      accumulated.push({
        keyword_id: r.keyword_id,
        keyword: r.keyword_text,
        volume: r.volume || 0,
        amazonVolume: r.amazonVolume,
        anchor_id: r.anchor_id,
        intent_bucket: r.intent_bucket,
        status: r.status,
        active: r.active
      });
    }

    // Yield control to UI thread after each chunk read
    await yieldToUI();
  }

  // 3. Deterministic Sorting
  // Primary: Volume DESC
  // Secondary: Keyword ASC (Lexicographical)
  accumulated.sort((a, b) => {
    if (b.volume !== a.volume) return b.volume - a.volume;
    return a.keyword.localeCompare(b.keyword);
  });

  // 4. Slice to hard limit
  if (accumulated.length > limit) {
    accumulated = accumulated.slice(0, limit);
  }

  // 5. Partition into Processing Chunks
  const chunks: SnapshotRowLite[][] = [];
  for (let i = 0; i < accumulated.length; i += spec.chunkSize) {
    chunks.push(accumulated.slice(i, i + spec.chunkSize));
  }

  return { chunks, totalRows: accumulated.length };
}
