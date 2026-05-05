import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('ASR webhook secret check', () => {
  const previous = process.env.ASR_WEBHOOK_SECRET;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
    process.env.ASR_WEBHOOK_SECRET = 'shhh';
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.ASR_WEBHOOK_SECRET;
    else process.env.ASR_WEBHOOK_SECRET = previous;
  });

  it('rejects requests without a matching secret', async () => {
    const { POST } = await import('./api/webhooks/asr/route.js');
    const request = new Request('https://example.test/api/webhooks/asr', { method: 'POST' });
    const response = await POST(request as unknown as Parameters<typeof POST>[0]);
    expect(response.status).toBe(401);
  });

  it('returns 501 when the secret matches', async () => {
    const { POST } = await import('./api/webhooks/asr/route.js');
    const request = new Request('https://example.test/api/webhooks/asr', {
      method: 'POST',
      headers: { 'x-webhook-secret': 'shhh' },
    });
    const response = await POST(request as unknown as Parameters<typeof POST>[0]);
    expect(response.status).toBe(501);
  });
});
