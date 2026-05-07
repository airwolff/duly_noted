import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@duly-noted/db';
import { composeWebhookUrl } from '@duly-noted/shared';
import { claimPendingMeeting } from './claim.js';
import { extractAudio } from './extract.js';
import { uploadAudio, signAudioUrl } from './upload.js';
import { submitToAssemblyAI } from './asr-submit.js';
import { markFailed } from './fail.js';

export type RunOutcome =
  | { kind: 'idle' }
  | { kind: 'submitted'; meetingId: string; transcriptId: string }
  | { kind: 'failed'; meetingId: string; message: string };

export interface RunDeps {
  supabase: SupabaseClient<Database>;
  supabaseUrl: string;
  asrVendorApiKey: string;
  asrWebhookSecret: string;
}

/**
 * Run the worker pipeline for a single claimed meeting. Idle when no
 * pending row is available. On any error after claim, the meeting is
 * marked failed and the function returns; per CLAUDE.md §7 there is no
 * automatic retry.
 */
export async function runPipelineOnce(deps: RunDeps): Promise<RunOutcome> {
  const meeting = await claimPendingMeeting(deps.supabase);
  if (!meeting) {
    return { kind: 'idle' };
  }

  let workDir: string | undefined;
  try {
    workDir = await mkdtemp(path.join(tmpdir(), 'duly-noted-'));
    const audioPath = path.join(workDir, `${meeting.id}.opus`);
    await extractAudio(meeting.youtube_id, audioPath);

    const storagePath = await uploadAudio(deps.supabase, meeting.id, audioPath);
    const signedUrl = await signAudioUrl(deps.supabase, storagePath);

    const transcriptId = await submitToAssemblyAI({
      apiKey: deps.asrVendorApiKey,
      audioUrl: signedUrl,
      webhookUrl: composeWebhookUrl(deps.supabaseUrl),
      webhookSecret: deps.asrWebhookSecret,
    });

    const { error: updateError } = await deps.supabase
      .from('meetings')
      .update({
        asr_transcript_id: transcriptId,
        audio_url: storagePath,
        status: 'transcribing',
      })
      .eq('id', meeting.id)
      .eq('status', 'extracting');
    if (updateError) {
      throw new Error(`final state update failed: ${updateError.message}`);
    }

    return { kind: 'submitted', meetingId: meeting.id, transcriptId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markFailed(deps.supabase, meeting.id, message);
    return { kind: 'failed', meetingId: meeting.id, message };
  } finally {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
