import { describe, it, expect } from 'vitest';
import { resolveBoardChain, resolvePublication, resolveTown } from './resolvers.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@duly-noted/db';

type Client = SupabaseClient<Database>;

interface FakeRow {
  publications?: { id: string; slug: string; name: string };
  towns?: { id: string; slug: string; name: string };
  boards?: { id: string; slug: string; name: string };
}

function fakeClient(rows: FakeRow): Client {
  const make = (table: keyof FakeRow) => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
    };
    return builder;
  };
  return { from: (table: keyof FakeRow) => make(table) } as unknown as Client;
}

describe('resolvePublication', () => {
  it('returns the row when present', async () => {
    const c = fakeClient({ publications: { id: 'P', slug: 'p', name: 'Pub' } });
    expect(await resolvePublication(c, 'p')).toEqual({ id: 'P', slug: 'p', name: 'Pub' });
  });

  it('returns null when absent', async () => {
    expect(await resolvePublication(fakeClient({}), 'p')).toBeNull();
  });
});

describe('resolveTown', () => {
  it('returns the row when present', async () => {
    const c = fakeClient({ towns: { id: 'T', slug: 't', name: 'Town' } });
    const pub = { id: 'P', slug: 'p', name: 'Pub' };
    expect(await resolveTown(c, pub, 't')).toEqual({ id: 'T', slug: 't', name: 'Town' });
  });

  it('returns null when absent', async () => {
    const pub = { id: 'P', slug: 'p', name: 'Pub' };
    expect(await resolveTown(fakeClient({}), pub, 't')).toBeNull();
  });
});

describe('resolveBoardChain', () => {
  it('returns null when publication slug misses', async () => {
    const c = fakeClient({});
    expect(await resolveBoardChain(c, 'p', 't', 'b')).toBeNull();
  });

  it('returns null when town slug misses (publication present)', async () => {
    const c = fakeClient({ publications: { id: 'P', slug: 'p', name: 'Pub' } });
    expect(await resolveBoardChain(c, 'p', 't', 'b')).toBeNull();
  });

  it('returns null when board slug misses (publication + town present)', async () => {
    const c = fakeClient({
      publications: { id: 'P', slug: 'p', name: 'Pub' },
      towns: { id: 'T', slug: 't', name: 'Town' },
    });
    expect(await resolveBoardChain(c, 'p', 't', 'b')).toBeNull();
  });

  it('returns full chain when all three resolve', async () => {
    const c = fakeClient({
      publications: { id: 'P', slug: 'p', name: 'Pub' },
      towns: { id: 'T', slug: 't', name: 'Town' },
      boards: { id: 'B', slug: 'b', name: 'Board' },
    });
    expect(await resolveBoardChain(c, 'p', 't', 'b')).toEqual({
      publication: { id: 'P', slug: 'p', name: 'Pub' },
      town: { id: 'T', slug: 't', name: 'Town' },
      board: { id: 'B', slug: 'b', name: 'Board' },
    });
  });
});
