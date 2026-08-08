import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@duly-noted/db';
import { SUMMARY_MAX_CHARS, SUMMARY_MIN_CHARS } from '@duly-noted/shared';
import type { CallStructured } from './anthropic.js';
import { runSummarizationOnce } from './summarize.js';

interface UpdateCall {
  patch: Record<string, unknown>;
  filter: { column: string; value: string };
}

interface RpcCall {
  fn: string;
  args: unknown;
}

type ClaimRow = {
  id: string;
  board_id: string;
  title: string | null;
  meeting_date: string | null;
  youtube_id: string;
};

type SegmentRow = {
  sequence_order: number;
  marker_type: 'AGENDA_ITEM' | 'PUBLIC_COMMENT' | 'DISCUSSION' | 'VOTE' | 'PROCEDURE';
  title: string;
  description: string;
  transcript_excerpt: string;
};

interface StubOptions {
  claimRow: ClaimRow | null;
  boardLookup?: { name: string; towns: { name: string } } | null;
  boardLookupError?: string;
  segments?: SegmentRow[];
  segmentsError?: string;
  completeError?: string;
}

function makeStubClient(options: StubOptions): {
  client: SupabaseClient<Database>;
  rpcCalls: RpcCall[];
  updateCalls: UpdateCall[];
} {
  const rpcCalls: RpcCall[] = [];
  const updateCalls: UpdateCall[] = [];

  const client = {
    rpc(fn: string, args?: unknown) {
      rpcCalls.push({ fn, args });
      if (fn === 'claim_summarizing_meeting') {
        return Promise.resolve({
          data: options.claimRow ? [options.claimRow] : [],
          error: null,
        });
      }
      if (fn === 'complete_summarization') {
        if (options.completeError) {
          return Promise.resolve({ data: null, error: { message: options.completeError } });
        }
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: { message: `unexpected rpc: ${fn}` } });
    },
    from(table: string) {
      if (table === 'boards') {
        return {
          select() {
            return {
              eq() {
                return {
                  single() {
                    if (options.boardLookupError) {
                      return Promise.resolve({
                        data: null,
                        error: { message: options.boardLookupError },
                      });
                    }
                    return Promise.resolve({
                      data: options.boardLookup ?? null,
                      error: null,
                    });
                  },
                };
              },
            };
          },
        };
      }
      if (table === 'segments') {
        return {
          select() {
            return {
              eq() {
                return {
                  order() {
                    if (options.segmentsError) {
                      return Promise.resolve({
                        data: null,
                        error: { message: options.segmentsError },
                      });
                    }
                    return Promise.resolve({ data: options.segments ?? [], error: null });
                  },
                };
              },
            };
          },
        };
      }
      // meetings — used only by markFailed
      return {
        update(patch: Record<string, unknown>) {
          return {
            eq(column: string, value: string) {
              updateCalls.push({ patch, filter: { column, value } });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient<Database>;

  return { client, rpcCalls, updateCalls };
}

const validSummary = 'x'.repeat(SUMMARY_MIN_CHARS);

const baseClaim: ClaimRow = {
  id: 'meeting-1',
  board_id: 'board-1',
  title: 'Regular Meeting',
  meeting_date: '2026-04-15',
  youtube_id: 'abc123',
};

const baseBoard = { name: 'Lincolnville Selectboard', towns: { name: 'Lincolnville' } };

const baseSegments: SegmentRow[] = [
  {
    sequence_order: 0,
    marker_type: 'PROCEDURE',
    title: 'Call to order',
    description: 'Chair calls the meeting to order.',
    transcript_excerpt: 'This meeting is called to order.',
  },
  {
    sequence_order: 1,
    marker_type: 'AGENDA_ITEM',
    title: 'Treasurer report',
    description: 'Monthly financials presented.',
    transcript_excerpt: 'The treasurer presented the report.',
  },
  {
    sequence_order: 2,
    marker_type: 'VOTE',
    title: 'Vote: accept report',
    description: 'Board accepts the report unanimously.',
    transcript_excerpt: 'All in favor say aye.',
  },
];

describe('runSummarizationOnce', () => {
  it('returns idle when no summarizing row is claimable', async () => {
    const { client } = makeStubClient({ claimRow: null });
    const callStructured: CallStructured = vi.fn();
    const outcome = await runSummarizationOnce({ supabase: client, callStructured });
    expect(outcome).toEqual({ kind: 'idle' });
    expect(callStructured).not.toHaveBeenCalled();
  });

  it('runs the summarization call and writes via complete_summarization on success', async () => {
    const { client, rpcCalls } = makeStubClient({
      claimRow: baseClaim,
      boardLookup: baseBoard,
      segments: baseSegments,
    });
    const callStructured: CallStructured = vi.fn().mockResolvedValueOnce({ summary: validSummary });

    const outcome = await runSummarizationOnce({ supabase: client, callStructured });

    expect(outcome.kind).toBe('summarized');
    if (outcome.kind === 'summarized') {
      expect(outcome.meetingId).toBe('meeting-1');
    }
    expect(callStructured).toHaveBeenCalledTimes(1);

    const completeCall = rpcCalls.find((c) => c.fn === 'complete_summarization');
    expect(completeCall).toBeDefined();
    const args = completeCall!.args as { p_meeting_id: string; p_summary: string };
    expect(args.p_meeting_id).toBe('meeting-1');
    expect(args.p_summary).toBe(validSummary);
  });

  it('marks failed when the meeting has no segments (no LLM call)', async () => {
    const { client, rpcCalls, updateCalls } = makeStubClient({
      claimRow: baseClaim,
      boardLookup: baseBoard,
      segments: [],
    });
    const callStructured: CallStructured = vi.fn();

    const outcome = await runSummarizationOnce({ supabase: client, callStructured });

    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') {
      expect(outcome.message).toMatch(/no segments/);
    }
    expect(callStructured).not.toHaveBeenCalled();
    expect(rpcCalls.some((c) => c.fn === 'complete_summarization')).toBe(false);
    const failPatch = updateCalls.find((c) => c.patch.status === 'failed');
    expect(failPatch).toBeDefined();
  });

  it('marks failed with enriched message when the LLM output fails Zod length validation', async () => {
    const { client, rpcCalls, updateCalls } = makeStubClient({
      claimRow: baseClaim,
      boardLookup: baseBoard,
      segments: baseSegments,
    });
    const tooShort = 'too short';
    // Both attempts violate the bound: the correction retry gets one more shot
    // and the meeting fails only after it too comes back out of range.
    const callStructured: CallStructured = vi.fn().mockResolvedValue({ summary: tooShort });

    const outcome = await runSummarizationOnce({ supabase: client, callStructured });

    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') {
      expect(outcome.message).toBe(
        `summary length ${tooShort.length} out of bounds [${SUMMARY_MIN_CHARS}, ${SUMMARY_MAX_CHARS}]`,
      );
    }
    expect(callStructured).toHaveBeenCalledTimes(2);
    expect(rpcCalls.some((c) => c.fn === 'complete_summarization')).toBe(false);
    const failPatch = updateCalls.find((c) => c.patch.status === 'failed');
    expect(failPatch).toBeDefined();
    expect(failPatch!.patch.last_error).toBe(
      `summary length ${tooShort.length} out of bounds [${SUMMARY_MIN_CHARS}, ${SUMMARY_MAX_CHARS}]`,
    );
  });

  it('recovers when the correction retry lands inside the bound', async () => {
    // Reproduces the production failure: three of the first three meetings died
    // at 2075/2268 chars against the cap of the day, after the ASR spend was
    // committed. Sized off the constants so a bound change cannot silently
    // turn this into a test that never exercises the retry.
    const { client, rpcCalls, updateCalls } = makeStubClient({
      claimRow: baseClaim,
      boardLookup: baseBoard,
      segments: baseSegments,
    });
    const overLong = 'x'.repeat(SUMMARY_MAX_CHARS + 75);
    const inBounds = 'y'.repeat(SUMMARY_MAX_CHARS - 200);
    const callStructured: CallStructured = vi
      .fn()
      .mockResolvedValueOnce({ summary: overLong })
      .mockResolvedValueOnce({ summary: inBounds });

    const outcome = await runSummarizationOnce({ supabase: client, callStructured });

    expect(outcome.kind).toBe('summarized');
    expect(callStructured).toHaveBeenCalledTimes(2);
    const complete = rpcCalls.find((c) => c.fn === 'complete_summarization');
    expect(complete).toBeDefined();
    expect(complete!.args.p_summary).toBe(inBounds);
    expect(updateCalls.some((c) => c.patch.status === 'failed')).toBe(false);
  });

  it('marks failed when the LLM call throws (post-retry exhaustion)', async () => {
    const { client, rpcCalls, updateCalls } = makeStubClient({
      claimRow: baseClaim,
      boardLookup: baseBoard,
      segments: baseSegments,
    });
    const callStructured: CallStructured = vi
      .fn()
      .mockRejectedValueOnce(new Error('upstream timeout'));

    const outcome = await runSummarizationOnce({ supabase: client, callStructured });

    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') {
      expect(outcome.message).toMatch(/upstream timeout/);
    }
    expect(rpcCalls.some((c) => c.fn === 'complete_summarization')).toBe(false);
    const failPatch = updateCalls.find((c) => c.patch.status === 'failed');
    expect(failPatch).toBeDefined();
  });

  it('marks failed when complete_summarization RPC errors', async () => {
    const { client, updateCalls } = makeStubClient({
      claimRow: baseClaim,
      boardLookup: baseBoard,
      segments: baseSegments,
      completeError: 'meeting not in summarizing_inflight state',
    });
    const callStructured: CallStructured = vi.fn().mockResolvedValueOnce({ summary: validSummary });

    const outcome = await runSummarizationOnce({ supabase: client, callStructured });

    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') {
      expect(outcome.message).toMatch(/complete_summarization/);
    }
    const failPatch = updateCalls.find((c) => c.patch.status === 'failed');
    expect(failPatch).toBeDefined();
  });
});
