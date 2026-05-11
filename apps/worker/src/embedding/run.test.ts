import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@duly-noted/db';
import { EMBEDDING_DIMENSIONS } from '@duly-noted/shared';
import type { CallEmbedder } from './openai.js';
import { runEmbeddingOnce } from './run.js';

interface RpcCall {
  fn: string;
  args: unknown;
}

interface ClaimSegment {
  id: string;
  sequence_order: number;
  title: string;
  description: string;
  transcript_excerpt: string;
}

interface StubOptions {
  claim: { id: string; segments: ClaimSegment[] } | null;
  completeError?: string;
  abandonError?: string;
}

function makeStubClient(options: StubOptions): {
  client: SupabaseClient<Database>;
  rpcCalls: RpcCall[];
} {
  const rpcCalls: RpcCall[] = [];
  const client = {
    rpc(fn: string, args?: unknown) {
      rpcCalls.push({ fn, args });
      if (fn === 'claim_embedding_meeting') {
        return Promise.resolve({
          data: options.claim ? [{ id: options.claim.id, segments: options.claim.segments }] : [],
          error: null,
        });
      }
      if (fn === 'complete_embedding') {
        if (options.completeError) {
          return Promise.resolve({ data: null, error: { message: options.completeError } });
        }
        return Promise.resolve({ data: null, error: null });
      }
      if (fn === 'abandon_embedding_meeting') {
        if (options.abandonError) {
          return Promise.resolve({ data: null, error: { message: options.abandonError } });
        }
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: { message: `unexpected rpc: ${fn}` } });
    },
  } as unknown as SupabaseClient<Database>;
  return { client, rpcCalls };
}

function dummyVector(): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
}

const baseSegments: ClaimSegment[] = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    sequence_order: 0,
    title: 'Call to order',
    description: 'Chair calls the meeting to order.',
    transcript_excerpt: 'This meeting is called to order.',
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    sequence_order: 1,
    title: 'Treasurer report',
    description: 'Monthly financials presented.',
    transcript_excerpt: 'The treasurer presented the report.',
  },
];

describe('runEmbeddingOnce', () => {
  it('returns idle when no embedding row is claimable', async () => {
    const { client } = makeStubClient({ claim: null });
    const embed: CallEmbedder = vi.fn();
    const outcome = await runEmbeddingOnce({ supabase: client, embed });
    expect(outcome).toEqual({ kind: 'idle' });
    expect(embed).not.toHaveBeenCalled();
  });

  it('embeds segments and calls complete_embedding on success', async () => {
    const { client, rpcCalls } = makeStubClient({
      claim: { id: 'meeting-1', segments: baseSegments },
    });
    const embeddings = baseSegments.map(() => dummyVector());
    const embed: CallEmbedder = vi.fn().mockResolvedValueOnce(embeddings);

    const outcome = await runEmbeddingOnce({ supabase: client, embed });

    expect(outcome.kind).toBe('embedded');
    if (outcome.kind === 'embedded') {
      expect(outcome.meetingId).toBe('meeting-1');
      expect(outcome.segmentCount).toBe(2);
    }

    expect(embed).toHaveBeenCalledTimes(1);
    const completeCall = rpcCalls.find((c) => c.fn === 'complete_embedding');
    expect(completeCall).toBeDefined();
    const args = completeCall!.args as {
      p_meeting_id: string;
      p_segment_embeddings: Array<{ segment_id: string; embedding: number[] }>;
    };
    expect(args.p_meeting_id).toBe('meeting-1');
    expect(args.p_segment_embeddings).toHaveLength(2);
    expect(args.p_segment_embeddings[0]!.segment_id).toBe(baseSegments[0]!.id);
    expect(args.p_segment_embeddings[0]!.embedding).toHaveLength(EMBEDDING_DIMENSIONS);
  });

  it('abandons when the claimed meeting has no segments (no embedder call)', async () => {
    const { client, rpcCalls } = makeStubClient({
      claim: { id: 'meeting-2', segments: [] },
    });
    const embed: CallEmbedder = vi.fn();

    const outcome = await runEmbeddingOnce({ supabase: client, embed });

    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') {
      expect(outcome.message).toMatch(/no segments/);
    }
    expect(embed).not.toHaveBeenCalled();
    expect(rpcCalls.some((c) => c.fn === 'complete_embedding')).toBe(false);
    expect(rpcCalls.some((c) => c.fn === 'abandon_embedding_meeting')).toBe(true);
  });

  it('abandons when the embedder throws', async () => {
    const { client, rpcCalls } = makeStubClient({
      claim: { id: 'meeting-3', segments: baseSegments },
    });
    const embed: CallEmbedder = vi.fn().mockRejectedValueOnce(new Error('upstream timeout'));

    const outcome = await runEmbeddingOnce({ supabase: client, embed });

    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') {
      expect(outcome.message).toMatch(/upstream timeout/);
    }
    const abandon = rpcCalls.find((c) => c.fn === 'abandon_embedding_meeting');
    expect(abandon).toBeDefined();
    const args = abandon!.args as { p_meeting_id: string; p_error_text: string };
    expect(args.p_meeting_id).toBe('meeting-3');
    expect(args.p_error_text).toMatch(/upstream timeout/);
  });

  it('abandons when complete_embedding RPC errors', async () => {
    const { client, rpcCalls } = makeStubClient({
      claim: { id: 'meeting-4', segments: baseSegments },
      completeError: 'meeting not in embedding_inflight state',
    });
    const embed: CallEmbedder = vi
      .fn()
      .mockResolvedValueOnce(baseSegments.map(() => dummyVector()));

    const outcome = await runEmbeddingOnce({ supabase: client, embed });

    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') {
      expect(outcome.message).toMatch(/complete_embedding/);
    }
    expect(rpcCalls.some((c) => c.fn === 'abandon_embedding_meeting')).toBe(true);
  });

  it('abandons when the embedder returns the wrong number of vectors', async () => {
    const { client, rpcCalls } = makeStubClient({
      claim: { id: 'meeting-5', segments: baseSegments },
    });
    const embed: CallEmbedder = vi.fn().mockResolvedValueOnce([dummyVector()]); // 1 instead of 2

    const outcome = await runEmbeddingOnce({ supabase: client, embed });

    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') {
      expect(outcome.message).toMatch(/expected 2 vectors, got 1/);
    }
    expect(rpcCalls.some((c) => c.fn === 'abandon_embedding_meeting')).toBe(true);
  });
});
