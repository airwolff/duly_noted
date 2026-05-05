import { describe, expect, it } from 'vitest';
import { createServiceClient } from './service-client.js';

describe('createServiceClient', () => {
  it('throws when serviceRoleKey is missing', () => {
    expect(() =>
      createServiceClient({ supabaseUrl: 'https://example.supabase.co', serviceRoleKey: '' }),
    ).toThrow(/serviceRoleKey is required/);
  });

  it('returns a client when configured', () => {
    const client = createServiceClient({
      supabaseUrl: 'https://example.supabase.co',
      serviceRoleKey: 'service-role-key',
    });
    expect(client).toBeDefined();
    expect(typeof client.from).toBe('function');
  });
});
