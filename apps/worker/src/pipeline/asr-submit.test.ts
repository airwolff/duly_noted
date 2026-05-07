import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { submitToAssemblyAI } from './asr-submit.js';

describe('submitToAssemblyAI', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('POSTs the SPEC §Stage 2 body shape to /v2/transcript and returns the transcript id', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'tx_abc', status: 'queued' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const id = await submitToAssemblyAI({
      apiKey: 'vendor-key',
      audioUrl: 'https://signed.example/audio.opus',
      webhookUrl: 'https://abc.supabase.co/functions/v1/asr-webhook',
      webhookSecret: 'shhh',
    });

    expect(id).toBe('tx_abc');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://api.assemblyai.com/v2/transcript');
    expect((init as RequestInit).method).toBe('POST');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer vendor-key');
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      audio_url: 'https://signed.example/audio.opus',
      speaker_labels: true,
      webhook_url: 'https://abc.supabase.co/functions/v1/asr-webhook',
      webhook_auth_header_name: 'X-DulyNoted-Webhook',
      webhook_auth_header_value: 'shhh',
    });
  });

  it('throws when AssemblyAI returns a non-2xx status', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('rate limited', {
        status: 429,
      }),
    );
    await expect(
      submitToAssemblyAI({
        apiKey: 'k',
        audioUrl: 'u',
        webhookUrl: 'w',
        webhookSecret: 's',
      }),
    ).rejects.toThrow(/429/);
  });
});
