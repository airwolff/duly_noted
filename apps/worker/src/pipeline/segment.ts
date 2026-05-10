import { z, ZodError } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@duly-noted/db';
import {
  DESCRIPTION_MAX_LEN,
  STEP_1_SYSTEM_PROMPT,
  STEP_2_SYSTEM_PROMPT,
  STEP_3_SYSTEM_PROMPT,
  TITLE_MAX_LEN,
  buildTTokenInput,
  parseTTokenIndex,
  step1JsonSchema,
  step1OutputSchema,
  step2JsonSchema,
  step2OutputSchema,
  step3JsonSchema,
  step3OutputSchema,
  validateTTokens,
  type MarkerType,
  type Step1Marker,
  type Utterance,
} from '@duly-noted/shared';
import type { CallStructured } from './anthropic.js';
import { markFailed } from './fail.js';

/**
 * Slice 3 segmentation orchestrator. Picks up a meeting parked at
 * status='segmenting' (Edge Function-set), runs the three-step Anthropic
 * pipeline, and atomically writes segments + advances status to 'summarizing'
 * via the complete_segmentation RPC. The claim RPC moves the row to the
 * transient 'chaptering' state so re-claim is gated while LLM work runs
 * outside the Postgres transaction.
 *
 * On any thrown error after claim, the row is marked failed (CLAUDE.md §7:
 * no automatic retry). The Anthropic wrapper handles transient API-level
 * retries internally; an exception escaping it is terminal.
 */

const BUCKET = 'meeting-artifacts';

// ~24K chars ≈ ~6K effective input tokens after Opus 4.7 tokenizer inflation
// (~35% per SPEC §Stage 4). Below ADR 0014's 8K-token target with margin.
const CHUNK_MAX_CHARS = 24_000;

const TRANSCRIPT_EXCERPT_MAX_LEN = 500;

const utteranceSchema = z.object({
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  text: z.string(),
  speaker: z.union([z.string(), z.null()]).optional(),
});

const transcriptArtifactSchema = z.object({
  utterances: z.array(utteranceSchema),
});

export type SegmentOutcome =
  | { kind: 'idle' }
  | { kind: 'segmented'; meetingId: string; segmentCount: number }
  | { kind: 'failed'; meetingId: string; message: string };

export interface SegmentDeps {
  supabase: SupabaseClient<Database>;
  callStructured: CallStructured;
}

interface ClaimedSegmentingMeeting {
  id: string;
  transcript_url: string | null;
  duration_seconds: number | null;
}

interface SegmentRow {
  sequence_order: number;
  marker_type: MarkerType;
  title: string;
  description: string;
  start_time_seconds: number;
  end_time_seconds: number;
  transcript_excerpt: string;
}

function tIndex(token: string): number {
  const idx = parseTTokenIndex(token);
  if (idx === null) {
    throw new Error(`invalid T-token: ${token}`);
  }
  return idx;
}

function chunkLines(text: string, maxChars: number): string[] {
  const lines = text.split('\n');
  const chunks: string[] = [];
  let current: string[] = [];
  let currentLen = 0;
  for (const line of lines) {
    const lineLen = line.length + 1;
    if (currentLen + lineLen > maxChars && current.length > 0) {
      chunks.push(current.join('\n'));
      current = [];
      currentLen = 0;
    }
    current.push(line);
    currentLen += lineLen;
  }
  if (current.length > 0) {
    chunks.push(current.join('\n'));
  }
  return chunks;
}

function parseStep3WithLengthDetail(raw: unknown): { title: string; description: string } {
  try {
    return step3OutputSchema.parse(raw);
  } catch (err) {
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      if (issue && (issue.code === 'too_big' || issue.code === 'too_small')) {
        const field = issue.path[0];
        if (field === 'title' || field === 'description') {
          const max = field === 'title' ? TITLE_MAX_LEN : DESCRIPTION_MAX_LEN;
          const actualLen =
            typeof raw === 'object' &&
            raw !== null &&
            field in raw &&
            typeof (raw as Record<string, unknown>)[field] === 'string'
              ? (raw as Record<string, string>)[field]!.length
              : 'unknown';
          throw new Error(`${field} length ${actualLen} out of bounds [1, ${max}]`);
        }
      }
    }
    throw err;
  }
}

async function claimSegmentingMeeting(
  supabase: SupabaseClient<Database>,
): Promise<ClaimedSegmentingMeeting | null> {
  const { data, error } = await supabase.rpc('claim_segmenting_meeting');
  if (error) {
    throw new Error(`claim_segmenting_meeting RPC failed: ${error.message}`);
  }
  if (!data || data.length === 0) return null;
  const row = data[0];
  if (!row) {
    throw new Error('claim_segmenting_meeting RPC returned empty row in non-empty data array');
  }
  return row;
}

async function downloadTranscript(
  supabase: SupabaseClient<Database>,
  storagePath: string,
): Promise<Utterance[]> {
  const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);
  if (error || !data) {
    throw new Error(`storage download failed for ${storagePath}: ${error?.message ?? 'no data'}`);
  }
  const text = await data.text();
  const json: unknown = JSON.parse(text);
  const parsed = transcriptArtifactSchema.parse(json);
  if (parsed.utterances.length === 0) {
    throw new Error('transcript has no utterances');
  }
  return parsed.utterances.map((u) => ({
    start: u.start,
    end: u.end,
    text: u.text,
    speaker: u.speaker ?? undefined,
  }));
}

async function extractMarkers(
  callStructured: CallStructured,
  text: string,
  lookup: number[],
): Promise<Step1Marker[]> {
  const chunks = chunkLines(text, CHUNK_MAX_CHARS);
  const markers: Step1Marker[] = [];
  for (const chunk of chunks) {
    const raw = await callStructured({
      systemPrompt: STEP_1_SYSTEM_PROMPT,
      userPrompt: chunk,
      jsonSchema: step1JsonSchema,
      maxTokens: 4096,
    });
    const parsed = step1OutputSchema.parse(raw);
    const tokens = parsed.markers.map((m) => m.start_token);
    const offending = validateTTokens(tokens, lookup);
    if (offending.length > 0) {
      throw new Error(`step 1 returned T-tokens not in lookup: ${offending.join(', ')}`);
    }
    markers.push(...parsed.markers);
  }
  if (markers.length === 0) {
    throw new Error('step 1 produced zero markers across all chunks');
  }
  markers.sort((a, b) => tIndex(a.start_token) - tIndex(b.start_token));
  return markers;
}

async function determineBoundaries(
  callStructured: CallStructured,
  markers: Step1Marker[],
  lines: string[],
  lookup: number[],
): Promise<string[]> {
  const ends: string[] = [];
  for (let i = 0; i < markers.length; i += 1) {
    const marker = markers[i];
    if (!marker) {
      throw new Error('invariant violation: markers[i] undefined inside bounded loop');
    }
    const startIdx = tIndex(marker.start_token);
    const nextMarker = markers[i + 1];
    const sliceEnd = nextMarker ? tIndex(nextMarker.start_token) : lines.length;
    const segment = lines.slice(startIdx, sliceEnd).join('\n');
    const userPrompt = `marker_type: ${marker.marker_type}\nstart_token: ${marker.start_token}\n\nTranscript:\n${segment}`;
    const raw = await callStructured({
      systemPrompt: STEP_2_SYSTEM_PROMPT,
      userPrompt,
      jsonSchema: step2JsonSchema,
      maxTokens: 256,
    });
    const parsed = step2OutputSchema.parse(raw);
    const offending = validateTTokens([parsed.end_token], lookup);
    if (offending.length > 0) {
      throw new Error(`step 2 returned invalid T-token: ${parsed.end_token}`);
    }
    const endIdx = tIndex(parsed.end_token);
    if (endIdx < startIdx) {
      throw new Error(
        `step 2 returned end_token ${parsed.end_token} before start_token ${marker.start_token}`,
      );
    }
    ends.push(parsed.end_token);
  }
  return ends;
}

async function generateTitlesAndDescriptions(
  callStructured: CallStructured,
  meetingId: string,
  markers: Step1Marker[],
  ends: string[],
  lines: string[],
  utterances: Utterance[],
): Promise<SegmentRow[]> {
  const segments: SegmentRow[] = [];
  for (let i = 0; i < markers.length; i += 1) {
    const marker = markers[i];
    const endToken = ends[i];
    if (!marker) {
      throw new Error('invariant violation: markers[i] undefined inside bounded loop');
    }
    if (!endToken) {
      throw new Error('invariant violation: ends[i] undefined inside bounded loop');
    }
    const startIdx = tIndex(marker.start_token);
    const endIdx = tIndex(endToken);
    const chapterText = lines.slice(startIdx, endIdx + 1).join('\n');
    const userPrompt = `marker_type: ${marker.marker_type}\n\nChapter text:\n${chapterText}`;
    const raw = await callStructured({
      systemPrompt: STEP_3_SYSTEM_PROMPT,
      userPrompt,
      jsonSchema: step3JsonSchema,
      maxTokens: 1024,
    });
    const parsed = parseStep3WithLengthDetail(raw);

    const startUtt = utterances[startIdx];
    const endUtt = utterances[endIdx];
    if (!startUtt || !endUtt) {
      throw new Error(`step 3: utterance index out of range (${startIdx}..${endIdx})`);
    }
    const startSec = Math.floor(startUtt.start / 1000);
    let endSec = Math.ceil(endUtt.end / 1000);
    if (endSec <= startSec) {
      console.warn(
        `segment-coerce meeting_id=${meetingId} sequence_order=${i} start_ms=${startUtt.start} end_ms=${endUtt.end}`,
      );
      endSec = startSec + 1;
    }

    const excerpt =
      chapterText.length > TRANSCRIPT_EXCERPT_MAX_LEN
        ? chapterText.slice(0, TRANSCRIPT_EXCERPT_MAX_LEN)
        : chapterText;

    segments.push({
      sequence_order: i,
      marker_type: marker.marker_type,
      title: parsed.title,
      description: parsed.description,
      start_time_seconds: startSec,
      end_time_seconds: endSec,
      transcript_excerpt: excerpt,
    });
  }
  return segments;
}

export async function runSegmentationOnce(deps: SegmentDeps): Promise<SegmentOutcome> {
  const meeting = await claimSegmentingMeeting(deps.supabase);
  if (!meeting) return { kind: 'idle' };

  if (!meeting.transcript_url) {
    const message = 'segmenting row missing transcript_url';
    await markFailed(deps.supabase, meeting.id, message);
    return { kind: 'failed', meetingId: meeting.id, message };
  }

  try {
    const utterances = await downloadTranscript(deps.supabase, meeting.transcript_url);
    const tInput = buildTTokenInput(utterances);
    const lines = tInput.text.split('\n');

    const markers = await extractMarkers(deps.callStructured, tInput.text, tInput.lookup);
    const ends = await determineBoundaries(deps.callStructured, markers, lines, tInput.lookup);
    const segments = await generateTitlesAndDescriptions(
      deps.callStructured,
      meeting.id,
      markers,
      ends,
      lines,
      utterances,
    );

    const { error: completeErr } = await deps.supabase.rpc('complete_segmentation', {
      p_meeting_id: meeting.id,
      p_segments: segments as unknown as Json,
    });
    if (completeErr) {
      throw new Error(`complete_segmentation RPC failed: ${completeErr.message}`);
    }

    return { kind: 'segmented', meetingId: meeting.id, segmentCount: segments.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markFailed(deps.supabase, meeting.id, message);
    return { kind: 'failed', meetingId: meeting.id, message };
  }
}
