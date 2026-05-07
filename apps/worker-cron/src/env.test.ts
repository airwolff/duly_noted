import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

describe('worker-cron env', () => {
  it('throws when required keys are missing', () => {
    const previous = { ...process.env };
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.YOUTUBE_API_KEY;
    try {
      expect(() => loadEnv()).toThrow();
    } finally {
      Object.assign(process.env, previous);
    }
  });

  it('throws when YOUTUBE_API_KEY alone is missing', () => {
    const previous = { ...process.env };
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    delete process.env.YOUTUBE_API_KEY;
    try {
      expect(() => loadEnv()).toThrow(/YOUTUBE_API_KEY/);
    } finally {
      Object.assign(process.env, previous);
    }
  });
});
