import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@duly-noted/db';
import type { CallStructured } from './anthropic.js';
import { runSegmentationOnce } from './segment.js';

interface UpdateCall {
  patch: Record<string, unknown>;
  filter: { column: string; value: string };
}

interface RpcCall {
  fn: string;
  args: unknown;
}

interface StubOptions {
  claimRow: { id: string; transcript_url: string | null; duration_seconds: number | null } | null;
  transcriptJson: string;
  completeError?: string;
  downloadError?: string;
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
      if (fn === 'claim_segmenting_meeting') {
        return Promise.resolve({
          data: options.claimRow ? [options.claimRow] : [],
          error: null,
        });
      }
      if (fn === 'complete_segmentation') {
        if (options.completeError) {
          return Promise.resolve({ data: null, error: { message: options.completeError } });
        }
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: { message: `unexpected rpc: ${fn}` } });
    },
    storage: {
      from() {
        return {
          download() {
            if (options.downloadError) {
              return Promise.resolve({ data: null, error: { message: options.downloadError } });
            }
            return Promise.resolve({
              data: new Blob([options.transcriptJson], { type: 'application/json' }),
              error: null,
            });
          },
        };
      },
    },
    from() {
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

const synthTranscript = JSON.stringify({
  utterances: [
    { start: 0, end: 3000, text: 'Welcome to the meeting.', speaker: 'A' },
    { start: 3000, end: 6000, text: 'First on the agenda is the budget.', speaker: 'A' },
    { start: 6000, end: 9000, text: 'I move we approve.', speaker: 'B' },
  ],
});

describe('runSegmentationOnce', () => {
  it('returns idle when no segmenting row is claimable', async () => {
    const { client } = makeStubClient({ claimRow: null, transcriptJson: '' });
    const callStructured: CallStructured = vi.fn();
    const outcome = await runSegmentationOnce({ supabase: client, callStructured });
    expect(outcome).toEqual({ kind: 'idle' });
    expect(callStructured).not.toHaveBeenCalled();
  });

  it('runs the three-step pipeline and calls complete_segmentation on success', async () => {
    const { client, rpcCalls } = makeStubClient({
      claimRow: {
        id: 'meeting-1',
        transcript_url: 'meetings/meeting-1/transcript.json',
        duration_seconds: 600,
      },
      transcriptJson: synthTranscript,
    });

    const callStructured: CallStructured = vi
      .fn()
      .mockResolvedValueOnce({
        markers: [{ marker_type: 'AGENDA_ITEM', start_token: '[T0]' }],
      })
      .mockResolvedValueOnce({ end_token: '[T2]' })
      .mockResolvedValueOnce({ title: 'Budget item', description: 'Discussion of the budget.' });

    const outcome = await runSegmentationOnce({ supabase: client, callStructured });

    expect(outcome.kind).toBe('segmented');
    if (outcome.kind === 'segmented') {
      expect(outcome.meetingId).toBe('meeting-1');
      expect(outcome.segmentCount).toBe(1);
    }

    expect(callStructured).toHaveBeenCalledTimes(3);
    const completeCall = rpcCalls.find((c) => c.fn === 'complete_segmentation');
    expect(completeCall).toBeDefined();
    const args = completeCall!.args as { p_meeting_id: string; p_segments: unknown[] };
    expect(args.p_meeting_id).toBe('meeting-1');
    expect(args.p_segments).toHaveLength(1);
    const segment = args.p_segments[0] as Record<string, unknown>;
    expect(segment.sequence_order).toBe(0);
    expect(segment.marker_type).toBe('AGENDA_ITEM');
    expect(segment.title).toBe('Budget item');
    expect(segment.start_time_seconds).toBe(0);
    expect(segment.end_time_seconds).toBe(9);
    expect((segment.start_time_seconds as number) < (segment.end_time_seconds as number)).toBe(
      true,
    );
  });

  it('marks failed when the transcript has no utterances', async () => {
    const { client, updateCalls, rpcCalls } = makeStubClient({
      claimRow: {
        id: 'meeting-2',
        transcript_url: 'meetings/meeting-2/transcript.json',
        duration_seconds: 600,
      },
      transcriptJson: JSON.stringify({ utterances: [] }),
    });
    const callStructured: CallStructured = vi.fn();

    const outcome = await runSegmentationOnce({ supabase: client, callStructured });

    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') {
      expect(outcome.message).toMatch(/no utterances/);
    }
    expect(callStructured).not.toHaveBeenCalled();
    const failPatch = updateCalls.find((c) => c.patch.status === 'failed');
    expect(failPatch).toBeDefined();
    expect(rpcCalls.some((c) => c.fn === 'complete_segmentation')).toBe(false);
  });

  it('marks failed when claimed row is missing transcript_url', async () => {
    const { client, updateCalls } = makeStubClient({
      claimRow: { id: 'meeting-3', transcript_url: null, duration_seconds: 600 },
      transcriptJson: '',
    });
    const callStructured: CallStructured = vi.fn();

    const outcome = await runSegmentationOnce({ supabase: client, callStructured });

    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') {
      expect(outcome.message).toMatch(/transcript_url/);
    }
    expect(callStructured).not.toHaveBeenCalled();
    const failPatch = updateCalls.find((c) => c.patch.status === 'failed');
    expect(failPatch).toBeDefined();
  });

  it('marks failed with enriched message when step 3 returns an oversize title', async () => {
    const { client, updateCalls } = makeStubClient({
      claimRow: {
        id: 'meeting-5',
        transcript_url: 'meetings/meeting-5/transcript.json',
        duration_seconds: 600,
      },
      transcriptJson: synthTranscript,
    });
    const oversizeTitle = 'x'.repeat(121);
    const callStructured: CallStructured = vi
      .fn()
      .mockResolvedValueOnce({
        markers: [{ marker_type: 'AGENDA_ITEM', start_token: '[T0]' }],
      })
      .mockResolvedValueOnce({ end_token: '[T2]' })
      .mockResolvedValueOnce({ title: oversizeTitle, description: 'Discussion of the budget.' });

    const outcome = await runSegmentationOnce({ supabase: client, callStructured });

    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') {
      expect(outcome.message).toBe('title length 121 out of bounds [1, 120]');
    }
    const failPatch = updateCalls.find((c) => c.patch.status === 'failed');
    expect(failPatch).toBeDefined();
    expect(failPatch!.patch.last_error).toBe('title length 121 out of bounds [1, 120]');
  });

  it('marks failed when step 1 returns a T-token not in the lookup', async () => {
    const { client, updateCalls } = makeStubClient({
      claimRow: {
        id: 'meeting-4',
        transcript_url: 'meetings/meeting-4/transcript.json',
        duration_seconds: 600,
      },
      transcriptJson: synthTranscript,
    });
    const callStructured: CallStructured = vi.fn().mockResolvedValueOnce({
      markers: [{ marker_type: 'VOTE', start_token: '[T99]' }],
    });

    const outcome = await runSegmentationOnce({ supabase: client, callStructured });

    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') {
      expect(outcome.message).toMatch(/\[T99\]/);
    }
    expect(callStructured).toHaveBeenCalledTimes(1);
    const failPatch = updateCalls.find((c) => c.patch.status === 'failed');
    expect(failPatch).toBeDefined();
  });
});
