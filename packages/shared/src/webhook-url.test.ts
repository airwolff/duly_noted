import { describe, expect, it } from 'vitest';
import { composeWebhookUrl } from './webhook-url.js';

describe('composeWebhookUrl', () => {
  it('appends the Edge Function path to the project URL', () => {
    expect(composeWebhookUrl('https://abc.supabase.co')).toBe(
      'https://abc.supabase.co/functions/v1/asr-webhook',
    );
  });

  it('strips a trailing slash', () => {
    expect(composeWebhookUrl('https://abc.supabase.co/')).toBe(
      'https://abc.supabase.co/functions/v1/asr-webhook',
    );
  });

  it('strips multiple trailing slashes', () => {
    expect(composeWebhookUrl('https://abc.supabase.co///')).toBe(
      'https://abc.supabase.co/functions/v1/asr-webhook',
    );
  });
});
