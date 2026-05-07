import { describe, expect, it } from 'vitest';
import {
  assemblyAIWebhookPayloadSchema,
  assemblyAITranscriptSchema,
  buildAssemblyAISubmitBody,
} from './asr.js';

describe('assemblyAIWebhookPayloadSchema', () => {
  it('parses a completed payload', () => {
    const parsed = assemblyAIWebhookPayloadSchema.parse({
      transcript_id: 'abc123',
      status: 'completed',
    });
    expect(parsed.transcript_id).toBe('abc123');
    expect(parsed.status).toBe('completed');
  });

  it('parses an error payload', () => {
    const parsed = assemblyAIWebhookPayloadSchema.parse({
      transcript_id: 'abc123',
      status: 'error',
      error: 'something broke',
    });
    expect(parsed.error).toBe('something broke');
  });

  it('rejects payloads missing required fields', () => {
    expect(() => assemblyAIWebhookPayloadSchema.parse({ status: 'completed' })).toThrow();
  });
});

describe('assemblyAITranscriptSchema', () => {
  it('parses a minimal transcript', () => {
    const parsed = assemblyAITranscriptSchema.parse({
      id: 'abc123',
      status: 'completed',
      text: 'hello world',
      words: [],
      utterances: [],
    });
    expect(parsed.id).toBe('abc123');
    expect(parsed.text).toBe('hello world');
  });

  it('passthrough preserves unknown fields', () => {
    const parsed = assemblyAITranscriptSchema.parse({
      id: 'abc123',
      status: 'completed',
      audio_duration: 120,
    });
    expect((parsed as unknown as { audio_duration: number }).audio_duration).toBe(120);
  });
});

describe('buildAssemblyAISubmitBody', () => {
  it('builds the exact submit body shape per SPEC §Stage 2', () => {
    const body = buildAssemblyAISubmitBody({
      audioUrl: 'https://signed.example/audio.opus',
      webhookUrl: 'https://abc.supabase.co/functions/v1/asr-webhook',
      webhookSecret: 'shhh',
    });
    expect(body).toEqual({
      audio_url: 'https://signed.example/audio.opus',
      speaker_labels: true,
      webhook_url: 'https://abc.supabase.co/functions/v1/asr-webhook',
      webhook_auth_header_name: 'X-DulyNoted-Webhook',
      webhook_auth_header_value: 'shhh',
    });
  });

  it('omits all premium add-ons (auto_chapters, sentiment_analysis, etc.)', () => {
    const body = buildAssemblyAISubmitBody({
      audioUrl: 'https://signed.example/audio.opus',
      webhookUrl: 'https://abc.supabase.co/functions/v1/asr-webhook',
      webhookSecret: 'shhh',
    });
    const keys = Object.keys(body);
    expect(keys).not.toContain('auto_chapters');
    expect(keys).not.toContain('sentiment_analysis');
    expect(keys).not.toContain('content_safety');
    expect(keys).not.toContain('iab_categories');
    expect(keys).not.toContain('summarization');
    expect(keys).not.toContain('entity_detection');
  });
});
