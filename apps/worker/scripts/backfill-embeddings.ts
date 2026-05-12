import { createServiceClient } from '@duly-noted/db';
import { buildEmbeddingInput } from '@duly-noted/shared';
import { loadEnv } from '../src/env.js';
import { createOpenAIEmbedder } from '../src/embedding/openai.js';

/**
 * One-shot backfill for segments whose parent meetings are already
 * published but whose embedding column is NULL. Reads cloud credentials
 * from .env.local. Generates one embedding per segment via OpenAI and
 * writes it via direct UPDATE — NOT via complete_embedding, which assumes
 * the state-machine path (embedding_inflight -> published) and would
 * fail-loud against an already-published row.
 *
 * Idempotent. Re-running against a fully-backfilled corpus prints "no
 * segments need backfill" and exits 0.
 *
 * Batches inputs in groups of 100 — well under the OpenAI 2048-input-per-
 * call cap; aligns with the AssemblyAI per-call quota practice elsewhere.
 *
 * Invoke with: pnpm -F worker backfill:embeddings
 */

const BATCH_SIZE = 100;

interface SegmentRow {
  id: string;
  title: string;
  description: string;
  transcript_excerpt: string;
}

async function main(): Promise<void> {
  const env = loadEnv();
  const supabase = createServiceClient({
    supabaseUrl: env.SUPABASE_URL,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  });
  const embed = createOpenAIEmbedder(env.OPENAI_API_KEY);

  // Fetch only the segments that need work. The !inner join scopes to
  // published-meeting segments.
  const { data: rawRows, error } = await supabase
    .from('segments')
    .select('id, title, description, transcript_excerpt, meetings!inner(status)')
    .is('embedding', null)
    .eq('meetings.status', 'published')
    .order('id', { ascending: true });
  if (error) {
    throw new Error(`segments fetch failed: ${error.message}`);
  }
  const rows = (rawRows ?? []) as unknown as SegmentRow[];
  if (rows.length === 0) {
    console.log('backfill-embeddings: no segments need backfill');
    return;
  }
  console.log(`backfill-embeddings: ${rows.length} segments queued`);

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const inputs = batch.map((s) =>
      buildEmbeddingInput({
        title: s.title,
        description: s.description,
        transcript_excerpt: s.transcript_excerpt,
      }),
    );
    const embeddings = await embed(inputs);
    if (embeddings.length !== batch.length) {
      throw new Error(
        `batch ${i / BATCH_SIZE}: expected ${batch.length} vectors, got ${embeddings.length}`,
      );
    }
    for (let j = 0; j < batch.length; j += 1) {
      const seg = batch[j]!;
      const vec = embeddings[j]!;
      const literal = `[${vec.join(',')}]`;
      const { error: upErr } = await supabase
        .from('segments')
        .update({ embedding: literal })
        .eq('id', seg.id);
      if (upErr) {
        throw new Error(`update failed for segment ${seg.id}: ${upErr.message}`);
      }
    }
    console.log(
      `backfill-embeddings: processed ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`,
    );
  }

  console.log('backfill-embeddings: done');
}

await main();
