import type { SupabaseClient } from '@supabase/supabase-js';
import { ZodError } from 'zod';
import type { Database } from '@duly-noted/db';
import {
  buildSummaryUserPrompt,
  SUMMARY_MAX_CHARS,
  SUMMARY_MIN_CHARS,
  summaryJsonSchema,
  summaryOutputSchema,
  SUMMARIZATION_SYSTEM_PROMPT,
  type SummaryPromptSegment,
} from '@duly-noted/shared';
import type { CallStructured } from './anthropic.js';
import { markFailed } from './fail.js';

/**
 * Slice 4 summarization orchestrator. Picks up a meeting parked at
 * status='summarizing' (Slice 3-set), runs the single Anthropic summary call,
 * and atomically writes the summary + advances status to 'published' via the
 * complete_summarization RPC. The claim RPC moves the row to the transient
 * 'summarizing_inflight' state so re-claim is gated while the LLM call runs
 * outside the Postgres transaction (mirrors Slice 3's chaptering pattern).
 *
 * On any thrown error after claim, the row is marked failed (CLAUDE.md §7:
 * no automatic retry). The Anthropic wrapper handles transient API-level
 * retries internally; an exception escaping it is terminal.
 */

// ~8K Opus 4.7 effective input tokens leaves comfortable headroom for the
// largest expected summary. Per SPEC §Stage 6 the summary is ~500 tokens.
const SUMMARY_MAX_OUTPUT_TOKENS = 2048;

export type SummarizeOutcome =
  | { kind: 'idle' }
  | { kind: 'summarized'; meetingId: string }
  | { kind: 'failed'; meetingId: string; message: string };

export interface SummarizeDeps {
  supabase: SupabaseClient<Database>;
  callStructured: CallStructured;
}

interface ClaimedSummarizingMeeting {
  id: string;
  board_id: string;
  title: string | null;
  meeting_date: string | null;
  youtube_id: string;
}

interface BoardLookupRow {
  name: string;
  towns: { name: string } | { name: string }[] | null;
}

async function claimSummarizingMeeting(
  supabase: SupabaseClient<Database>,
): Promise<ClaimedSummarizingMeeting | null> {
  const { data, error } = await supabase.rpc('claim_summarizing_meeting');
  if (error) {
    throw new Error(`claim_summarizing_meeting RPC failed: ${error.message}`);
  }
  if (!data || data.length === 0) return null;
  const row = data[0];
  if (!row) {
    throw new Error('claim_summarizing_meeting RPC returned empty row in non-empty data array');
  }
  return row;
}

async function loadBoardAndTownNames(
  supabase: SupabaseClient<Database>,
  boardId: string,
): Promise<{ boardName: string; townName: string }> {
  const { data, error } = await supabase
    .from('boards')
    .select('name, towns(name)')
    .eq('id', boardId)
    .single();
  if (error || !data) {
    throw new Error(`board lookup failed for ${boardId}: ${error?.message ?? 'no data'}`);
  }
  const row = data as unknown as BoardLookupRow;
  const town = Array.isArray(row.towns) ? row.towns[0] : row.towns;
  if (!town) {
    throw new Error(`board ${boardId} has no town`);
  }
  return { boardName: row.name, townName: town.name };
}

function parseSummaryWithLengthDetail(raw: unknown): { summary: string } {
  try {
    return summaryOutputSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      if (issue && (issue.code === 'too_big' || issue.code === 'too_small')) {
        const actualLen =
          typeof raw === 'object' &&
          raw !== null &&
          'summary' in raw &&
          typeof (raw as { summary: unknown }).summary === 'string'
            ? (raw as { summary: string }).summary.length
            : 'unknown';
        throw new Error(
          `summary length ${actualLen} out of bounds [${SUMMARY_MIN_CHARS}, ${SUMMARY_MAX_CHARS}]`,
        );
      }
    }
    throw err;
  }
}

async function loadSegments(
  supabase: SupabaseClient<Database>,
  meetingId: string,
): Promise<SummaryPromptSegment[]> {
  const { data, error } = await supabase
    .from('segments')
    .select('sequence_order, marker_type, title, description, transcript_excerpt')
    .eq('meeting_id', meetingId)
    .order('sequence_order', { ascending: true });
  if (error) {
    throw new Error(`segments query failed for ${meetingId}: ${error.message}`);
  }
  return (data ?? []).map((s) => ({
    sequence_order: s.sequence_order,
    marker_type: s.marker_type,
    title: s.title,
    description: s.description,
    transcript_excerpt: s.transcript_excerpt,
  }));
}

export async function runSummarizationOnce(deps: SummarizeDeps): Promise<SummarizeOutcome> {
  const meeting = await claimSummarizingMeeting(deps.supabase);
  if (!meeting) return { kind: 'idle' };

  try {
    const { boardName, townName } = await loadBoardAndTownNames(deps.supabase, meeting.board_id);
    const segments = await loadSegments(deps.supabase, meeting.id);

    if (segments.length === 0) {
      throw new Error('summarizing row has no segments');
    }

    const userPrompt = buildSummaryUserPrompt({
      boardName,
      townName,
      meetingTitle: meeting.title,
      meetingDate: meeting.meeting_date,
      segments,
    });

    const raw = await deps.callStructured({
      systemPrompt: SUMMARIZATION_SYSTEM_PROMPT,
      userPrompt,
      jsonSchema: summaryJsonSchema,
      maxTokens: SUMMARY_MAX_OUTPUT_TOKENS,
    });
    const parsed = parseSummaryWithLengthDetail(raw);

    const { error: completeErr } = await deps.supabase.rpc('complete_summarization', {
      p_meeting_id: meeting.id,
      p_summary: parsed.summary,
    });
    if (completeErr) {
      throw new Error(`complete_summarization RPC failed: ${completeErr.message}`);
    }

    return { kind: 'summarized', meetingId: meeting.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markFailed(deps.supabase, meeting.id, message);
    return { kind: 'failed', meetingId: meeting.id, message };
  }
}
