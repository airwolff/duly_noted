import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

describe('worker-cron env', () => {
  it('throws when required keys are missing', () => {
    const previous = { ...process.env };
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      expect(() => loadEnv()).toThrow();
    } finally {
      Object.assign(process.env, previous);
    }
  });
});
