import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from './service-client.js';
import type { Database } from './types.js';

// Integration test: proves cross-publication RLS isolation under the
// Slice 5 membership-aware policies. Skipped unless local Supabase
// env vars are set; CI runs with these unset.

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;
const skip = !url || !serviceKey || !anonKey;

describe.skipIf(skip)('Slice 5 membership-aware RLS', () => {
  let admin: SupabaseClient<Database>;
  let pubA: string;
  let pubB: string;
  let userId: string;
  let authedClient: SupabaseClient<Database>;

  beforeAll(async () => {
    admin = createServiceClient({ supabaseUrl: url!, serviceRoleKey: serviceKey! });

    const stamp = Date.now();
    const slugA = `rls-a-${stamp}`;
    const slugB = `rls-b-${stamp}`;

    const a = await admin
      .from('publications')
      .insert({ slug: slugA, name: 'A' })
      .select('id')
      .single();
    if (a.error) throw a.error;
    pubA = a.data.id;

    const b = await admin
      .from('publications')
      .insert({ slug: slugB, name: 'B' })
      .select('id')
      .single();
    if (b.error) throw b.error;
    pubB = b.data.id;

    const email = `rls-test-${stamp}@example.test`;
    const created = await admin.auth.admin.createUser({
      email,
      password: 'rls-test-password-1234',
      email_confirm: true,
    });
    if (created.error) throw created.error;
    userId = created.data.user!.id;

    const m = await admin
      .from('memberships')
      .insert({ user_id: userId, publication_id: pubA, role: 'reader' });
    if (m.error) throw m.error;

    authedClient = createClient<Database>(url!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const signedIn = await authedClient.auth.signInWithPassword({
      email,
      password: 'rls-test-password-1234',
    });
    if (signedIn.error) throw signedIn.error;
  });

  afterAll(async () => {
    if (!admin) return;
    if (userId) await admin.auth.admin.deleteUser(userId);
    if (pubA) await admin.from('publications').delete().eq('id', pubA);
    if (pubB) await admin.from('publications').delete().eq('id', pubB);
  });

  it('hides publications the user has no membership in', async () => {
    const { data, error } = await authedClient
      .from('publications')
      .select('id, slug')
      .in('id', [pubA, pubB]);
    expect(error).toBeNull();
    const ids = (data ?? []).map((r) => r.id);
    expect(ids).toContain(pubA);
    expect(ids).not.toContain(pubB);
  });

  it('hides memberships belonging to other users', async () => {
    // Seed a foreign membership on pubA (different user) — the authed
    // user must only see their own row.
    const otherEmail = `rls-other-${Date.now()}@example.test`;
    const other = await admin.auth.admin.createUser({
      email: otherEmail,
      password: 'other-password-1234',
      email_confirm: true,
    });
    if (other.error) throw other.error;
    const otherUserId = other.data.user!.id;
    await admin
      .from('memberships')
      .insert({ user_id: otherUserId, publication_id: pubA, role: 'reader' });

    try {
      const { data } = await authedClient.from('memberships').select('user_id');
      const userIds = (data ?? []).map((r) => r.user_id);
      expect(userIds).toEqual([userId]);
    } finally {
      await admin.auth.admin.deleteUser(otherUserId);
    }
  });
});
