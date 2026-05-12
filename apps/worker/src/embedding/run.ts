import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@duly-noted/db';
import { buildEmbeddingInput } from '@duly-noted/shared';
import type { CallEmbedder } from './openai.js';

/**
 * Slice 6 embedding orchestrator. Picks up a meeting at status='embedding'
 * (Slice 4-amended complete_summarization-set), generates one embedding
 * per segment via OpenAI text-embedding-3-small, and atomically writes the
 * embeddings + advances status to 'published' via the complete_embedding
 * RPC. The claim RPC moves the row to the transient 'embedding_inflight'
 * state so re-claim is gated while the embedding API call runs outside
 * the Postgres transaction.
 *
 * On any thrown error after claim, the row is abandoned via
 * abandon_embedding_meeting RPC (status → failed, last_error populated).
 * Per CLAUDE.md §7 there is no automatic retry — the OpenAI client
 * handles transient retries internally; an exception escaping it is
 * terminal.
 */

const claimSegmentSchema = z.object({
  id: z.string().uuid(),
  sequence_order: z.number().int(),
  title: z.string(),
  description: z.string(),
  transcript_excerpt: z.string(),
});

const claimSegmentsSchema = z.array(claimSegmentSchema);

type ClaimSegment = z.infer<typeof claimSegmentSchema>;

export type EmbeddingOutcome =
  | { kind: 'idle' }
  | { kind: 'embedded'; meetingId: string; segmentCount: number }
  | { kind: 'failed'; meetingId: string; message: string };

export interface EmbeddingDeps {
  supabase: SupabaseClient<Database>;
  embed: CallEmbedder;
}

interface ClaimedEmbeddingMeeting {
  id: string;
  segments: ClaimSegment[];
}

async function claimEmbeddingMeeting(
  supabase: SupabaseClient<Database>,
): Promise<ClaimedEmbeddingMeeting | null> {
  const { data, error } = await supabase.rpc('claim_embedding_meeting');
  if (error) {
    throw new Error(`claim_embedding_meeting RPC failed: ${error.message}`);
  }
  if (!data || data.length === 0) return null;
  const row = data[0];
  if (!row) {
    throw new Error('claim_embedding_meeting RPC returned empty row in non-empty data array');
  }
  return {
    id: row.id,
    segments: claimSegmentsSchema.parse(row.segments),
  };
}

async function abandon(
  supabase: SupabaseClient<Database>,
  meetingId: string,
  message: string,
): Promise<void> {
  const { error } = await supabase.rpc('abandon_embedding_meeting', {
    p_meeting_id: meetingId,
    p_error_text: message,
  });
  if (error) {
    // Surface to the tick loop; this is a worker-internal pathology, not a
    // recoverable per-meeting failure.
    throw new Error(`abandon_embedding_meeting RPC failed for ${meetingId}: ${error.message}`);
  }
}

export async function runEmbeddingOnce(deps: EmbeddingDeps): Promise<EmbeddingOutcome> {
  const meeting = await claimEmbeddingMeeting(deps.supabase);
  if (!meeting) return { kind: 'idle' };

  try {
    if (meeting.segments.length === 0) {
      throw new Error('embedding row has no segments');
    }

    const inputs = meeting.segments.map((s) =>
      buildEmbeddingInput({
        title: s.title,
        description: s.description,
        transcript_excerpt: s.transcript_excerpt,
      }),
    );
    const embeddings = await deps.embed(inputs);

    if (embeddings.length !== meeting.segments.length) {
      throw new Error(`expected ${meeting.segments.length} vectors, got ${embeddings.length}`);
    }

    const segmentEmbeddings = meeting.segments.map((s, i) => ({
      segment_id: s.id,
      embedding: embeddings[i]!,
    }));

    const { error: completeErr } = await deps.supabase.rpc('complete_embedding', {
      p_meeting_id: meeting.id,
      p_segment_embeddings: segmentEmbeddings as unknown as Json,
    });
    if (completeErr) {
      throw new Error(`complete_embedding RPC failed: ${completeErr.message}`);
    }

    return { kind: 'embedded', meetingId: meeting.id, segmentCount: meeting.segments.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await abandon(deps.supabase, meeting.id, message);
    return { kind: 'failed', meetingId: meeting.id, message };
  }
}
