import { z } from 'zod';
import { buildAssemblyAISubmitBody } from '@duly-noted/shared';

const ASSEMBLYAI_SUBMIT_URL = 'https://api.assemblyai.com/v2/transcript';

const submitResponseSchema = z
  .object({
    id: z.string(),
    status: z.string(),
  })
  .passthrough();

export interface SubmitArgs {
  apiKey: string;
  audioUrl: string;
  webhookUrl: string;
  webhookSecret: string;
}

/**
 * POST a transcription job to AssemblyAI's async endpoint. The webhook URL
 * MUST be derived from `SUPABASE_URL` via `composeWebhookUrl()`; this
 * function does not enforce that — the orchestrator does.
 *
 * Returns the AssemblyAI transcript_id which the worker writes to
 * `meetings.asr_transcript_id` before parking the row at `transcribing`.
 */
export async function submitToAssemblyAI(args: SubmitArgs): Promise<string> {
  const body = buildAssemblyAISubmitBody({
    audioUrl: args.audioUrl,
    webhookUrl: args.webhookUrl,
    webhookSecret: args.webhookSecret,
  });
  const response = await fetch(ASSEMBLYAI_SUBMIT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`assemblyai submit failed: ${response.status} ${text}`);
  }
  const json: unknown = await response.json();
  const parsed = submitResponseSchema.parse(json);
  return parsed.id;
}
