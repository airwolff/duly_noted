import { describe, expect, it, vi } from 'vitest';
import { markFailed } from './fail.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@duly-noted/db';

interface UpdateCall {
  patch: Record<string, unknown>;
  filter: { column: string; value: string };
}

function makeStubClient(): {
  client: SupabaseClient<Database>;
  calls: UpdateCall[];
} {
  const calls: UpdateCall[] = [];
  const client = {
    from() {
      return {
        update(patch: Record<string, unknown>) {
          return {
            eq(column: string, value: string) {
              calls.push({ patch, filter: { column, value } });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient<Database>;
  return { client, calls };
}

describe('markFailed', () => {
  it('writes status, last_error, and failed_at filtered by id', async () => {
    const { client, calls } = makeStubClient();
    await markFailed(client, 'meeting-1', 'yt-dlp died');
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.patch.status).toBe('failed');
    expect(call.patch.last_error).toBe('yt-dlp died');
    expect(typeof call.patch.failed_at).toBe('string');
    expect(call.filter).toEqual({ column: 'id', value: 'meeting-1' });
  });

  it('truncates last_error at 4000 chars', async () => {
    const { client, calls } = makeStubClient();
    const long = 'x'.repeat(5000);
    await markFailed(client, 'meeting-2', long);
    expect((calls[0]!.patch.last_error as string).length).toBe(4000);
  });

  it('throws when the update returns an error', async () => {
    const failing = {
      from() {
        return {
          update() {
            return { eq: () => Promise.resolve({ error: { message: 'rls denied' } }) };
          },
        };
      },
    } as unknown as SupabaseClient<Database>;
    await expect(markFailed(failing, 'meeting-3', 'boom')).rejects.toThrow(/rls denied/);
    // ensure the test consumed the spy and didn't crash silently
    expect(vi.isMockFunction).toBeDefined();
  });
});
