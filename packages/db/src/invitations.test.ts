import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from './service-client.js';
import type { Database } from './types.js';

// Slice 7 integration tests: invitations table + auth.users trigger +
// RPCs. Skipped unless local Supabase env vars are set; CI runs with
// these unset.

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;
const skip = !url || !serviceKey || !anonKey;

const TEST_PASSWORD = 'invitations-test-password-1234';

describe.skipIf(skip)('Slice 7 invitations', () => {
  let admin: SupabaseClient<Database>;
  let publicationId: string;
  const testStamp = Date.now();
  const createdUserIds: string[] = [];
  const createdPublicationIds: string[] = [];

  beforeAll(async () => {
    admin = createServiceClient({ supabaseUrl: url!, serviceRoleKey: serviceKey! });
    const { data: pub, error: pubError } = await admin
      .from('publications')
      .insert({ slug: `slice7-${testStamp}-pub`, name: 'Slice 7 test pub' })
      .select('id')
      .single();
    if (pubError) throw pubError;
    publicationId = pub.id;
    createdPublicationIds.push(publicationId);
  });

  afterAll(async () => {
    if (!admin) return;
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
    for (const id of createdPublicationIds) {
      await admin.from('publications').delete().eq('id', id);
    }
  });

  async function createTestUser(email: string) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    const userId = data.user!.id;
    createdUserIds.push(userId);
    return userId;
  }

  it('happy path: open invitation resolves into membership at user creation', async () => {
    const email = `slice7-${testStamp}-happy@example.test`;
    const ins = await admin
      .from('invitations')
      .insert({ email, publication_id: publicationId, role: 'reader' });
    if (ins.error) throw ins.error;

    const userId = await createTestUser(email);

    const { data: membership } = await admin
      .from('memberships')
      .select('role, publication_id')
      .eq('user_id', userId)
      .maybeSingle();
    expect(membership).toEqual({ role: 'reader', publication_id: publicationId });

    const { data: invitation } = await admin
      .from('invitations')
      .select('accepted_at')
      .eq('email', email)
      .maybeSingle();
    expect(invitation?.accepted_at).not.toBeNull();
  });

  it('expired invitation: signup succeeds but creates no membership', async () => {
    const email = `slice7-${testStamp}-expired@example.test`;
    await admin.from('invitations').insert({
      email,
      publication_id: publicationId,
      role: 'reader',
      expires_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    });

    const userId = await createTestUser(email);

    const { count } = await admin
      .from('memberships')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
    expect(count).toBe(0);
  });

  it('revoked invitation: signup succeeds but creates no membership', async () => {
    const email = `slice7-${testStamp}-revoked@example.test`;
    await admin.from('invitations').insert({
      email,
      publication_id: publicationId,
      role: 'reader',
      revoked_at: new Date().toISOString(),
    });

    const userId = await createTestUser(email);

    const { count } = await admin
      .from('memberships')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
    expect(count).toBe(0);
  });

  it('no matching invitation: signup succeeds, no membership created', async () => {
    const email = `slice7-${testStamp}-orphan@example.test`;
    const userId = await createTestUser(email);

    const { count } = await admin
      .from('memberships')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
    expect(count).toBe(0);
  });

  it('multiple matching invitations across publications: all resolve', async () => {
    const email = `slice7-${testStamp}-multi@example.test`;
    const { data: pub2, error: pub2Error } = await admin
      .from('publications')
      .insert({ slug: `slice7-${testStamp}-pub2`, name: 'Second pub' })
      .select('id')
      .single();
    if (pub2Error) throw pub2Error;
    createdPublicationIds.push(pub2.id);

    await admin.from('invitations').insert([
      { email, publication_id: publicationId, role: 'reader' },
      { email, publication_id: pub2.id, role: 'editor' },
    ]);

    const userId = await createTestUser(email);

    const { data: memberships } = await admin
      .from('memberships')
      .select('publication_id, role')
      .eq('user_id', userId);
    expect(memberships).toHaveLength(2);
    expect(memberships).toEqual(
      expect.arrayContaining([
        { publication_id: publicationId, role: 'reader' },
        { publication_id: pub2.id, role: 'editor' },
      ]),
    );
  });

  it('trigger exception wrapper: forced failure does not block signup', async () => {
    // Replace handle_new_auth_user with a force-throwing version that
    // still wraps in EXCEPTION WHEN OTHERS — proves the wrapper makes
    // the trigger signup-safe even when the body raises. Restored at
    // the end.
    const forceThrowSql = `
      create or replace function public.handle_new_auth_user()
      returns trigger language plpgsql security definer
      set search_path = public, auth as $body$
      begin
        raise exception 'forced failure for test';
      exception when others then
        raise warning 'handle_new_auth_user: failed (test), error: %', SQLERRM;
        return NEW;
      end;
      $body$;
    `;
    const restoreSql = `
      create or replace function public.handle_new_auth_user()
      returns trigger language plpgsql security definer
      set search_path = public, auth as $body$
      declare
        matched_ids uuid[];
      begin
        select array_agg(id) into matched_ids
          from public.invitations
         where email = NEW.email
           and accepted_at is null and revoked_at is null
           and expires_at > now();
        if matched_ids is null or array_length(matched_ids, 1) is null then
          return NEW;
        end if;
        insert into public.memberships (user_id, publication_id, role)
        select NEW.id, publication_id, role from public.invitations
         where id = any(matched_ids)
        on conflict (user_id, publication_id) do nothing;
        update public.invitations set accepted_at = now()
         where id = any(matched_ids);
        return NEW;
      exception when others then
        raise warning 'handle_new_auth_user: failed for user_id=%, email=%, error=%',
          NEW.id, NEW.email, SQLERRM;
        return NEW;
      end;
      $body$;
    `;

    // exec_sql_unsafe is a test-only helper seeded by supabase/seed.sql
    // (granted to service_role only). If absent, skip cleanly.
    type AdminWithExec = SupabaseClient<Database> & {
      rpc: (fn: 'exec_sql_unsafe', args: { sql: string }) => Promise<{ error: unknown }>;
    };
    const adminExec = admin as unknown as AdminWithExec;

    const { error: forceError } = await adminExec.rpc('exec_sql_unsafe', {
      sql: forceThrowSql,
    });
    if (forceError) {
      console.warn('invitations test: skipping trigger-wrapper case — exec_sql_unsafe not seeded');
      return;
    }

    try {
      const email = `slice7-${testStamp}-trigger-throws@example.test`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: TEST_PASSWORD,
        email_confirm: true,
      });
      expect(error).toBeNull();
      expect(data.user).not.toBeNull();
      if (data.user) createdUserIds.push(data.user.id);
    } finally {
      await adminExec.rpc('exec_sql_unsafe', { sql: restoreSql });
    }
  });

  it('resolve_pending_invitations: idempotent for the calling user', async () => {
    const email = `slice7-${testStamp}-resolve@example.test`;
    // Create user first (no invitation yet → trigger fires but resolves
    // nothing). This is the "user already existed when invited" case.
    const userId = await createTestUser(email);

    await admin
      .from('invitations')
      .insert({ email, publication_id: publicationId, role: 'reader' });

    const userClient = createClient<Database>(url!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const signedIn = await userClient.auth.signInWithPassword({
      email,
      password: TEST_PASSWORD,
    });
    if (signedIn.error) throw signedIn.error;

    const { data: count1, error: e1 } = await userClient.rpc('resolve_pending_invitations');
    expect(e1).toBeNull();
    expect(count1).toBe(1);

    const { data: count2, error: e2 } = await userClient.rpc('resolve_pending_invitations');
    expect(e2).toBeNull();
    expect(count2).toBe(0);

    // Sanity: membership now exists.
    const { data: membership } = await admin
      .from('memberships')
      .select('role')
      .eq('user_id', userId)
      .eq('publication_id', publicationId)
      .maybeSingle();
    expect(membership?.role).toBe('reader');
  });
});
