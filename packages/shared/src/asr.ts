import { z } from 'zod';

/**
 * AssemblyAI webhook callback body. Vendor returns at least these two
 * fields; we treat the JSON as untrusted input and validate before any
 * side effect.
 */
export const assemblyAIWebhookPayloadSchema = z
  .object({
    transcript_id: z.string(),
    status: z.string(),
    error: z.string().optional(),
  })
  .passthrough();

export type AssemblyAIWebhookPayload = z.infer<typeof assemblyAIWebhookPayloadSchema>;

/**
 * Minimal validation of the full transcript JSON we fetch from AssemblyAI's
 * `/v2/transcript/{id}` endpoint. We persist the entire response to Storage
 * but only branch on a small set of validated keys.
 */
export const assemblyAITranscriptSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    text: z.string().optional(),
    utterances: z.array(z.unknown()).optional(),
    words: z.array(z.unknown()).optional(),
  })
  .passthrough();

export type AssemblyAITranscript = z.infer<typeof assemblyAITranscriptSchema>;

export interface AssemblyAISubmitBody {
  audio_url: string;
  speaker_labels: true;
  webhook_url: string;
  webhook_auth_header_name: 'X-DulyNoted-Webhook';
  webhook_auth_header_value: string;
}

export interface BuildSubmitBodyArgs {
  audioUrl: string;
  webhookUrl: string;
  webhookSecret: string;
}

/**
 * Build the exact JSON body the worker POSTs to AssemblyAI's
 * `/v2/transcript` endpoint. No premium add-ons (auto_chapters,
 * sentiment_analysis, content_safety, iab_categories, summarization) per
 * SPEC.md Stage 2 and CLAUDE.md §7.
 */
export function buildAssemblyAISubmitBody(args: BuildSubmitBodyArgs): AssemblyAISubmitBody {
  return {
    audio_url: args.audioUrl,
    speaker_labels: true,
    webhook_url: args.webhookUrl,
    webhook_auth_header_name: 'X-DulyNoted-Webhook',
    webhook_auth_header_value: args.webhookSecret,
  };
}
